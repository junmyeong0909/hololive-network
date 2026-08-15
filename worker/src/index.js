/**
 * HOLONET 피드 Worker
 *
 * GET /api/feed  → 멤버들의 YouTube 활동(라이브/예정/음악/영상)을 정규화해 반환
 * GET /api/feed?debug=1 → 업스트림 응답 진단 정보 포함
 *
 * Holodex API 키는 secret(HOLODEX_API_KEY)에 있으며 응답에 절대 포함되지 않는다.
 */

import channelIds from '../../src/data/channelIds.json';
import seedSongs from '../../src/data/memberSongs.json';

const HOLODEX = 'https://holodex.net/api/v2';
const CACHE_SECONDS = 60;
const PAST_VIDEO_LIMIT = 50;
const MUSIC_LIMIT = 25;

// 곡 아카이브(무한 누적)의 안전 상한. KV 값 크기(25MB)에는 한참 못 미치지만,
// 응답 payload가 끝없이 커지는 걸 막는다. 39명 x 활동량 기준 수년 치 분량.
const MUSIC_ARCHIVE_CAP = 5000;
const MUSIC_ARCHIVE_KEY = 'music-archive-v1';

const ALLOWED_ORIGINS = [
  'https://junmyeong0909.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

// Holodex 채널ID -> 우리 멤버ID (역방향 조회용)
const MEMBER_BY_CHANNEL = Object.fromEntries(
  Object.entries(channelIds).map(([memberId, channelId]) => [channelId, memberId])
);
const CHANNEL_IDS = Object.values(channelIds);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

async function holodex(path, apiKey) {
  const res = await fetch(`${HOLODEX}${path}`, {
    headers: { 'X-APIKEY': apiKey },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Holodex ${path} → ${res.status} ${body.slice(0, 120)}`);
  }
  return res.json();
}

// 상시 대기방(FreeChat)은 영구히 upcoming 상태라 예정 탭을 도배한다. 제외.
const EXCLUDED_TOPICS = new Set(['freechat', 'freetalk']);

// 몇 달~몇 년 뒤로 잡아둔 상시 공지 프레임(2028년 예정 등)을 걸러낸다.
// 토픽 이름으로 거르면 놓치는 게 생겨서 예정 시각 기준으로 자른다.
const MAX_UPCOMING_DAYS = 14;

/*
 * 음악 탭에는 "유튜브 동영상으로 올라온 곡"만 넣는다.
 * 가창 방송(歌枠, topic=singing/karaoke)은 곡이 아니라 방송이므로 stream으로 둔다.
 * 라이브에서 부른 곡을 나중에 동영상으로 따로 올리면 그 영상은 Music_Cover /
 * Original_Song 태그가 붙으므로 자연히 음악으로 잡힌다.
 */
const MUSIC_TOPICS = new Set(['music_cover', 'original_song']);

// 인스트루멘털(반주) 버전은 음악 탭에서 뺀다
const INSTRUMENTAL = /instrumental|off\s*vocal|inst\.?\s*ver|카라오케\s*ver/i;

// 기술적인 topic_id를 사람이 읽을 만하게.
// Holodex는 Music_Cover / 3D_Stream 처럼 대소문자가 섞여 오므로 소문자로 조회한다.
const TOPIC_LABEL = {
  singing: '노래',
  music_cover: '커버',
  original_song: '오리지널 곡',
  karaoke: '노래방',
  '3d_stream': '3D 방송',
  '3d_live': '3D 라이브',
  asmr: 'ASMR',
  talk: '잡담',
  announce: '공지',
  anniversary: '기념 방송',
  watchalong: '같이 보기',
  membersonly: '멤버 한정',
  shorts: '쇼츠',
  vlog: '브이로그',
  morning: '아침 방송',
  minecraft: '마인크래프트',
  apex: 'APEX',
};

function prettyTopic(topicId) {
  if (!topicId) return '';
  return TOPIC_LABEL[String(topicId).toLowerCase()] ?? String(topicId).replace(/_/g, ' ');
}

/** Holodex 영상 하나를 우리 알림 스키마로 변환. 제외 대상이면 null. */
function toNotification(v) {
  const channelId = v.channel?.id ?? v.channel_id;
  const memberId = MEMBER_BY_CHANNEL[channelId];
  if (!memberId) return null;

  const topicId = v.topic_id ?? '';
  if (EXCLUDED_TOPICS.has(topicId.toLowerCase())) return null;

  // Holodex status: live | upcoming | past | new | missing
  const status = v.status === 'live' || v.status === 'upcoming' ? v.status : 'past';

  // 음악은 곡 영상만. 인스트루멘털은 제외해 일반 영상으로 둔다.
  const title = v.title ?? '';
  const isMusic = MUSIC_TOPICS.has(topicId.toLowerCase()) && !INSTRUMENTAL.test(title);
  const type = isMusic ? 'music' : v.type === 'stream' ? 'stream' : 'video';

  // 라이브/예정은 시작(예정) 시각, 지난 건 공개 시각
  const timestamp = v.start_actual ?? v.start_scheduled ?? v.available_at ?? v.published_at;

  // 몇 달 뒤로 잡아둔 상시 공지 프레임 제외
  if (status === 'upcoming' && timestamp) {
    const daysAhead = (new Date(timestamp).getTime() - Date.now()) / 86_400_000;
    if (daysAhead > MAX_UPCOMING_DAYS) return null;
  }

  // 멤버십 한정 영상은 유튜브 자체가 비회원에게 페이지를 안 보여줘서
  // Holodex도 시청자 수를 못 읽는다 — 0을 주는데, 이건 "진짜 0명"이 아니라
  // "값을 못 가져옴"이다. 프론트에서 구분해서 보여주도록 플래그를 따로 둔다.
  const membersOnly = topicId.toLowerCase() === 'membersonly';

  return {
    id: `yt:${v.id}`,
    memberId,
    type,
    status,
    title,
    // 토픽이 없으면 비워둔다. 채널명으로 폴백하면 바로 위 멤버 이름과 중복된다.
    snippet: prettyTopic(topicId),
    timestamp,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    ...(membersOnly ? { membersOnly: true } : {}),
    ...(!membersOnly && v.live_viewers != null ? { liveViewers: v.live_viewers } : {}),
  };
}

/**
 * 곡 아카이브를 KV에 영구 누적한다.
 *
 * /api/feed의 다른 조회(라이브·예정·최근 영상)는 "현재 시점 기준 최근 것"만
 * 다시 받아오는 스냅샷이라 오래된 항목이 자연히 밀려난다. 곡은 그러면 안 되므로
 * (사용자가 무한 누적을 요청했다) 별도로 KV에 쌓아 올린다.
 *
 * KV가 비어 있으면(최초 배포 시) 저장소에 커밋된 정적 아카이브(seedSongs)로
 * 부트스트랩한다 — npm run setup:songs로 미리 모아둔 초기 데이터.
 * 새 곡이 없으면 KV에 쓰지 않는다(무료 쓰기 한도 하루 1,000회를 아끼기 위해).
 */
async function accumulateMusicArchive(kv, freshMusic, debugOut) {
  let archive;
  try {
    const stored = kv ? await kv.get(MUSIC_ARCHIVE_KEY, 'json') : null;
    archive = Array.isArray(stored) ? stored : seedSongs;
  } catch (e) {
    if (debugOut) debugOut.archiveReadError = e.message;
    archive = seedSongs;
  }

  const seen = new Set(archive.map((s) => s.id));
  const additions = freshMusic.filter((s) => !seen.has(s.id));

  let result = archive;
  if (additions.length > 0) {
    result = [...additions, ...archive]
      .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
      .slice(0, MUSIC_ARCHIVE_CAP);
  }

  if (debugOut) {
    debugOut.archiveBaseSize = archive.length;
    debugOut.archiveAdditions = additions.length;
    debugOut.archiveFinalSize = result.length;
  }

  return { archive: result, dirty: additions.length > 0 };
}

async function buildFeed(env, debug) {
  const apiKey = env.HOLODEX_API_KEY;
  const diagnostics = {};

  // 1) 라이브 + 예정 (우리 채널만 대상으로 하는 캐시된 조회)
  const livePromise = holodex(`/users/live?channels=${CHANNEL_IDS.join(',')}`, apiKey)
    .then((r) => (Array.isArray(r) ? r : []))
    .catch((e) => {
      diagnostics.liveError = e.message;
      return [];
    });

  // 2) 최근 지난 영상 (org 단위로 받아 우리 멤버만 걸러냄 — 호출 1회로 해결)
  const pastPromise = holodex(
    `/videos?org=Hololive&status=past&limit=${PAST_VIDEO_LIMIT}&sort=available_at&order=desc`,
    apiKey
  )
    .then((r) => (Array.isArray(r) ? r : []))
    .catch((e) => {
      diagnostics.pastError = e.message;
      return [];
    });

  // 3) 음악 전용 조회.
  // 2)는 org 전체에서 최근 50건만 받아 거르는 구조라 곡이 쉽게 밀려난다.
  // 커버와 오리지널은 토픽이 나뉘어 있어 둘 다 가져온다.
  const musicPromise = Promise.all(
    ['Music_Cover', 'Original_Song'].map((topic) =>
      holodex(
        `/videos?org=Hololive&topic=${topic}&status=past&limit=${MUSIC_LIMIT}&sort=available_at&order=desc`,
        apiKey
      ).catch((e) => {
        diagnostics.musicError = e.message;
        return [];
      })
    )
  ).then((lists) => lists.flat().filter(Boolean));

  const [live, past, music] = await Promise.all([livePromise, pastPromise, musicPromise]);

  const all = [...live, ...past, ...music];

  // id 기준 중복 제거 (세 목록이 서로 겹칠 수 있음)
  const seen = new Set();
  const notifications = [];
  for (const v of all) {
    const n = toNotification(v);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    notifications.push(n);
  }

  if (debug) {
    diagnostics.liveRaw = live.length;
    diagnostics.pastRaw = past.length;
    diagnostics.musicRaw = music.length;
    diagnostics.mappedChannels = CHANNEL_IDS.length;
    diagnostics.excludedByTopic = all.filter((v) =>
      EXCLUDED_TOPICS.has(String(v.topic_id ?? '').toLowerCase())
    ).length;
    diagnostics.notOurMember = all.filter(
      (v) => !MEMBER_BY_CHANNEL[v.channel?.id ?? v.channel_id]
    ).length;
    diagnostics.topicsSeen = [...new Set(all.map((v) => v.topic_id).filter(Boolean))];
    diagnostics.result = {
      total: notifications.length,
      live: notifications.filter((n) => n.status === 'live').length,
      upcoming: notifications.filter((n) => n.status === 'upcoming').length,
      past: notifications.filter((n) => n.status === 'past').length,
      music: notifications.filter((n) => n.type === 'music').length,
    };
    diagnostics.furthestUpcoming = notifications
      .filter((n) => n.status === 'upcoming')
      .map((n) => n.timestamp)
      .sort()
      .pop();
  }

  // 업스트림이 전부 실패했으면 빈 응답 대신 에러로 처리해서
  // 프론트가 '갱신 실패'로 인식하고 이전 데이터를 유지하게 한다
  if (notifications.length === 0 && (diagnostics.liveError || diagnostics.pastError)) {
    throw new Error(diagnostics.liveError ?? diagnostics.pastError);
  }

  const freshMusic = notifications.filter((n) => n.type === 'music');
  const { archive: musicArchive, dirty: archiveDirty } = await accumulateMusicArchive(
    env.MUSIC_ARCHIVE,
    freshMusic,
    debug ? diagnostics : null
  );

  return {
    updatedAt: new Date().toISOString(),
    notifications,
    music: musicArchive,
    _archiveDirty: archiveDirty, // fetch 핸들러가 KV 쓰기 여부를 판단하는 데만 씀
    ...(debug ? { _debug: diagnostics } : {}),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname !== '/api/feed') {
      return new Response('Not Found', { status: 404, headers: cors });
    }

    if (!env.HOLODEX_API_KEY) {
      return Response.json(
        { error: 'HOLODEX_API_KEY 미설정. wrangler secret put HOLODEX_API_KEY 를 실행하세요.' },
        { status: 500, headers: cors }
      );
    }

    const debug = url.searchParams.get('debug') === '1';

    // 엣지 캐시 (debug 요청은 캐시하지 않음)
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/api/feed`, { method: 'GET' });

    if (!debug) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
        res.headers.set('X-Cache', 'HIT');
        return res;
      }
    }

    try {
      const feed = await buildFeed(env, debug);
      const { _archiveDirty, ...publicFeed } = feed;
      const body = JSON.stringify(publicFeed);

      // 새 곡을 찾았을 때만 KV에 쓴다 (무료 쓰기 한도 하루 1,000회를 아끼기 위해)
      if (_archiveDirty && env.MUSIC_ARCHIVE) {
        ctx.waitUntil(env.MUSIC_ARCHIVE.put(MUSIC_ARCHIVE_KEY, JSON.stringify(publicFeed.music)));
      }

      if (!debug) {
        const cacheable = new Response(body, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
          },
        });
        ctx.waitUntil(cache.put(cacheKey, cacheable));
      }

      return new Response(body, {
        headers: {
          ...cors,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
          'X-Cache': 'MISS',
        },
      });
    } catch (err) {
      // 업스트림 장애 — 프론트가 '갱신 실패'로 처리하고 이전 데이터를 유지한다
      return Response.json({ error: String(err.message ?? err) }, { status: 502, headers: cors });
    }
  },
};
