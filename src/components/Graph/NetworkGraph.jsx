import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { AnimatePresence } from 'framer-motion';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import MemberTooltip from './MemberTooltip.jsx';

const MIN_RADIUS = 22;
const MAX_RADIUS = 46;

export default function NetworkGraph({ members, edges, notifications }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // { member, connections, x, y }
  const selectedIdRef = useRef(null);

  const membersById = Object.fromEntries(members.map((m) => [m.id, m]));

  const buildConnections = useCallback(
    (memberId) => {
      return edges
        .filter((e) => e.source === memberId || e.target === memberId)
        .map((e) => {
          const otherId = e.source === memberId ? e.target : e.source;
          return { member: membersById[otherId], collabCount: e.collabCount, coverCount: e.coverCount };
        })
        .sort((a, b) => b.collabCount + b.coverCount - (a.collabCount + a.coverCount));
    },
    [edges, membersById]
  );

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 교류 가중치 -> 노드 크기
    const weightById = {};
    members.forEach((m) => (weightById[m.id] = 0));
    edges.forEach((e) => {
      const w = e.collabCount + e.coverCount;
      weightById[e.source] = (weightById[e.source] || 0) + w;
      weightById[e.target] = (weightById[e.target] || 0) + w;
    });
    const maxWeight = Math.max(1, ...Object.values(weightById));
    const radiusScale = d3.scaleSqrt().domain([0, maxWeight]).range([MIN_RADIUS, MAX_RADIUS]);
    const strokeScale = d3.scaleLinear().domain([1, 10]).range([1.5, 8]).clamp(true);
    const opacityScale = d3.scaleLinear().domain([1, 10]).range([0.25, 0.85]).clamp(true);

    const nodes = members.map((m) => ({ ...m, r: radiusScale(weightById[m.id] || 0) }));
    const links = edges.map((e) => ({ ...e }));

    const svg = d3.select(svgEl).attr('viewBox', [0, 0, width, height]);
    svg.selectAll('*').remove();

    const root = svg.append('g').attr('class', 'zoom-root');
    const linkLayer = root.append('g').attr('class', 'links');
    const nodeLayer = root.append('g').attr('class', 'nodes');

    const linkSel = linkLayer
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#7c5cff')
      .attr('stroke-width', (d) => strokeScale(d.collabCount + d.coverCount))
      .attr('stroke-opacity', (d) => opacityScale(d.collabCount + d.coverCount))
      .attr('stroke-linecap', 'round');

    const nodeSel = nodeLayer
      .selectAll('g.node')
      .data(nodes, (d) => d.id)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    nodeSel
      .append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.22)
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 2.5);

    nodeSel
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
      .attr('fill', '#e3e1f5')
      .style('pointer-events', 'none');

    function applyHighlight(selectedId) {
      if (!selectedId) {
        nodeSel.attr('opacity', 1);
        linkSel.attr('opacity', (d) => opacityScale(d.collabCount + d.coverCount));
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
        return s === selectedId || t === selectedId ? opacityScale(d.collabCount + d.coverCount) : 0.04;
      });
    }

    nodeSel.on('click', (event, d) => {
      event.stopPropagation();
      const isSame = selectedIdRef.current === d.id;
      selectedIdRef.current = isSame ? null : d.id;
      applyHighlight(selectedIdRef.current);

      if (isSame) {
        setTooltip(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const nodeRect = event.currentTarget.getBoundingClientRect();
      setTooltip({
        member: d,
        connections: buildConnections(d.id),
        x: nodeRect.left - rect.left + nodeRect.width / 2 + 16,
        y: nodeRect.top - rect.top,
      });
    });

    svg.on('click', () => {
      selectedIdRef.current = null;
      applyHighlight(null);
      setTooltip(null);
    });

    // 시뮬레이션
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance((d) => 200 - Math.min(120, (d.collabCount + d.coverCount) * 8))
          .strength(0.5)
      )
      .force('charge', d3.forceManyBody().strength(-420))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide().radius((d) => d.r + 28)
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
  }, [members, edges]);

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
        <p className="text-xs text-ink-500">노드를 드래그하거나 스크롤로 확대·축소해보세요</p>
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
            onClose={() => setTooltip(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
