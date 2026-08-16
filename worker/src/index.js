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
import seedInteractions from '../../src/data/memberInteractions.json';
import seedStreams from '../../src/data/memberStreams.json';
import { findCommonTopic } from '../../src/lib/topicExtract.js';

const HOLODEX = 'https://holodex.net/api/v2';
const CACHE_SECONDS = 60;
const PAST_VIDEO_LIMIT = 50;
const MUSIC_LIMIT = 25;
const COLLAB_LIMIT = 50;

// 곡 아카이브(무한 누적)의 안전 상한. KV 값 크기(25MB)에는 한참 못 미치지만,
// 응답 payload가 끝없이 커지는 걸 막는다. 39명 x 활동량 기준 수년 치 분량.
const MUSIC_ARCHIVE_CAP = 5000;
const MUSIC_ARCHIVE_KEY = 'music-archive-v1';

// 합방 아카이브도 같은 KV 바인딩에 키만 다르게 저장한다 (KV를 새로 만들지 않음)
const INTERACTIONS_ARCHIVE_CAP = 3000;
const INTERACTIONS_ARCHIVE_KEY = 'interactions-archive-v1';

// 지난 라이브(방송) 아카이브. 음악과 마찬가지로 /api/feed의 일반 조회는
// 최근 스냅샷이라 오래된 방송이 자연히 밀려나므로, LIVE 탭에서 "지난 라이브"를
// 계속 볼 수 있도록 KV에 따로 누적한다.
const STREAM_ARCHIVE_CAP = 5000;
const STREAM_ARCHIVE_KEY = 'stream-archive-v1';

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
 * Holodex 영상 하나에서 합방 기록을 뽑는다. 합방이 아니면 null.
 *
 * 판정 규칙 (실측으로 검증됨 — docs/DESIGN-interactions.md 2절):
 *  - 업로더가 우리가 추적하는 멤버여야 한다. 이걸 빼면 팬 클립 채널이
 *    두 멤버를 언급한 영상이 전부 "합방"으로 잡힌다 (실측 10건 중 10건 오탐).
 *  - mentions에 걸린 다른 추적 멤버를 참가자로 본다.
 *  - 참가자가 2명 미만이면 합방이 아니다.
 */
function toInteraction(v) {
  const owner = MEMBER_BY_CHANNEL[v.channel?.id ?? v.channel_id];
  if (!owner) return null;

  const participants = new Set([owner]);
  for (const m of v.mentions ?? []) {
    const id = MEMBER_BY_CHANNEL[m.id];
    if (id) participants.add(id);
  }
  if (participants.size < 2) return null;

  const topicId = String(v.topic_id ?? '').toLowerCase();
  return {
    id: `yt:${v.id}`,
    type: MUSIC_TOPICS.has(topicId) ? 'cover' : 'collab',
    participants: [...participants].sort(),
    count: 1,
    lastDate: String(v.available_at ?? v.published_at ?? '').slice(0, 10),
    title: v.title ?? '',
    url: `https://www.youtube.com/watch?v=${v.id}`,
  };
}

/**
 * 지금 방송 중인 합방을 그룹 단위로 묶는다.
 *
 * 주제는 참가자들이 각자 방송 제목에 공통으로 걸어둔 태그에서 뽑는다.
 * 한 명만 방송을 켜고 나머지를 mentions에 태그한 경우엔 비교할 제목이
 * 하나뿐이라 공통 태그를 못 찾을 수 있고, 그때는 topic이 null이 된다
 * (프론트에서 "합동 방송"으로 대체).
 */
function buildLiveCollabs(liveList) {
  // 멤버별로 지금 켜고 있는 방송 제목 (주제 교집합 계산용)
  const titleByMember = new Map();
  for (const v of liveList) {
    if (v.status !== 'live') continue;
    const owner = MEMBER_BY_CHANNEL[v.channel?.id ?? v.channel_id];
    if (owner) titleByMember.set(owner, v.title ?? '');
  }

  const groups = [];
  const seenKeys = new Set();

  for (const v of liveList) {
    if (v.status !== 'live') continue;
    const iv = toInteraction(v);
    if (!iv) continue;

    // 같은 합방을 참가자들이 각자 방송하면 여러 영상이 같은 참가자 집합을
    // 만든다. 같은 집합은 한 그룹으로만 표시한다.
    const key = iv.participants.join('|');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const titles = iv.participants.map((id) => titleByMember.get(id)).filter(Boolean);
    groups.push({
      videoId: v.id,
      topic: findCommonTopic(titles),
      participants: iv.participants,
    });
  }

  return groups;
}

