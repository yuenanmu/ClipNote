import { useEffect, useMemo, useRef, useState } from 'react';
import type { MindmapNode, ReaderDocument, ReaderPosition } from '../../../contracts/reader.ts';
import { layoutMindmap } from './map-layout.ts';
const colors = ['#f2ae66', '#b6a2ed', '#78c8ad', '#78b5e8', '#ea899f', '#d1c66d'];
export function MindmapView({ document: note, onJump }: { document: ReaderDocument; onJump(target: ReaderPosition): void }) {
  const raw = note.content.mindmap;
  const root = useMemo(() => raw.children.length === 1 && !raw.details.length && raw.children[0].target && note.content.headings.length === 1 ? raw.children[0] : { ...raw, label: note.fileName.replace(/\.md$/i, '') }, [raw, note.fileName]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [detail, setDetail] = useState<MindmapNode>(), [detailPage, setDetailPage] = useState(0);
  const holder = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; y: number } | null>(null);
  const layout = useMemo(() => layoutMindmap(root, collapsed), [root, collapsed]);
  const fit = () => { const scale = Math.max(.001, Math.min(1, (size.width - 60) / layout.width, (size.height - 80) / layout.height)); setView({ scale, x: (size.width - layout.width * scale) / 2, y: (size.height - layout.height * scale) / 2 }); };
  useEffect(() => {
    const element = holder.current!; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if (width && height) setSize({ width, height }); }); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { fit(); }, [size.width, size.height, layout.width, layout.height]);
  const zoom = (factor: number, x = size.width / 2, y = size.height / 2) => setView(old => {
    const scale = Math.max(.001, Math.min(3, old.scale * factor)), ratio = scale / old.scale;
    return { scale, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio };
  });
  useEffect(() => {
    const element = holder.current!;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const rect = element.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top); };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, []);
  const activate = (action: () => void) => ({ role: 'button', tabIndex: 0, onClick: action, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } } });
  const visible = layout.nodes.filter(box => (box.x + box.width) * view.scale + view.x >= -200 && box.x * view.scale + view.x <= size.width + 200 && (box.y + box.height) * view.scale + view.y >= -200 && box.y * view.scale + view.y <= size.height + 200);
  const shown = new Set(visible.map(box => box.node.id)), boxes = new Map(layout.nodes.map(box => [box.node.id, box]));
  const detailed = view.scale >= .18, edges = colors.map(() => ''), overview = colors.map(() => '');
  for (const box of layout.nodes) {
    const color = box.color % colors.length;
    if (!detailed) overview[color] += `M${box.x},${box.y}h${box.width}v${box.height}h-${box.width}Z`;
    if (!box.parent || (!shown.has(box.node.id) && !shown.has(box.parent))) continue;
    const parent = boxes.get(box.parent)!, x = parent.x + parent.width, y = parent.y + parent.height / 2, endY = box.y + box.height / 2;
    edges[color] += `M${x},${y}C${x + 40},${y} ${box.x - 60},${endY} ${box.x},${endY}`;
  }
  const toggle = (id: string) => setCollapsed(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <div className="mindmap-stage" ref={holder}>
    <div className="mindmap-controls"><button onClick={() => zoom(1.25)} aria-label="放大脑图">＋</button><span>{Math.round(view.scale * 100)}%</span><button onClick={() => zoom(.8)} aria-label="缩小脑图">−</button><button onClick={fit}>适应画布</button><button onClick={() => setCollapsed(new Set(root.children.filter(child => child.children.length).map(child => child.id)))}>收起到主干</button><button onClick={() => setCollapsed(new Set())}>展开全部</button></div>
    <svg className="mindmap-canvas" data-testid="mindmap-canvas" data-scale={view.scale} aria-label="Markdown 思维导图" onDoubleClick={event => { if ((event.target as Element).closest('[data-map-control]')) return; const rect = event.currentTarget.getBoundingClientRect(); zoom(.6 / view.scale, event.clientX - rect.left, event.clientY - rect.top); }} onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest('[data-map-control]')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; drag.current = { x: event.clientX, y: event.clientY }; setView(old => ({ ...old, x: old.x + dx, y: old.y + dy })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
        {edges.map((path, index) => path && <path key={index} d={path} fill="none" stroke={colors[index]} strokeWidth="2" opacity=".75" />)}
        {!detailed && overview.map((path, index) => path && <path key={`overview-${index}`} d={path} fill={colors[index]} fillOpacity=".25" stroke={colors[index]} strokeWidth="2" />)}
        {detailed && visible.map(box => <g key={box.node.id} transform={`translate(${box.x},${box.y})`}>
          <g data-map-control="label" {...activate(() => { if (box.node.target) onJump(box.node.target); else if (box.node.details.length) { setDetail(box.node); setDetailPage(0); } })} aria-label={`阅读节点 ${box.node.label}`} className="map-node-label"><title>{box.node.label}</title><rect width={box.width} height={box.height} rx="10" fill="#252c36" stroke={colors[box.color % colors.length]} strokeOpacity=".35" />
            <text x="16" y="26" fill="#e9edf2" fontSize="14">{box.lines.map((line, index) => <tspan x="16" dy={index ? 20 : 0} key={index}>{line}</tspan>)}</text>
          </g>
          {!!box.node.details.length && <g data-map-control="detail" {...activate(() => { setDetail(box.node); setDetailPage(0); })} aria-label={`查看说明 ${box.node.label}`} className="map-detail-button"><text x="16" y={box.height - 12} fill={colors[box.color % colors.length]} fontSize="11">▤ {box.node.details.length} 段说明</text></g>}
          {!!box.node.children.length && <g data-map-control="collapse" {...activate(() => toggle(box.node.id))} aria-label={`${collapsed.has(box.node.id) ? '展开' : '收起'}脑图 ${box.node.label}`} aria-expanded={!collapsed.has(box.node.id)} className="map-toggle"><circle cx={box.width} cy={box.height / 2} r="10" fill={colors[box.color % colors.length]} /><text x={box.width} y={box.height / 2 + 4} textAnchor="middle" fontSize="14" fill="#18202a">{collapsed.has(box.node.id) ? '+' : '−'}</text></g>}
        </g>)}
      </g>
    </svg>
    <p className="mindmap-hint">{detailed ? '拖动画布 · 滚轮缩放 · 圆点折叠 · 点击节点回到原文' : <span>全图概览 · 放大后查看节点文字</span>} <span>{layout.nodes.length} 个可见结构节点</span></p>
    {detail && <aside className="mindmap-details" data-testid="mindmap-details"><header><strong>{detail.label}</strong><button onClick={() => setDetail(undefined)} aria-label="关闭说明">×</button></header>{detail.details.slice(detailPage * 40, (detailPage + 1) * 40).map(item => <div key={item.target.id}><p>{item.text}</p><button onClick={() => onJump(item.target)}>在 Markdown 中查看</button></div>)}{detail.details.length > 40 && <div className="map-detail-pages"><button disabled={!detailPage} onClick={() => setDetailPage(old => old - 1)}>上一页说明</button><span>{detailPage + 1}/{Math.ceil(detail.details.length / 40)}</span><button disabled={(detailPage + 1) * 40 >= detail.details.length} onClick={() => setDetailPage(old => old + 1)}>下一页说明</button></div>}</aside>}
  </div>;
}
