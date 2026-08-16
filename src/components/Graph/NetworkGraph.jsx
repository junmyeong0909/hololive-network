import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { AnimatePresence } from 'framer-motion';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import MemberTooltip from './MemberTooltip.jsx';
import InteractionTooltip from './InteractionTooltip.jsx';
import { asset } from '../../lib/asset.js';

const NODE_RADIUS = 24;

// 교류 점수: 참여 인원이 많을수록 쌍당 기여도가 낮아짐 (2인 = 10, 5인 = 4 ...)
const BASE_SCORE = 20;
// 반감기: 이 일수가 지날 때마다 과거 교류의 기여도가 절반으로 줄어듦
const HALF_LIFE_DAYS = 90;

// 이 횟수 미만으로 함께한 쌍은 선을 그리지 않는다.
// (한 번 스쳐간 조합까지 다 그리면 39명 그래프가 실뭉치가 된다)
// 백필 데이터(349건)로 실측: 2회 기준 383개 선(가능한 쌍의 52%)은 너무 빽빽해서
// 3회로 올렸다 — 296개로 줄고 가로 분포도 더 좋아짐(71%→96%), 새로 고립되는
// 멤버도 없음(하아토는 어느 기준에서도 고립 — raise가 원인이 아님).
const MIN_EDGE_EVENTS = 3;

// 합방 중 붙는 거리. 클릭 가능하도록 노드가 완전히 겹치지는 않게 둔다.
const LIVE_PAIR_DISTANCE = 85;
const HUB_SPOKE_DISTANCE = 78;
const LIVE_LINK_STRENGTH = 0.9;

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * interactions -> 쌍별 친밀도 점수 + 원본 이벤트 목록.
 *
 * 점수는 시간 감쇠를 적용한 값(그래프 거리 계산용)이고, 이벤트 목록은
 * 교류선을 클릭했을 때 보여줄 실제 합방 기록이다.
 */
