import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { AnimatePresence } from 'framer-motion';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import MemberTooltip from './MemberTooltip.jsx';
import InteractionTooltip from './InteractionTooltip.jsx';
import { asset } from '../../lib/asset.js';

const NODE_RADIUS = 24;

// 이 횟수 미만으로 함께한 쌍은 선을 그리지 않는다.
// (한 번 스쳐간 조합까지 다 그리면 39명 그래프가 실뭉치가 된다)
// 백필 데이터(349건)로 실측: 2회 기준 383개 선(가능한 쌍의 52%)은 너무 빽빽해서
// 3회로 올렸다 — 296개로 줄고 가로 분포도 더 좋아짐(71%→96%), 새로 고립되는
// 멤버도 없음(하아토는 어느 기준에서도 고립 — raise가 원인이 아님).
const MIN_EDGE_EVENTS = 3;

// 선을 "진하게" 계산할 때 후보로 넣을 최소 횟수. 이보다 적게 함께한 쌍은
// 어느 노드 기준으로도 항상 옅게 남는다(노드별 상대 순위 계산에서 제외).
const LOCAL_MIN_COUNT = 5;

// 합방 중 붙는 거리. 클릭 가능하도록 노드가 완전히 겹치지는 않게 둔다.
const LIVE_PAIR_DISTANCE = 85;
const HUB_SPOKE_DISTANCE = 78;
const LIVE_LINK_STRENGTH = 0.9;

/*
 * 첫 화면은 "전부 한 화면에"가 아니라 "읽을 수 있는 배율"로 시작한다.
 *
 * 관계가 거리로 제대로 드러나려면 배치를 넓게 써야 하는데(LINK_DISTANCE_* 주석 참고),
 * 그러면 배치가 화면보다 훨씬 커진다. 이걸 억지로 다 담으면 배율이 0.11~0.25까지
 * 떨어져 라벨이 1~3px이 되어 아무것도 못 읽는다.
 * 그래서 읽히는 배율로 시작하고 팬·핀치로 탐색하게 한다.
 * 전체 조망이 필요하면 리셋 버튼이 맞춤 배율로 되돌린다.
 */
const MOBILE_MAX_WIDTH = 768;
const INITIAL_SCALE = 0.85;

// 모바일 배치 배율의 하한. 화면이 좁다고 배치까지 좁히면 관계 표현이 뭉개진다.
const MOBILE_SPREAD_FLOOR = 1.2;

// 배치가 화면보다 훨씬 커서, 리셋(전체 맞춤)이 0.11까지 내려갈 수 있어야 한다.
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.5;

// 노드를 탭했을 때 이웃까지 담되, 최소한 이 배율(=라벨이 읽히는 크기)은 지킨다.
const FOCUS_MIN_SCALE = 0.9;

/*
 * 링크 목표 거리 범위(가장 가까운 사이 ~ 무관계). spread가 곱해진다.
 *
 * 배치를 좁게 잡으면 거리들이 충돌 하한(96)에 눌려 관계가 뭉개진다.
 * 넓힐수록 거리가 관계로만 정해지는데, 실측상 이렇게 움직인다:
 *   70~580   역전 4.8%  충돌하한에 눌린 쌍 44.2개
 *   180~1500 역전 3.6%  눌린 쌍  1.4개   <- 채택
 *   250~2000 역전 3.0%  눌린 쌍  0.2개
 * 250~2000이 수치는 가장 좋지만 배치가 3800px까지 커져 팬 이동이 과하다.
 * 180~1500이면 충실도는 거의 그대로면서 배치가 30% 작아진다.
 */
const LINK_DISTANCE_MIN = 180;
const LINK_DISTANCE_MAX = 1500;

/*
 * 화면에 실제로 그리는 선: 각 멤버의 상위 몇 명까지만.
 *
 * 물리 계산에는 모든 쌍이 들어가므로(아래 physicsLinks) 선을 줄여도 배치는
 * 전혀 달라지지 않는다 — 순수하게 시각적 정리다.
 * 기준(3회 이상)대로 다 그리면 491개, 노드당 평균 25개라 화면이 거미줄이 된다.
 * top4면 117개 / 노드당 6개로 줄고, 전역 임곗값과 달리 활동이 적은 멤버도
 * 자기 핵심 관계선은 유지한다.
 */
const DRAWN_TOP_N = 4;

// 함께한 기록이 없는 쌍을 서로 밀어내는 스프링 세기.
// 이게 없으면 무관계 쌍이 충돌 하한까지 붙는다(실측 거리 96).
const UNRELATED_STRENGTH = 0.3;

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * interactions -> 쌍별 원본 합방/커버 횟수 + 이벤트 목록.
 *
 * 예전엔 시간 감쇠를 적용한 "친밀도 점수"로 거리를 정했는데, 그러면 전체
 * 그래프에서의 절대적인 점수 크기가 아니라 "이 멤버 기준으로 누가 가장
 * 자주 함께했는가"가 거리에 반영되지 않는 문제가 있었다(예: 오래 활동한
 * 멤버의 특정 파트너가 절대 횟수는 낮아도 그 멤버에겐 압도적 1위인 경우).
 * 그래서 거리·장력·선 굵기는 전부 원본 횟수(count) 기반의 "노드별 상대
 * 순위"로 계산한다 — 아래 buildLocalRanks 참고.
 */
