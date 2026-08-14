/**
 * HOLONET 피드 Worker
 *
 * GET /api/feed  → 멤버들의 YouTube 활동(라이브/예정/음악/영상)을 정규화해 반환
 * GET /api/feed?debug=1 → 업스트림 응답 진단 정보 포함
 *
 * Holodex API 키는 secret(HOLODEX_API_KEY)에 있으며 응답에 절대 포함되지 않는다.
 */

import channelIds from '../../src/data/channelIds.json';

const HOLODEX = 'https://holodex.net/api/v2';
const CACHE_SECONDS = 60;
const PAST_VIDEO_LIMIT = 50;

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

/** Holodex 영상 하나를 우리 알림 스키마로 변환. 우리 멤버가 아니면 null. */
function toNotification(v) {
  const channelId = v.channel?.id ?? v.channel_id;
  const memberId = MEMBER_BY_CHANNEL[channelId];
  if (!memberId) return null;

  // Holodex status: live | upcoming | past | new | missing
  const status = v.status === 'live' || v.status === 'upcoming' ? v.status : 'past';

  // 음악 여부는 topic_id로 판별 (커버 + 오리지널 신곡)
  const isMusic = v.topic_id === 'singing' || v.topic_id === 'music_cover' || v.topic_id === 'original_song';
  const type = isMusic ? 'music' : v.type === 'stream' ? 'stream' : 'video';

  // 라이브/예정은 시작(예정) 시각, 지난 건 공개 시각
  const timestamp = v.start_actual ?? v.start_scheduled ?? v.available_at ?? v.published_at;

  return {
    id: `yt:${v.id}`,
    memberId,
    type,
    status,
    title: v.title ?? '',
    snippet: v.topic_id ?? v.channel?.english_name ?? v.channel?.name ?? '',
    timestamp,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    ...(v.live_viewers != null ? { liveViewers: v.live_viewers } : {}),
  };
}

async function buildFeed(apiKey, debug) {
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

  const [live, past] = await Promise.all([livePromise, pastPromise]);

  if (debug) {
    diagnostics.liveRaw = live.length;
    diagnostics.pastRaw = past.length;
    diagnostics.mappedChannels = CHANNEL_IDS.length;
  }

  // id 기준 중복 제거 (라이브 목록과 지난 목록이 겹칠 수 있음)
  const seen = new Set();
  const notifications = [];
  for (const v of [...live, ...past]) {
    const n = toNotification(v);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    notifications.push(n);
  }

  // 업스트림이 둘 다 실패했으면 빈 응답 대신 에러로 처리해서
  // 프론트가 '갱신 실패'로 인식하고 이전 데이터를 유지하게 한다
  if (notifications.length === 0 && (diagnostics.liveError || diagnostics.pastError)) {
    throw new Error(diagnostics.liveError ?? diagnostics.pastError);
  }

  return {
    updatedAt: new Date().toISOString(),
    notifications,
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
      const feed = await buildFeed(env.HOLODEX_API_KEY, debug);
      const body = JSON.stringify(feed);

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