function buildPairStats(interactions, now) {
  const closeness = new Map();
  const rawCounts = new Map();
  const pairEvents = new Map();

  interactions.forEach((ev) => {
    const parts = ev.participants ?? [];
    const n = parts.length;
    if (n < 2) return;

    const contribution = (BASE_SCORE / n) * (ev.count ?? 1);
    const ageDays = Math.max(0, (now - new Date(ev.lastDate)) / 86400000);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const weighted = contribution * decay;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = pairKey(parts[i], parts[j]);
        closeness.set(key, (closeness.get(key) || 0) + weighted);

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

  return { closeness, rawCounts, pairEvents };
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

  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));

  const buildConnections = useCallback(
    (memberId, rawCounts) => {
      return members
        .filter((m) => m.id !== memberId)
        .map((m) => {
          const counts = rawCounts.get(pairKey(memberId, m.id));
          if (!counts || counts.total < MIN_EDGE_EVENTS) return null;
          return { member: m, collabCount: counts.collabCount, coverCount: counts.coverCount };
        })
        .filter(Boolean)
        .sort((a, b) => b.collabCount + b.coverCount - (a.collabCount + a.coverCount));
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
    const now = new Date();

    const { closeness, rawCounts, pairEvents } = buildPairStats(interactions, now);
    const maxCloseness = Math.max(1, ...closeness.values());

    // 배치 크기를 캔버스에 맞춰 늘리고 줄이는 배율.
    // 이게 없으면 큰 화면에서는 가운데만 쓰고, 작은 화면에서는 넘쳐난다.
    const spread = Math.min(Math.max(Math.min(width / 920, height / 664), 0.8), 1.8);

    // 상대적인 친밀도 점수를 거리/굵기/투명도로 환산 (선은 아주 옅게 유지).
    // 하한이 최소 간격을 보장해서 노드가 서로 겹쳐 클릭이 어려워지지 않는다.
    const distanceScale = d3
      .scaleLinear()
      .domain([0, maxCloseness])
      .range([430 * spread, 120 * spread])
      .clamp(true);
    const strokeScale = d3.scaleLinear().domain([0, maxCloseness]).range([1, 4]).clamp(true);
    const opacityScale = d3.scaleLinear().domain([0, maxCloseness]).range([0.06, 0.3]).clamp(true);

    const baseNodes = members.map((m) => ({ ...m, r: NODE_RADIUS }));
    const baseById = new Map(baseNodes.map((n) => [n.id, n]));

    const baseLinks = Array.from(closeness.entries())
      .filter(([key]) => (rawCounts.get(key)?.total ?? 0) >= MIN_EDGE_EVENTS)
      .map(([key, score]) => {
        const [source, target] = key.split('|');
        return { key, source, target, score };
      });

    // 라이브 합방으로 추가되는 허브 노드. 살아있는 동안 같은 객체를 유지해야
    // 좌표가 보존된다.
    const hubNodes = new Map();
    let nodes = [...baseNodes];
    let links = [...baseLinks];
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
        .attr('stroke-width', (d) => (d.isLive ? 3.5 : strokeScale(d.score)))
        .attr('stroke-opacity', (d) => (d.isLive ? 0.95 : opacityScale(d.score)))
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

      // 노드 선택 상태는 정리하고 교류선 팝업만 띄운다
      selectedIdRef.current = null;
      applyHighlight(null);
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

    function applyHighlight(selectedId) {
      if (!selectedId) {
        nodeSel.attr('opacity', 1);
        linkSel.attr('opacity', (d) => (d.isLive ? 1 : opacityScale(d.score)));
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
        return d.isLive ? 1 : opacityScale(d.score);
      });
    }
    applyHighlightRef.current = applyHighlight;

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
      setTooltip((prev) => {
        if (!prev) return prev;
        if (prev.x === x && prev.y === y) return prev; // 불필요한 리렌더 방지
        return { ...prev, x, y };
      });
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

      renderLinks();
      renderNodes();

      simulation.nodes(nodes);
      simulation.force('link').links(links);
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
          .forceLink(links)
          .id((d) => d.id)
          .distance((d) => {
            if (!d.isLive) return distanceScale(d.score);
            const isSpoke = d.source.isHub || d.target.isHub;
            return isSpoke ? HUB_SPOKE_DISTANCE : LIVE_PAIR_DISTANCE;
          })
          .strength((d) =>
            d.isLive ? LIVE_LINK_STRENGTH : Math.min(0.9, 0.15 + d.score / maxCloseness)
          )
      )
      /*
       * 39개 노드가 중앙에 뭉치지 않도록 반발력을 키웠다.
       * distanceMax가 없으면 링크 없는 노드가 무한정 밀려나 화면 밖으로 나간다
       * (실측: 화면의 3~4배까지 흩어짐). 가까운 거리에서만 밀어내게 제한한다.
       * 세로 당김(0.12)을 가로(0.045)보다 세게 준 건 캔버스가 가로로 넓어서다.
       * 값은 현재 데이터와 백필 후를 가정한 조밀한 데이터 양쪽에서
       * 전원이 화면 안에 들어오도록 시뮬레이션으로 맞췄다.
       */
      .force('charge', d3.forceManyBody().strength(-380 * spread).distanceMax(310 * spread))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.045))
      .force('y', d3.forceY(height / 2).strength(0.12))
      .force(
        'collide',
        d3.forceCollide().radius((d) => d.r + 24)
      );

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

    renderLinks();
    renderNodes();
    applyHighlight(selectedIdRef.current);
    updateLiveCollabs(liveCollabs);

    simulation.on('tick', () => {
      const x1 = (d) => d.source.x;
      const y1 = (d) => d.source.y;
      const x2 = (d) => d.target.x;
      const y2 = (d) => d.target.y;

      linkSel.attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
      hitSel.attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2);
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);

      syncTooltipPosition();
    });

    // 줌 & 팬
    const zoom = d3
      .zoom()
      .scaleExtent([0.3, 2.5])
      .on('zoom', (event) => {
        root.attr('transform', event.transform);
        // 시뮬레이션이 멈춘 뒤에도 툴팁이 노드를 따라오도록
        syncTooltipPosition();
      });
    svg.call(zoom);
    zoomRef.current = zoom;

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

  const handleReset = () => {
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(zoomRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg ref={svgRef} className="h-full w-full" />

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
          />
        )}
        {edgeTooltip && (
          <InteractionTooltip
            pair={edgeTooltip.pair}
            events={edgeTooltip.events}
            x={edgeTooltip.x}
            y={edgeTooltip.y}
            onClose={() => setEdgeTooltip(null)}
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