function buildPairStats(interactions) {
  const rawCounts = new Map();
  const pairEvents = new Map();

  interactions.forEach((ev) => {
    const parts = ev.participants ?? [];
    const n = parts.length;
    if (n < 2) return;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = pairKey(parts[i], parts[j]);

        const counts = rawCounts.get(key) || { collabCount: 0, coverCount: 0, total: 0 };
        if (ev.type === 'cover') counts.coverCount += ev.count ?? 1;
        else counts.collabCount += ev.count ?? 1;
        counts.total += ev.count ?? 1;
        rawCounts.set(key, counts);

        if (!pairEvents.has(key)) pairEvents.set(key, []);
        pairEvents.get(key).push(ev);
      }
    }
  });

  // 팝업에서 최신순으로 보여준다
  for (const list of pairEvents.values()) {
    list.sort((a, b) => String(b.lastDate ?? '').localeCompare(String(a.lastDate ?? '')));
  }

  return { rawCounts, pairEvents };
}

/**
 * 링크 목록(각 {source, target, count})에서 "노드별 상대 순위 점수"를 만든다.
 * 한 노드의 이웃들을 횟수 내림차순으로 줄 세워 1등=1.0, 꼴찌=0.0으로 매긴다.
 * (절대 횟수가 아니라 그 노드 안에서의 등수를 쓰기 때문에, 오래 활동해서
 * 전체적으로 합방 횟수가 많은 멤버의 그래프가 상대적으로 부풀지 않는다 — 점 1, 2.)
 *
 * minCount 미만인 이웃은 후보에서 아예 뺀다(순위 계산 자체에 안 낀다).
 */
function buildLocalRanks(baseLinks, minCount) {
  const adj = new Map();
  for (const l of baseLinks) {
    if (l.count < minCount) continue;
    if (!adj.has(l.source)) adj.set(l.source, []);
    if (!adj.has(l.target)) adj.set(l.target, []);
    adj.get(l.source).push({ other: l.target, count: l.count });
    adj.get(l.target).push({ other: l.source, count: l.count });
  }

  const rank = new Map(); // `${node}|${other}` -> 0~1 (1이 그 노드의 최다 합방 상대)
  for (const [node, neighbors] of adj) {
    const sorted = [...neighbors].sort((a, b) => b.count - a.count);
    const n = sorted.length;
    sorted.forEach((nb, idx) => {
      rank.set(`${node}|${nb.other}`, n <= 1 ? 1 : 1 - idx / (n - 1));
    });
  }
  return rank;
}

/** 링크 양쪽 노드 중 어느 한쪽이라도 상대를 상위로 친다면 그 링크도 그렇게 대접한다. */
function localScore(rankMap, aId, bId) {
  return Math.max(rankMap.get(`${aId}|${bId}`) ?? 0, rankMap.get(`${bId}|${aId}`) ?? 0);
}

/**
 * 양방향 순위의 기하평균 = "서로에게 얼마나 중요한 사이인가".
 *
 * 관계는 비대칭이다. 활동량이 다르면 같은 횟수라도 순위가 갈린다
 * (실측: 후부키-토와 15회인데 토와에겐 1위, 후부키에겐 19/33위).
 * 그런데 거리는 하나뿐이라 한쪽 입장만 반영할 수 없다.
 *
 * 예전엔 max를 썼는데, 그러면 "누군가 나를 1위로 꼽으면 무조건 옆에 붙는다"가 되어
 * 인기 많은 멤버 주변으로 다들 몰리고, 순위가 한두 계단 바뀔 때 거리가 확 튀었다.
 * 기하평균은 양쪽이 모두 중요하게 여길 때만 가까워지고, 한쪽만의 짝사랑은
 * 중간 거리에 놓인다 — 하나의 거리로 표현할 수 있는 가장 정직한 값이다.
 *
 * 실측(같은 횟수 쌍의 거리 편차 / 역전율): max 0.399·3.2% -> 기하평균 0.364·2.9%
 * (코사인·자카드처럼 활동량으로 나누는 방식도 재봤지만 역전율이 20%로 뛰어 탈락)
 */
function mutualScore(rankMap, aId, bId) {
  const ab = rankMap.get(`${aId}|${bId}`) ?? 0;
  const ba = rankMap.get(`${bId}|${aId}`) ?? 0;
  return Math.sqrt(ab * ba);
}

const EMPTY_SET = new Set();
const EMPTY_ARRAY = [];

