/**
 * 방송 제목에서 주제 태그를 뽑는다.
 *
 * 합방 주제를 정확히 알아내려면 자연어 분석이 필요하지만, 폴링마다 그럴 수는
 * 없다. 대신 홀로라이브 방송 제목이 관례적으로 【 】 / 「 」 / [ ] 안에
 * 기획명·게임명을 넣는다는 점을 이용한다.
 *
 *   "【マイクラ夏鯖】新エリア開拓!【ホロライブ/白上フブキ】"
 *   → ["マイクラ夏鯖", "新エリア開拓", "ホロライブ/白上フブキ"] 중 노이즈 제거
 *
 * 완벽하지 않다. 태그가 없거나 참가자끼리 겹치는 태그가 없으면 null을 돌려주고,
 * 호출부에서 "합동 방송" 같은 기본 문구로 대체한다.
 */

// 멤버 이름·소속처럼 주제가 될 수 없는 태그는 버린다.
// (제목 끝의 "【ホロライブ/白上フブキ】" 같은 서명 부분)
const NOISE = /ホロライブ|hololive|holo\s*live|ホロlive|dev_is|regloss|flow\s*glow|切り抜き/i;

// 너무 짧거나 긴 건 주제로 보기 어렵다
const MIN_LEN = 2;
const MAX_LEN = 24;

/** 제목에서 괄호 태그를 뽑아 정규화한 배열로 돌려준다. */
export function extractTags(title) {
  if (!title) return [];
  const matches = String(title).matchAll(/[【\[「]([^】\]」]+)[】\]」]/g);
  const out = [];
  const seen = new Set();

  for (const m of matches) {
    const raw = m[1].trim();
    if (raw.length < MIN_LEN || raw.length > MAX_LEN) continue;
    if (NOISE.test(raw)) continue;

    // "#" 해시태그 표기나 잉여 공백을 정리
    const tag = raw.replace(/^#+/, '').trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * 여러 제목에서 공통으로 등장하는 태그를 찾는다.
 * 전원이 공유하는 태그가 없으면, 과반이 공유하는 태그라도 찾아본다
 * (합방인데 한두 명만 기획명을 안 붙이는 경우가 흔하다).
 * 그래도 없으면 null.
 */
export function findCommonTopic(titles) {
  const lists = titles.map(extractTags).filter((l) => l.length > 0);
  if (lists.length === 0) return null;

  const count = new Map(); // 정규화 키 -> { tag(원문), n }
  for (const tags of lists) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      const cur = count.get(key);
      if (cur) cur.n += 1;
      else count.set(key, { tag, n: 1 });
    }
  }

  const needAll = lists.length;
  const needMost = Math.max(2, Math.ceil(lists.length / 2));

  let best = null;
  for (const { tag, n } of count.values()) {
    if (n < needMost) continue;
    // 더 많이 겹치는 태그 우선, 같으면 더 긴 쪽(구체적인 쪽)
    if (!best || n > best.n || (n === best.n && tag.length > best.tag.length)) {
      best = { tag, n };
    }
  }

  if (!best) return null;
  // 전원 공유가 아니어도 과반이면 채택하되, 1명짜리는 위에서 이미 걸러짐
  return best.n >= Math.min(needAll, needMost) ? best.tag : null;
}