/**
 * 아카이브를 KV에 영구 누적한다 (곡·합방 공용).
 *
 * /api/feed의 일반 조회(라이브·예정·최근 영상)는 "현재 시점 기준 최근 것"만
 * 다시 받아오는 스냅샷이라 오래된 항목이 자연히 밀려난다. 곡과 합방 기록은
 * 그러면 안 되므로 별도로 KV에 쌓아 올린다.
 *
 * KV가 비어 있으면(최초 배포 시) 저장소에 커밋된 정적 시드로 부트스트랩한다
 * — npm run setup:songs / setup:interactions로 미리 모아둔 초기 데이터.
 * 새 항목이 없으면 KV에 쓰지 않는다(무료 쓰기 한도 하루 1,000회를 아끼기 위해).
 */
async function accumulateArchive({ kv, key, seed, fresh, sortKey, cap, debugOut, debugPrefix }) {
  let archive;
  try {
    const stored = kv ? await kv.get(key, 'json') : null;
    archive = Array.isArray(stored) ? stored : seed;
  } catch (e) {
    if (debugOut) debugOut[`${debugPrefix}ReadError`] = e.message;
    archive = seed;
  }

  const seen = new Set(archive.map((s) => s.id));
  const additions = fresh.filter((s) => !seen.has(s.id));

  let result = archive;
  if (additions.length > 0) {
    result = [...additions, ...archive]
      .sort((a, b) => String(b[sortKey] ?? '').localeCompare(String(a[sortKey] ?? '')))
      .slice(0, cap);
  }

  if (debugOut) {
    debugOut[`${debugPrefix}BaseSize`] = archive.length;
    debugOut[`${debugPrefix}Additions`] = additions.length;
    debugOut[`${debugPrefix}FinalSize`] = result.length;
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

  // 4) 합방 감지용 조회.
  // 2)와 달리 type=stream으로 좁힌다 — 그래야 팬 클립 채널이 걸러지고,
  // 같은 50건 안에 실제 방송이 더 많이 담긴다. mentions로 참가자를 뽑는다.
  const collabPastPromise = holodex(
    `/videos?org=Hololive&status=past&type=stream&limit=${COLLAB_LIMIT}` +
      `&include=mentions&sort=available_at&order=desc`,
    apiKey
  )
    .then((r) => (Array.isArray(r) ? r : []))
    .catch((e) => {
      diagnostics.collabPastError = e.message;
      return [];
    });

  // 5) 지금 방송 중/예정인 합방. /live는 기본이 type=stream, status=[live,upcoming]이다.
  //    (/live?status=past는 API가 거부한다)
  const collabLivePromise = holodex(`/live?org=Hololive&include=mentions`, apiKey)
    .then((r) => (Array.isArray(r) ? r : []))
    .catch((e) => {
      diagnostics.collabLiveError = e.message;
      return [];
    });

  const [live, past, music, collabPast, collabLive] = await Promise.all([
    livePromise,
    pastPromise,
    musicPromise,
    collabPastPromise,
    collabLivePromise,
  ]);

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

  // ---- 합방 추출 ----
  // 지난 방송 + 지금 라이브 중인 방송에서 뽑는다. 예정(upcoming)은 아직
  // 일어나지 않았으므로 아카이브에 넣지 않는다.
  const freshInteractions = [];
  const seenInteraction = new Set();
  for (const v of [...collabPast, ...collabLive]) {
    if (v.status === 'upcoming') continue;
    const iv = toInteraction(v);
    if (!iv || seenInteraction.has(iv.id)) continue;
    seenInteraction.add(iv.id);
    freshInteractions.push(iv);
  }

  const liveCollabs = buildLiveCollabs(collabLive);

  const freshMusic = notifications.filter((n) => n.type === 'music');
  // 지난 라이브: 곡(music)이나 업로드 영상(video)이 아니라 실제 방송이었던 것만.
  // upcoming/live는 아직 "지난" 게 아니므로 past만 아카이브에 넣는다.
  const freshStreams = notifications.filter((n) => n.type === 'stream' && n.status === 'past');

  const [musicResult, interactionResult, streamResult] = await Promise.all([
    accumulateArchive({
      kv: env.MUSIC_ARCHIVE,
      key: MUSIC_ARCHIVE_KEY,
      seed: seedSongs,
      fresh: freshMusic,
      sortKey: 'timestamp',
      cap: MUSIC_ARCHIVE_CAP,
      debugOut: debug ? diagnostics : null,
      debugPrefix: 'musicArchive',
    }),
    accumulateArchive({
      kv: env.MUSIC_ARCHIVE,
      key: INTERACTIONS_ARCHIVE_KEY,
      seed: seedInteractions,
      fresh: freshInteractions,
      sortKey: 'lastDate',
      cap: INTERACTIONS_ARCHIVE_CAP,
      debugOut: debug ? diagnostics : null,
      debugPrefix: 'interactionArchive',
    }),
    accumulateArchive({
      kv: env.MUSIC_ARCHIVE,
      key: STREAM_ARCHIVE_KEY,
      seed: seedStreams,
      fresh: freshStreams,
      sortKey: 'timestamp',
      cap: STREAM_ARCHIVE_CAP,
      debugOut: debug ? diagnostics : null,
      debugPrefix: 'streamArchive',
    }),
  ]);

  if (debug) {
    diagnostics.collabPastRaw = collabPast.length;
    diagnostics.collabLiveRaw = collabLive.length;
    diagnostics.freshInteractions = freshInteractions.length;
    diagnostics.freshStreams = freshStreams.length;
    diagnostics.liveCollabs = liveCollabs;
  }

  return {
    updatedAt: new Date().toISOString(),
    notifications,
    music: musicResult.archive,
    interactions: interactionResult.archive,
    streams: streamResult.archive,
    liveCollabs,
    // fetch 핸들러가 KV 쓰기 여부를 판단하는 데만 쓴다 (응답에서는 제거됨)
    _dirty: { music: musicResult.dirty, interactions: interactionResult.dirty, streams: streamResult.dirty },
    ...(debug ? { _debug: diagnostics } : {}),
  };
}

/** 새 항목이 있을 때만 KV에 쓴다. fetch와 scheduled 양쪽에서 쓴다. */
function persistArchives(env, feed, ctx) {
  if (!env.MUSIC_ARCHIVE) return;
  if (feed._dirty?.music) {
    ctx.waitUntil(env.MUSIC_ARCHIVE.put(MUSIC_ARCHIVE_KEY, JSON.stringify(feed.music)));
  }
  if (feed._dirty?.interactions) {
    ctx.waitUntil(
      env.MUSIC_ARCHIVE.put(INTERACTIONS_ARCHIVE_KEY, JSON.stringify(feed.interactions))
    );
  }
  if (feed._dirty?.streams) {
    ctx.waitUntil(env.MUSIC_ARCHIVE.put(STREAM_ARCHIVE_KEY, JSON.stringify(feed.streams)));
  }
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
      persistArchives(env, feed, ctx);

      const { _dirty, ...publicFeed } = feed;
      const body = JSON.stringify(publicFeed);

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

  /**
   * Cron 안전망. 요청 시점 폴링만으로는 방문자가 없는 시간대에 올라온 합방·곡을
   * 놓칠 수 있어서, 주기적으로 직접 조회해 아카이브에 채워 넣는다.
   * (스케줄은 wrangler.toml의 [triggers] 참고 — JST 08~22시 2시간 간격)
   */
  async scheduled(event, env, ctx) {
    if (!env.HOLODEX_API_KEY) return;
    ctx.waitUntil(
      buildFeed(env, false)
        .then((feed) => persistArchives(env, feed, ctx))
        .catch((err) => console.error('scheduled refresh failed:', err.message ?? err))
    );
  },
};