export default function NetworkGraph({
  members,
  interactions,
  liveMemberIds = EMPTY_SET,
  liveCollabs = EMPTY_ARRAY,
  selectedMemberId,
  onSelectMember,
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // { member, connections, x, y }
  const [edgeTooltip, setEdgeTooltip] = useState(null); // { pair, events, x, y }
  const selectedIdRef = useRef(null);
  const applyHighlightRef = useRef(null);
  const updateLiveBadgesRef = useRef(null);
  const updateLiveCollabsRef = useRef(null);
  // MemberTooltip에 노출된 reposition()을 직접 호출하는 용도.
  // 위치를 React state로 두면 시뮬레이션이 도는 동안(또는 줌·팬 중) 매 프레임
  // setState가 발생해 눈에 띄게 렉이 생긴다 — MemberTooltip.jsx 주석 참고.
  const tooltipRef = useRef(null);
  // 팝업의 "자주 함께하는 멤버" 클릭 핸들러. 이펙트 안에서 만들어지는 클로저라
  // JSX(이펙트 밖)에서 부르려면 ref로 우회해야 한다 — applyHighlightRef와 같은 패턴.
  const onConnectionClickRef = useRef(null);
  // 리셋 버튼이 "전체 맞춤"으로 되돌리는 데 쓴다 (같은 이유로 ref 경유)
  const fitToViewRef = useRef(null);

  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));

  /**
   * 고정된 상위 N명이 아니라, 이 멤버의 파트너들 중 "평균 합방 횟수보다 많이
   * 함께한" 사람만 보여준다(점 3, 4). 예: 교류 횟수가 15,13,8,4,3,2,2면
   * 평균 6.7회를 넘는 15/13/8만 남는다 — 인원 수가 고정되지 않는다.
   */
  const buildConnections = useCallback(
    (memberId, rawCounts) => {
      const list = members
        .filter((m) => m.id !== memberId)
        .map((m) => {
          const counts = rawCounts.get(pairKey(memberId, m.id));
          if (!counts) return null;
          return { member: m, collabCount: counts.collabCount, coverCount: counts.coverCount, total: counts.total };
        })
        .filter(Boolean);

      if (list.length === 0) return [];
      const avg = list.reduce((sum, c) => sum + c.total, 0) / list.length;
      return list.filter((c) => c.total > avg).sort((a, b) => b.total - a.total);
    },
    [members]
  );

  // 외부(사이드바 등)에서 선택이 해제되면 그래프의 하이라이트/툴팁도 함께 초기화
  useEffect(() => {
    if (!selectedMemberId && selectedIdRef.current) {
      selectedIdRef.current = null;
      applyHighlightRef.current?.(null);
      setTooltip(null);
    }
  }, [selectedMemberId]);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const { rawCounts, pairEvents } = buildPairStats(interactions);

    const isMobile = width < MOBILE_MAX_WIDTH;

    /*
     * 배치 크기를 캔버스에 맞춰 늘리고 줄이는 배율.
     * 이게 없으면 큰 화면에서는 가운데만 쓰고, 작은 화면에서는 넘쳐난다.
     *
     * 하한을 모바일에서만 따로 두는 이유: 링크 목표 거리는 전부 spread에
     * 비례하는데 collide 반경(노드 반경 + 여백 = 48)은 절대값이라 같이 줄지
     * 않는다. 그래서 폰에서 spread가 0.8까지 떨어지면 목표 거리만 좁아지고
     * 충돌 하한(96)은 그대로라, 가까운 쌍들이 스프링이 아니라 충돌 하한에
     * 눌려 멈춰버린다. 충돌력은 친밀도와 무관하게 모두 똑같은 거리로
     * 밀어내므로 간격이 균일한 격자처럼 보이게 된다.
     *
     * 실측(7회 평균, 최근접이웃 간격 변동계수 / 충돌 하한에 눌린 쌍):
     *   하한 0.8 -> 0.118 / 67.9쌍   (데스크톱 0.220 / 27.3쌍 대비 확연히 균일)
     *   하한 1.1 -> 0.219 / 24.4쌍   (데스크톱과 거의 동일)
     *   하한 1.2 -> 0.250 / 19.7쌍   (데스크톱보다 간격 차이가 더 뚜렷)
     * 노드 크기는 그대로 두고 간격 쪽을 벌리는 방향이라 1.2를 택했다.
     */
    const spreadFloor = isMobile ? MOBILE_SPREAD_FLOOR : 0.8;
    const spread = Math.min(Math.max(Math.min(width / 920, height / 664), spreadFloor), 1.8);

    const baseNodes = members.map((m) => ({ ...m, r: NODE_RADIUS }));
    const baseById = new Map(baseNodes.map((n) => [n.id, n]));

    /*
     * 물리 계산에는 "모든 쌍"을 넣는다 (그리는 건 아래 baseLinks만).
     *
     * 예전엔 함께한 기록이 있는 쌍만 링크로 만들었는데, 그러면 무관계한 쌍에는
     * 서로 떨어뜨리는 제약이 아예 없어서 다른 노드들의 인력에 밀려 충돌 하한(96)까지
     * 붙어버렸다. 실측: 합방 0회 쌍의 최소 거리가 96인데 15회+ 쌍의 최대 거리는 483 —
     * "관계 없는 멤버가 더 가까이 보이는" 원인이 바로 이것이다.
     * 모든 쌍에 목표 거리를 주면(=MDS에 가까운 배치) 무관계 쌍도 제 자리로 밀려난다.
     */
    const memberIds = members.map((m) => m.id);
    const physicsLinks = [];
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const source = memberIds[i];
        const target = memberIds[j];
        const key = pairKey(source, target);
        physicsLinks.push({ key, source, target, count: rawCounts.get(key)?.total ?? 0 });
      }
    }
    // "관계가 있다"고 볼 쌍. 아래 순위/점수 계산의 모집단이다.
    const relatedLinks = physicsLinks.filter((l) => l.count >= MIN_EDGE_EVENTS);

    /*
     * 화면에 그리는 링크는 각 멤버의 상위 DRAWN_TOP_N 파트너만 추린 합집합.
     * physicsLinks와 같은 객체를 공유해야 forceLink가 source/target을 노드 객체로
     * 바꿔줄 때 그리기 쪽도 함께 해석된다. (물리는 여전히 모든 쌍을 쓰므로
     * 선을 줄여도 배치는 그대로다 — DRAWN_TOP_N 주석 참고)
     */
    const neighborsByNode = new Map();
    for (const l of relatedLinks) {
      if (!neighborsByNode.has(l.source)) neighborsByNode.set(l.source, []);
      if (!neighborsByNode.has(l.target)) neighborsByNode.set(l.target, []);
      neighborsByNode.get(l.source).push(l);
      neighborsByNode.get(l.target).push(l);
    }
    const drawnKeys = new Set();
    for (const ls of neighborsByNode.values()) {
      [...ls]
        .sort((a, b) => b.count - a.count)
        .slice(0, DRAWN_TOP_N)
        .forEach((l) => drawnKeys.add(l.key));
    }
    const baseLinks = relatedLinks.filter((l) => drawnKeys.has(l.key));

    /*
     * distRank: "이 노드에게 이 상대가 몇 등 파트너인가"(노드별 상대 순위).
     * visRank: LOCAL_MIN_COUNT 이상만 후보로 삼은 같은 순위 계산(선 굵기/진하기용).
     *
     * 거리는 양방향 순위의 기하평균(mutualScore)을 쓴다 — 근거는 그 함수 주석 참고.
     * 선 굵기/진하기는 예전처럼 max(localScore)를 유지한다. "마린 노드에서는
     * 페코라가 1위"처럼 한쪽 기준으로도 특별한 관계면 진하게 보여야 하기 때문이다.
     *
     * 순위는 그리는 선이 아니라 "관계가 있는 모든 쌍"에서 계산해야 한다.
     * 그리는 선만 쓰면 화면 정리(top-N)가 배치까지 바꿔버린다.
     */
    const distRank = buildLocalRanks(relatedLinks, MIN_EDGE_EVENTS);
    const visRank = buildLocalRanks(relatedLinks, LOCAL_MIN_COUNT);

    for (const l of physicsLinks) {
      if (l.count < MIN_EDGE_EVENTS) {
        l.distScore = 0;
        l.visScore = 0;
        continue;
      }
      l.distScore = mutualScore(distRank, l.source, l.target);
      l.visScore = localScore(visRank, l.source, l.target);
    }

    // distScore(0~1, 1=가장 가까운 사이)를 거리로 환산.
    // 범위는 배치 전체 크기가 예전과 비슷하게 유지되도록 실측으로 맞췄다
    // (70~580이면 데스크톱 맞춤 배율 0.76 / 라벨 8.8px로 기존과 사실상 동일).
    const distanceScale = (score) =>
      LINK_DISTANCE_MAX * spread - (LINK_DISTANCE_MAX - LINK_DISTANCE_MIN) * spread * score;

    // visScore는 후보에서 빠지면(둘 다 LOCAL_MIN_COUNT 미만) 0이라 자동으로 옅게 남는다.
    // 지수 곡선(4제곱)으로 1등만 확실히 두드러지게 한다.
    const linkWidthScale = (score) => 1 + (4.5 - 1) * Math.pow(score, 4);
    const linkOpacityScale = (score) => 0.05 + (0.85 - 0.05) * Math.pow(score, 4);
    // 무관계 쌍(0점)은 "먼 거리를 유지하라"는 약한 스프링으로 밀어낸다.
    const linkStrengthScale = (score) =>
      score === 0 ? UNRELATED_STRENGTH : 0.1 + 0.9 * score * score;

    // 라이브 합방으로 추가되는 허브 노드. 살아있는 동안 같은 객체를 유지해야
    // 좌표가 보존된다.
    const hubNodes = new Map();
    let nodes = [...baseNodes];
    // links = 화면에 그리는 것, simLinks = 물리 계산에 넣는 것(무관계 쌍 포함)
    let links = [...baseLinks];
    let simLinks = [...physicsLinks];
    let lastCollabSignature = '';

    const svg = d3.select(svgEl).attr('viewBox', [0, 0, width, height]);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const root = svg.append('g').attr('class', 'zoom-root');

    // 워터마크 로고: 월드 좌표에 고정된 커다란 배경. 카메라(줌/팬)만 그 위를 움직인다.
    const MARK_ASPECT = 235 / 800;
    const markWidth = width * 1.6;
    const markHeight = markWidth * MARK_ASPECT;
    root
      .append('image')
      .attr('class', 'watermark')
      .attr('href', asset('/bg/hololive-mark.png'))
      .attr('x', width / 2 - markWidth / 2)
      .attr('y', height / 2 - markHeight / 2)
      .attr('width', markWidth)
      .attr('height', markHeight)
      // 원본은 팔레트 PNG에 알파가 없어 흰 배경이 사각형으로 드러났다.
      // scripts/make-logo-transparent.mjs로 tRNS를 넣어 누끼를 딴 파일을 쓴다.
      // opacity는 테마별로 달라서 index.css에서 지정한다.
      .style('pointer-events', 'none');

    const linkLayer = root.append('g').attr('class', 'links');
    // 선은 얇아서 그대로는 클릭하기 어렵다. 투명한 굵은 선을 위에 깔아 히트 영역으로 쓴다.
    const hitLayer = root.append('g').attr('class', 'link-hits');
    const nodeLayer = root.append('g').attr('class', 'nodes');

    let linkSel = linkLayer.selectAll('line');
    let hitSel = hitLayer.selectAll('line');
    let nodeSel = nodeLayer.selectAll('g.node');

    // ---------- 렌더링 ----------

    function renderLinks() {
      linkSel = linkLayer
        .selectAll('line')
        .data(links, (d) => d.key)
        .join('line')
        .attr('class', (d) => (d.isLive ? 'link-live' : null))
        .attr('stroke-width', (d) => (d.isLive ? 3.5 : linkWidthScale(d.visScore)))
        .attr('stroke-opacity', (d) => (d.isLive ? 0.95 : linkOpacityScale(d.visScore)))
        .attr('stroke-linecap', 'round');

      // 라이브 선은 임시 표시라 클릭 대상에서 뺀다 (합방 기록 팝업은 누적 교류선용)
      hitSel = hitLayer
        .selectAll('line')
        .data(
          links.filter((d) => !d.isLive),
          (d) => d.key
        )
        .join('line')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 16)
        .style('cursor', 'pointer')
        .on('click', onLinkClick);
    }

    /** 허브(합방 주제) 노드의 캡슐 + 라벨. 텍스트 길이를 재서 박스 폭을 맞춘다. */
    function buildHub(sel, d) {
      const label = d.topic || '합동 방송';
      const text = sel
        .append('text')
        .attr('class', 'hub-label')
        .text(label)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.32em')
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .style('pointer-events', 'none');

      const textWidth = text.node()?.getComputedTextLength?.() ?? label.length * 8;
      const w = Math.max(76, textWidth + 22);
      const h = 26;

      sel
        .insert('rect', 'text')
        .attr('class', 'hub-box')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', h / 2);

      // 충돌 반경에 반영해서 다른 노드가 캡슐을 파고들지 않게 한다
      d.r = Math.max(w, h) / 2;
    }

    function buildMemberNode(sel, d) {
      sel
        .append('circle')
        // 사진이 있는 노드의 바탕색은 테마에 따라 달라지므로 CSS(.node-bg)에 맡긴다
        .attr('class', d.profileImg ? 'node-ring node-bg' : 'node-ring')
        .attr('r', d.r)
        .attr('fill', d.profileImg ? null : d.color)
        .attr('fill-opacity', d.profileImg ? 1 : 0.18)
        .attr('stroke', d.color)
        .attr('stroke-width', 2.5);

      if (d.profileImg) {
        const clipId = `clip-${d.id}`;
        if (defs.select(`#${clipId}`).empty()) {
          defs.append('clipPath').attr('id', clipId).append('circle').attr('r', d.r - 2);
        }
        sel
          .append('image')
          .attr('href', asset(d.profileImg))
          .attr('x', -d.r)
          .attr('y', -d.r)
          .attr('width', d.r * 2)
          .attr('height', d.r * 2)
          .attr('clip-path', `url(#${clipId})`)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .style('pointer-events', 'none');
      } else {
        sel
          .append('text')
          .attr('class', 'initials')
          .text(d.initials)
          .attr('text-anchor', 'middle')
          .attr('dy', '0.32em')
          .attr('font-size', Math.max(11, d.r * 0.42))
          .attr('font-weight', 600)
          .attr('font-family', '"Space Grotesk", sans-serif')
          .attr('fill', d.color)
          .style('pointer-events', 'none');
      }

      sel
        .append('text')
        .attr('class', 'label')
        .text(d.name)
        .attr('text-anchor', 'middle')
        .attr('y', d.r + 16)
        .attr('font-size', 11.5)
        .attr('font-weight', 500)
        // fill은 index.css(.node text.label)에서 테마 변수로 지정한다
        .style('pointer-events', 'none');

      // LIVE 신호 아치. 항상 만들어두고 표시만 토글한다.
      const badge = sel
        .append('g')
        .attr('class', 'live-badge')
        .style('pointer-events', 'none')
        .style('display', 'none');

      [0, 180].forEach((centerDeg) => {
        [1.25, 1.65, 2.05].forEach((mul, i) => {
          badge
            .append('path')
            .attr('class', `live-badge-arc live-badge-arc-${i}`)
            .attr('d', signalArcPath(d.r * mul, centerDeg, 30))
            .attr('stroke-width', 3 + i * 1.2);
        });
      });
    }

    function renderNodes() {
      nodeSel = nodeLayer
        .selectAll('g.node')
        .data(nodes, (d) => d.id)
        .join(
          (enter) => {
            const g = enter.append('g').attr('class', (d) => (d.isHub ? 'node node-hub' : 'node'));
            g.each(function (d) {
              const sel = d3.select(this);
              if (d.isHub) buildHub(sel, d);
              else buildMemberNode(sel, d);
            });
            return g;
          },
          (update) => {
            // 주제가 바뀌면 캡슐 폭도 달라져야 하므로 통째로 다시 그린다
            update
              .filter((d) => d.isHub)
              .each(function (d) {
                const sel = d3.select(this);
                sel.selectAll('*').remove();
                buildHub(sel, d);
              });
            return update;
          },
          (exit) => exit.remove()
        );

      nodeSel.style('cursor', 'pointer').on('click', onNodeClick);
      nodeSel.call(drag);
      updateLiveBadges(liveMemberIds);
    }

    // ---------- 상호작용 ----------

    function closeAll() {
      selectedIdRef.current = null;
      applyHighlight(null);
      onSelectMember?.(null);
      setTooltip(null);
      setEdgeTooltip(null);
    }

    function onNodeClick(event, d) {
      event.stopPropagation();
      setEdgeTooltip(null);

      // 허브는 임시 표시라 선택 대상이 아니다
      if (d.isHub) return;

      const isSame = selectedIdRef.current === d.id;
      selectedIdRef.current = isSame ? null : d.id;
      applyHighlight(selectedIdRef.current);
      onSelectMember?.(selectedIdRef.current);

      if (isSame) {
        setTooltip(null);
        return;
      }

      // 모바일은 화면이 좁아 탭한 멤버가 가장자리에 있으면 팝업과 겹친다.
      // 해당 멤버와 이웃이 보이도록 카메라를 옮겨준다(줌 이벤트가 팝업 위치도 따라 갱신).
      if (isMobile) focusOnNode(d);

      const { x, y } = tooltipAnchor(d);
      setTooltip({ member: d, connections: buildConnections(d.id, rawCounts), x, y });
    }

    function onLinkClick(event, d) {
      event.stopPropagation();

      const aId = d.source.id ?? d.source;
      const bId = d.target.id ?? d.target;
      const a = membersById[aId];
      const b = membersById[bId];
      if (!a || !b) return;

      // 노드 선택 상태는 정리하고 교류선 팝업만 띄운다. 이 둘을 잇는 선만 보이게
      // 나머지 노드·선은 옅게 죽인다(applyPairHighlight) — 전체 하이라이트 해제가 아니다.
      selectedIdRef.current = null;
      applyPairHighlight(aId, bId);
      onSelectMember?.(null);
      setTooltip(null);

      const rect = container.getBoundingClientRect();
      setEdgeTooltip({
        pair: { a, b },
        events: pairEvents.get(pairKey(aId, bId)) ?? [],
        x: event.clientX - rect.left + 12,
        y: event.clientY - rect.top - 20,
      });
    }

    /**
     * 멤버 팝업의 "자주 함께하는 멤버" 목록에서 한 명을 클릭했을 때.
     * onLinkClick과 동일하게 두 멤버가 함께한 합방/커버 기록만 보여준다 —
     * 지금 열려 있는 멤버 팝업 기준(selectedIdRef.current)과 클릭한 멤버 사이의 교류.
     */
    function onConnectionClick(otherId, event) {
      const aId = selectedIdRef.current;
      if (!aId) return;
      const a = membersById[aId];
      const b = membersById[otherId];
      if (!a || !b) return;

      selectedIdRef.current = null;
      applyPairHighlight(aId, otherId);
      onSelectMember?.(null);
      setTooltip(null);

      const rect = container.getBoundingClientRect();
      setEdgeTooltip({
        pair: { a, b },
        events: pairEvents.get(pairKey(aId, otherId)) ?? [],
        x: event.clientX - rect.left + 12,
        y: event.clientY - rect.top - 20,
      });
    }
    onConnectionClickRef.current = onConnectionClick;

    function applyHighlight(selectedId) {
      if (!selectedId) {
        nodeSel.attr('opacity', 1);
        linkSel.attr('opacity', (d) => (d.isLive ? 1 : linkOpacityScale(d.visScore)));
        return;
      }
      const connectedIds = new Set([selectedId]);
      links.forEach((l) => {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        if (s === selectedId) connectedIds.add(t);
        if (t === selectedId) connectedIds.add(s);
      });
      nodeSel.attr('opacity', (d) => (connectedIds.has(d.id) ? 1 : 0.15));
      linkSel.attr('opacity', (d) => {
        const s = d.source.id ?? d.source;
        const t = d.target.id ?? d.target;
        const touches = s === selectedId || t === selectedId;
        if (!touches) return 0.03;
        return d.isLive ? 1 : linkOpacityScale(d.visScore);
      });
    }
    applyHighlightRef.current = applyHighlight;

    /**
     * 교류선(또는 팝업의 연결 목록)을 클릭했을 때: 그 두 멤버를 잇는 선만 보이고
     * 나머지 노드·선은 다 죽인다. applyHighlight(selectedId)는 "한 노드에 닿은
     * 모든 선"을 보여주는 거라 다른 목적 — 이건 딱 그 쌍 하나만 남긴다.
     */
    function applyPairHighlight(aId, bId) {
      const pair = new Set([aId, bId]);
      nodeSel.attr('opacity', (d) => (pair.has(d.id) ? 1 : 0.15));
      linkSel.attr('opacity', (d) => {
        const s = d.source.id ?? d.source;
        const t = d.target.id ?? d.target;
        const isPairLink = (s === aId && t === bId) || (s === bId && t === aId);
        return isPairLink ? 1 : 0.03;
      });
    }

    function updateLiveBadges(liveIds) {
      nodeSel
        .filter((d) => !d.isHub)
        .select('.live-badge')
        .style('display', (d) => (liveIds?.has(d.id) ? null : 'none'));
    }
    updateLiveBadgesRef.current = updateLiveBadges;

    /** 노드의 월드 좌표를 현재 카메라 변환으로 화면 좌표로 옮긴다. */
    function tooltipAnchor(d) {
      const t = d3.zoomTransform(svgEl);
      return { x: t.applyX(d.x) + d.r * t.k + 16, y: t.applyY(d.y) - d.r * t.k };
    }

    /**
     * 선택된 노드를 따라 툴팁 위치를 갱신한다.
     * 시뮬레이션 tick뿐 아니라 줌·팬에서도 호출해야 한다.
     * (tick만 쓰면 시뮬레이션이 멈춘 뒤 툴팁이 그 자리에 굳어버린다)
     */
    function syncTooltipPosition() {
      const id = selectedIdRef.current;
      if (!id) return;
      const d = nodes.find((n) => n.id === id);
      if (!d || d.x == null) return;
      const { x, y } = tooltipAnchor(d);
      tooltipRef.current?.reposition(x, y);
    }

    /**
     * 지금 진행 중인 합방을 실제 시뮬레이션에 반영한다.
     *
     * 2명이면 두 노드를 짧고 강한 링크로 직접 잇고, 3명 이상이면 주제 캡슐을
     * 임시 노드로 만들어 참가자 전원을 거기 묶는다. 표시만 바꾸는 게 아니라
     * 실제로 서로 끌어당기게 하는 게 목적이다.
     *
     * 카메라(zoom transform)는 별개 상태라 여기서 건드리지 않는다. 노드·링크
     * 배열만 갱신하고 alpha를 조금 올려 국소 재배치만 시킨다.
     */
    function updateLiveCollabs(collabs) {
      // 실제로 바뀐 게 없으면 재가열하지 않는다 (60초마다 그래프가 들썩이는 걸 방지)
      const signature = (collabs ?? [])
        .map((c) => `${c.videoId}:${[...(c.participants ?? [])].sort().join(',')}:${c.topic ?? ''}`)
        .sort()
        .join(';');
      if (signature === lastCollabSignature) return;
      lastCollabSignature = signature;

      const activeHubIds = new Set();
      const liveLinks = [];

      for (const c of collabs ?? []) {
        const parts = (c.participants ?? []).filter((id) => baseById.has(id));
        if (parts.length < 2) continue;

        if (parts.length === 2) {
          liveLinks.push({
            key: `live:${pairKey(parts[0], parts[1])}`,
            source: parts[0],
            target: parts[1],
            isLive: true,
          });
          continue;
        }

        const hubId = `hub:${c.videoId}`;
        activeHubIds.add(hubId);
        if (hubNodes.has(hubId)) {
          hubNodes.get(hubId).topic = c.topic;
        } else {
          // 참가자들의 무게중심에서 시작해야 화면 밖에서 날아오지 않는다
          const cx = d3.mean(parts, (id) => baseById.get(id).x) ?? width / 2;
          const cy = d3.mean(parts, (id) => baseById.get(id).y) ?? height / 2;
          hubNodes.set(hubId, {
            id: hubId,
            isHub: true,
            topic: c.topic,
            r: 40,
            x: cx,
            y: cy,
          });
        }
        for (const p of parts) {
          liveLinks.push({ key: `spoke:${hubId}|${p}`, source: hubId, target: p, isLive: true });
        }
      }

      // 끝난 합방의 허브는 제거 → exit 처리로 화면에서도 사라진다
      for (const id of [...hubNodes.keys()]) {
        if (!activeHubIds.has(id)) hubNodes.delete(id);
      }

      nodes = [...baseNodes, ...hubNodes.values()];
      links = [...baseLinks, ...liveLinks];
      simLinks = [...physicsLinks, ...liveLinks];

      renderLinks();
      renderNodes();

      simulation.nodes(nodes);
      simulation.force('link').links(simLinks);
      applyHighlight(selectedIdRef.current);
      simulation.alpha(0.3).restart();
    }
    updateLiveCollabsRef.current = updateLiveCollabs;

    svg.on('click', closeAll);

    // ---------- 시뮬레이션 ----------

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(simLinks)
          .id((d) => d.id)
          .distance((d) => {
            if (!d.isLive) return distanceScale(d.distScore);
            const isSpoke = d.source.isHub || d.target.isHub;
            return isSpoke ? HUB_SPOKE_DISTANCE : LIVE_PAIR_DISTANCE;
          })
          .strength((d) => (d.isLive ? LIVE_LINK_STRENGTH : linkStrengthScale(d.distScore)))
      )
      /*
       * 39개 노드가 중앙에 뭉치지 않도록 반발력을 키웠다.
       * distanceMax가 없으면 링크 없는 노드가 무한정 밀려나 화면 밖으로 나간다
       * (실측: 화면의 3~4배까지 흩어짐). 가까운 거리에서만 밀어내게 제한한다.
       * 세로 당김을 가로보다 세게 준 건 캔버스가 가로로 넓어서다.
       * 값은 캔버스 사용 면적을 기존 대비 약 2배로 넓히도록(점 1) 헤드리스
       * 시뮬레이션으로 실측·조정했다. 링크 장력은 위 linkStrengthScale이
       * 담당하므로(점 3) x/y 중심 당김은 오히려 약화했다 — 그래야 자주
       * 합방한 쌍끼리의 인력이 상대적으로 더 지배적으로 느껴진다.
       */
      .force('charge', d3.forceManyBody().strength(-610 * spread).distanceMax(500 * spread))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.025))
      .force('y', d3.forceY(height / 2).strength(0.06))
      .force(
        'collide',
        d3.forceCollide().radius((d) => d.r + 24)
      )
      // 기본값(0.0228)보다 빨리 식혀서 흔들림이 멎는 시점을 앞당긴다 (점 4)
      .alphaDecay(0.05);

    // 드래그 (허브도 잡아서 옮길 수 있다)
    const drag = d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    function renderPositions() {
      const x1 = (d) => d.source.x;
      const y1 = (d) => d.source.y;
      const x2 = (d) => d.target.x;
      const y2 = (d) => d.target.y;

      linkSel.attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
      hitSel.attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);

      syncTooltipPosition();
    }

    // 줌 & 팬. 아래 카메라 헬퍼들이 초기 변환을 걸 수 있도록 미리 만들어둔다.
    const zoom = d3
      .zoom()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .on('zoom', (event) => {
        root.attr('transform', event.transform);
        // 시뮬레이션이 멈춘 뒤에도 툴팁이 노드를 따라오도록
        syncTooltipPosition();
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    /** 주어진 노드들을 감싸는 사각형(여백 포함)과 그 중심. */
    function nodeBounds(list, pad = 60) {
      const xs = list.map((d) => d.x).filter((v) => v != null);
      const ys = list.map((d) => d.y).filter((v) => v != null);
      if (xs.length === 0) return null;

      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad;
      return {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        boxW: Math.max(1, maxX - minX),
        boxH: Math.max(1, maxY - minY),
      };
    }

    /** (cx, cy)를 화면 중앙에 두는 배율 scale의 카메라 변환. */
    function cameraAt(cx, cy, scale) {
      return d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-cx, -cy);
    }

    function applyCamera(transform, duration = 0) {
      if (duration > 0) svg.transition().duration(duration).call(zoom.transform, transform);
      else svg.call(zoom.transform, transform);
    }

    /** 전체 노드가 화면에 들어오도록 맞춘다 (리셋 버튼이 쓰는 "전체 조망"). */
    function fitToView(duration = 0) {
      const b = nodeBounds(nodes);
      if (!b) return;
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(width / b.boxW, height / b.boxH)));
      applyCamera(cameraAt(b.cx, b.cy, scale), duration);
    }
    fitToViewRef.current = fitToView;

    /**
     * 첫 화면. 데스크톱·모바일 모두 그래프 중앙에서 읽을 수 있는 배율로 시작한다.
     * 관계가 거리로 드러나도록 배치를 넓게 쓰기 때문에(LINK_DISTANCE_* 참고)
     * 전체를 맞추면 배율이 0.11~0.25까지 떨어져 라벨이 사라진다.
     */
    function applyInitialView() {
      const b = nodeBounds(nodes);
      if (!b) return;
      applyCamera(cameraAt(b.cx, b.cy, INITIAL_SCALE));
    }

    /**
     * 노드를 탭했을 때 그 멤버가 화면 중앙에 오도록 카메라를 옮긴다.
     *
     * 이웃까지 한 화면에 담을 수 있으면 담지만, 실측상 39명 중 38명은 이웃이
     * 24~31명이라 다 담으려면 배율이 0.53까지 떨어져(=라벨 6px) 읽을 수 없다.
     * 그런 경우엔 담는 것보다 읽히는 게 중요하므로 탭한 노드를 중앙에 두고
     * FOCUS_MIN_SCALE을 지킨다. 어느 쪽이든 배율은 항상 0.9 이상이라
     * 라벨이 숨겨지는 일은 없다.
     */
    function focusOnNode(d, duration = 400) {
      const ids = new Set([d.id]);
      links.forEach((l) => {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        if (s === d.id) ids.add(t);
        if (t === d.id) ids.add(s);
      });

      const b = nodeBounds(nodes.filter((n) => ids.has(n.id)), 80);
      if (!b) return;

      const fitScale = Math.min(width / b.boxW, height / b.boxH);
      if (fitScale < FOCUS_MIN_SCALE) {
        applyCamera(cameraAt(d.x, d.y, FOCUS_MIN_SCALE), duration);
        return;
      }
      applyCamera(cameraAt(b.cx, b.cy, Math.min(MAX_ZOOM, fitScale)), duration);
    }

    renderLinks();
    renderNodes();
    applyHighlight(selectedIdRef.current);
    updateLiveCollabs(liveCollabs);

    /*
     * 브라우저의 비동기 타이머로 매 프레임 조금씩 안정화되길 기다리면 그동안
     * 렉처럼 느껴지고, 처음 화면도 계속 흔들린다. 시뮬레이션을 만들자마자
     * 동기적으로 여러 틱을 미리 돌려 거의 정착된 상태로 시작한다(점 4).
     * 그 상태의 바운딩 박스로 초기 줌을 맞추면(점 1) 노드가 중앙에 뭉쳐
     * 보이지 않고 처음부터 넓게 퍼진 모습으로 보인다.
     */
    simulation.stop();
    for (let i = 0; i < 300; i++) simulation.tick();
    renderPositions();
    applyInitialView();

    simulation.on('tick', renderPositions);
    simulation.alpha(0.2).restart();

    return () => {
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, interactions]);

  // liveMemberIds는 60초 폴링마다 바뀌지만, 그때마다 시뮬레이션을 통째로
  // 다시 만들 필요는 없다 — 배지 표시만 토글한다.
  useEffect(() => {
    updateLiveBadgesRef.current?.(liveMemberIds);
  }, [liveMemberIds]);

  // 진행 중인 합방은 실제 링크/노드로 반영한다 (내부에서 변화 없으면 무시)
  useEffect(() => {
    updateLiveCollabsRef.current?.(liveCollabs);
  }, [liveCollabs]);

  const handleZoom = (factor) => {
    const svg = d3.select(svgRef.current);
    svg.transition().duration(200).call(zoomRef.current.scaleBy, factor);
  };

  /*
   * 예전엔 zoomIdentity(배율 1.0)로 되돌렸는데, 실제 첫 화면은 맞춤 배율
   * (데스크톱 0.86 / 모바일은 그보다 훨씬 낮음)이라 리셋할 때마다 엉뚱한
   * 배율로 튀고 그래프가 화면 밖으로 벗어났다. 전체 맞춤으로 되돌린다.
   */
  const handleReset = () => {
    fitToViewRef.current?.(300);
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/*
        touch-none: 이게 없으면 모바일에서 핀치/드래그를 브라우저가 페이지 확대·스크롤로
        먼저 가로채 d3의 줌·팬이 제대로 먹지 않는다. select-none은 드래그 중 라벨 텍스트가
        선택되는 것을 막는다.
      */}
      <svg ref={svgRef} className="h-full w-full touch-none select-none" />

      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 text-center">
        <p className="font-display text-lg font-semibold text-ink-100">멤버 교류 네트워크</p>
        <p className="text-xs text-ink-500">
          가까울수록 최근 교류가 많아요 · 선을 클릭하면 함께한 방송을 볼 수 있어요
        </p>
      </div>

      <div className="absolute bottom-9 right-4 flex flex-col gap-1.5">
        <button onClick={() => handleZoom(1.3)} className="rounded-lg border border-stage-border bg-stage-700/80 p-2 text-ink-300 hover:text-ink-100">
          <ZoomIn size={16} />
        </button>
        <button onClick={() => handleZoom(0.75)} className="rounded-lg border border-stage-border bg-stage-700/80 p-2 text-ink-300 hover:text-ink-100">
          <ZoomOut size={16} />
        </button>
        <button onClick={handleReset} className="rounded-lg border border-stage-border bg-stage-700/80 p-2 text-ink-300 hover:text-ink-100">
          <Maximize2 size={16} />
        </button>
      </div>

      {/* 버전 표시 */}
      <span className="pointer-events-none absolute bottom-2.5 right-4 select-none font-display text-[10px] tabular-nums text-ink-500/50">
        v{__APP_VERSION__}
      </span>

      <AnimatePresence>
        {tooltip && (
          <MemberTooltip
            ref={tooltipRef}
            member={tooltip.member}
            connections={tooltip.connections}
            x={tooltip.x}
            y={tooltip.y}
            onClose={() => {
              setTooltip(null);
              selectedIdRef.current = null;
              applyHighlightRef.current?.(null);
              onSelectMember?.(null);
            }}
            onSelectConnection={(otherId, event) => onConnectionClickRef.current?.(otherId, event)}
          />
        )}
        {edgeTooltip && (
          <InteractionTooltip
            pair={edgeTooltip.pair}
            events={edgeTooltip.events}
            x={edgeTooltip.x}
            y={edgeTooltip.y}
            onClose={() => {
              setEdgeTooltip(null);
              applyHighlightRef.current?.(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** LIVE 아이콘의 좌/우 대칭 신호 아치 하나의 SVG path (반지름 r, 중심 각도 centerDeg). */
function signalArcPath(r, centerDeg, halfSpanDeg) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const a1 = centerDeg - halfSpanDeg;
  const a2 = centerDeg + halfSpanDeg;
  const x1 = r * Math.cos(rad(a1));
  const y1 = r * Math.sin(rad(a1));
  const x2 = r * Math.cos(rad(a2));
  const y2 = r * Math.sin(rad(a2));
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}
