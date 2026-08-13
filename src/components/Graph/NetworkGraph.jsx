import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { AnimatePresence } from 'framer-motion';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import MemberTooltip from './MemberTooltip.jsx';

const NODE_RADIUS = 24;

// 하위 경로(GitHub Pages 등)에 배포돼도 정적 파일을 찾을 수 있도록 base 경로를 붙여줌
const asset = (path) => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, '')}`;

// 교류 점수: 참여 인원이 많을수록 쌍당 기여도가 낮아짐 (2인 = 10, 5인 = 4 ...)
const BASE_SCORE = 20;
// 반감기: 이 일수가 지날 때마다 과거 교류의 기여도가 절반으로 줄어듦
const HALF_LIFE_DAYS = 90;

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// interactions -> 쌍(pair)별 감쇠 적용 친밀도 점수 + 원본 합방/커버 횟수
function buildPairStats(interactions, now) {
  const closeness = new Map();
  const rawCounts = new Map();

  interactions.forEach((ev) => {
    const n = ev.participants.length;
    const contribution = (BASE_SCORE / n) * (ev.count ?? 1);
    const ageDays = Math.max(0, (now - new Date(ev.lastDate)) / 86400000);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const weighted = contribution * decay;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = pairKey(ev.participants[i], ev.participants[j]);
        closeness.set(key, (closeness.get(key) || 0) + weighted);

        const counts = rawCounts.get(key) || { collabCount: 0, coverCount: 0 };
        if (ev.type === 'cover') counts.coverCount += ev.count ?? 1;
        else counts.collabCount += ev.count ?? 1;
        rawCounts.set(key, counts);
      }
    }
  });

  return { closeness, rawCounts };
}

export default function NetworkGraph({ members, interactions, notifications, selectedMemberId, onSelectMember }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // { member, connections, x, y }
  const selectedIdRef = useRef(null);
  const applyHighlightRef = useRef(null);

  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));

  const buildConnections = useCallback(
    (memberId, rawCounts) => {
      return members
        .filter((m) => m.id !== memberId)
        .map((m) => {
          const counts = rawCounts.get(pairKey(memberId, m.id));
          return counts ? { member: m, collabCount: counts.collabCount, coverCount: counts.coverCount } : null;
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

    const { closeness, rawCounts } = buildPairStats(interactions, now);
    const maxCloseness = Math.max(1, ...closeness.values());

    // 상대적인 친밀도 점수를 거리/굵기/투명도로 환산 (선은 아주 옅게 유지)
    const distanceScale = d3.scaleLinear().domain([0, maxCloseness]).range([260, 90]).clamp(true);
    const strokeScale = d3.scaleLinear().domain([0, maxCloseness]).range([1, 4]).clamp(true);
    const opacityScale = d3.scaleLinear().domain([0, maxCloseness]).range([0.05, 0.22]).clamp(true);

    const nodes = members.map((m) => ({ ...m, r: NODE_RADIUS }));
    const links = Array.from(closeness.entries()).map(([key, score]) => {
      const [source, target] = key.split('|');
      return { source, target, score };
    });

    const svg = d3.select(svgEl).attr('viewBox', [0, 0, width, height]);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    const root = svg.append('g').attr('class', 'zoom-root');

    // 워터마크 로고: 월드 좌표에 고정된 커다란 배경. 카메라(줌/팬)만 그 위를 움직인다.
    const MARK_ASPECT = 235 / 800; // 원본 이미지 비율
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
      .attr('opacity', 0.08)
      .style('pointer-events', 'none');

    const linkLayer = root.append('g').attr('class', 'links');
    const nodeLayer = root.append('g').attr('class', 'nodes');

    const linkSel = linkLayer
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#0ea5e9')
      .attr('stroke-width', (d) => strokeScale(d.score))
      .attr('stroke-opacity', (d) => opacityScale(d.score))
      .attr('stroke-linecap', 'round');

    const nodeSel = nodeLayer
      .selectAll('g.node')
      .data(nodes, (d) => d.id)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    nodeSel
      .append('circle')
      .attr('class', 'node-ring')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => (d.profileImg ? '#ffffff' : d.color))
      .attr('fill-opacity', (d) => (d.profileImg ? 1 : 0.18))
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 2.5);

    // 프로필 사진이 있는 멤버는 원형으로 클리핑해서 이미지 삽입
    nodeSel.each(function (d) {
      if (!d.profileImg) return;
      const clipId = `clip-${d.id}`;
      defs
        .append('clipPath')
        .attr('id', clipId)
        .append('circle')
        .attr('r', d.r - 2);

      d3.select(this)
        .append('image')
        .attr('href', asset(d.profileImg))
        .attr('x', -d.r)
        .attr('y', -d.r)
        .attr('width', d.r * 2)
        .attr('height', d.r * 2)
        .attr('clip-path', `url(#${clipId})`)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .style('pointer-events', 'none');
    });

    // 이미지가 없는 멤버는 이니셜로 대체
    nodeSel
      .filter((d) => !d.profileImg)
      .append('text')
      .attr('class', 'initials')
      .text((d) => d.initials)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.32em')
      .attr('font-size', (d) => Math.max(11, d.r * 0.42))
      .attr('font-weight', 600)
      .attr('font-family', '"Space Grotesk", sans-serif')
      .attr('fill', (d) => d.color)
      .style('pointer-events', 'none');

    nodeSel
      .append('text')
      .attr('class', 'label')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('y', (d) => d.r + 16)
      .attr('font-size', 11.5)
      .attr('font-weight', 500)
      .attr('fill', '#173247')
      .style('pointer-events', 'none');

    function applyHighlight(selectedId) {
      if (!selectedId) {
        nodeSel.attr('opacity', 1);
        linkSel.attr('opacity', (d) => opacityScale(d.score));
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
        return s === selectedId || t === selectedId ? opacityScale(d.score) : 0.03;
      });
    }
    applyHighlightRef.current = applyHighlight;
    applyHighlight(selectedIdRef.current);

    nodeSel.on('click', (event, d) => {
      event.stopPropagation();
      const isSame = selectedIdRef.current === d.id;
      selectedIdRef.current = isSame ? null : d.id;
      applyHighlight(selectedIdRef.current);
      onSelectMember?.(selectedIdRef.current);

      if (isSame) {
        setTooltip(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const nodeRect = event.currentTarget.getBoundingClientRect();
      setTooltip({
        member: d,
        connections: buildConnections(d.id, rawCounts),
        x: nodeRect.left - rect.left + nodeRect.width / 2 + 16,
        y: nodeRect.top - rect.top,
      });
    });

    svg.on('click', () => {
      selectedIdRef.current = null;
      applyHighlight(null);
      onSelectMember?.(null);
      setTooltip(null);
    });

    // 시뮬레이션 (선을 그리기보다, 친밀도 점수가 높을수록 서로 가까워지도록 배치)
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance((d) => distanceScale(d.score))
          .strength((d) => Math.min(0.9, 0.15 + d.score / maxCloseness))
      )
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03))
      .force(
        'collide',
        d3.forceCollide().radius((d) => d.r + 20)
      );

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);

      // 툴팁이 열려 있으면 선택 노드를 따라 위치 갱신
      if (selectedIdRef.current) {
        const d = nodes.find((n) => n.id === selectedIdRef.current);
        if (d) {
          const rect = container.getBoundingClientRect();
          const t = d3.zoomTransform(svgEl);
          setTooltip((prev) =>
            prev
              ? {
                  ...prev,
                  x: t.applyX(d.x) + d.r * t.k + 16,
                  y: t.applyY(d.y) - d.r,
                }
              : prev
          );
        }
      }
    });

    // 드래그
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
    nodeSel.call(drag);

    // 줌 & 팬
    const zoom = d3
      .zoom()
      .scaleExtent([0.4, 2.5])
      .on('zoom', (event) => {
        root.attr('transform', event.transform);
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    return () => {
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, interactions]);

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
        <p className="text-xs text-ink-500">노드를 드래그하거나 스크롤로 확대·축소해보세요 · 가까울수록 최근 교류가 많아요</p>
      </div>

      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
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
      </AnimatePresence>
    </div>
  );
}
