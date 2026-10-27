import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markmap } from 'markmap-view';
import type { INode } from 'markmap-common';
import type { MindmapNode, ReaderDocument, ReaderPosition } from '../../../contracts/reader.ts';
import { markmapData } from './markmap-data.ts';

const colors = ['#e8a05c', '#79b9dd', '#a797dc', '#76bea5', '#d88ca1', '#c9bc6b'];
export function MindmapView({ document: note, visible, selectedId, focus, onSelect, onJump }: {
  document: ReaderDocument; visible: boolean; selectedId?: string; focus?: ReaderPosition;
  onSelect(node: MindmapNode): void; onJump(position: ReaderPosition): void;
}) {
  const model = useMemo(() => markmapData(note.content.mindmap, note.fileName), [note.content.mindmap, note.fileName]);
  const holder = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), engine = useRef<Markmap | undefined>(undefined);
  const index = useRef(new Map<string, INode>()), queue = useRef<Promise<unknown>>(Promise.resolve());
  const callbacks = useRef({ onSelect, onJump }); callbacks.current = { onSelect, onJump };
  const [ready, setReady] = useState(false), [scale, setScale] = useState(1), [error, setError] = useState(false);
  const run = useCallback((action: (map: Markmap) => Promise<unknown>) => {
    const map = engine.current; if (!map) return;
    queue.current = queue.current.then(() => engine.current === map ? action(map) : undefined).catch(() => { if (engine.current === map) setError(true); });
  }, []);
  useEffect(() => {
    let disposed = false, starting = false;
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), container = holder.current!;
    element.setAttribute('class', 'mindmap-canvas'); element.setAttribute('data-testid', 'mindmap-canvas'); element.setAttribute('data-scale', '1'); element.setAttribute('aria-label', 'Markdown 思维导图');
    const decorate = (map: Markmap) => {
      element.querySelectorAll<SVGGElement>('g.markmap-node').forEach(group => {
        const node = (group as unknown as { __data__: INode }).__data__, original = model.nodes.get(String(node.payload?.nodeId));
        const circle = group.querySelector('circle');
        if (!original || !circle || !node.children.length) return;
        circle.setAttribute('role', 'button'); circle.setAttribute('tabindex', '0');
        circle.setAttribute('aria-label', `${node.payload?.fold ? '展开' : '收起'}脑图 ${original.label}`);
        circle.setAttribute('aria-expanded', String(!node.payload?.fold));
      });
    };
    const start = async () => {
      if (disposed || starting || !container.clientWidth || !container.clientHeight) return;
      starting = true;
      // Passing data to Markmap.create calls fit unconditionally. Load separately to keep 100%.
      const map = new Markmap(element, {
        id: 'clipnote-markmap', autoFit: false, embedGlobalCSS: false, duration: 0,
        initialExpandLevel: 2, maxInitialScale: 1, maxWidth: 760, spacingHorizontal: 80, spacingVertical: 8,
        zoom: true, scrollForPan: false,
        // D3 zoom handles drag/touch pan; disable Markmap's additional wheel-pan handler.
        pan: false, lineWidth: node => node.state.depth === 1 ? 2.4 : 1.5,
        color: node => { const branch = node.state.path.split('.')[1] ?? '0'; return colors[Number(branch) % colors.length]; },
      });
      // Markmap creates even an empty inline <style>. Remove it before mounting under our strict CSP.
      // All required styles are bundled in reader.css; later writes affect only this detached style node.
      map.styleNode.remove(); canvas.current!.appendChild(element);
      engine.current = map;
      const render = map.renderData.bind(map);
      map.renderData = async origin => { if (disposed) return; await render(origin); if (!disposed) decorate(map); };
      map.handleClick = (event, node) => { event.stopPropagation(); run(async current => { await current.toggleNode(node); await current.ensureVisible(node, { left: 24, right: 24, top: 90, bottom: 40 }); }); };
      map.zoom.on('zoom.clipnote', (event: { transform: { k: number } }) => { if (!disposed) { element.setAttribute('data-scale', String(event.transform.k)); setScale(event.transform.k); } });
      try {
        await map.setData(model.root);
        if (disposed) return;
        const pending = [map.state.data!]; index.current = new Map();
        while (pending.length) { const node = pending.pop()!; index.current.set(String(node.payload?.nodeId), node); pending.push(...node.children); }
        const root = map.state.data!, transform = map.svg.property('__zoom');
        map.svg.call(map.zoom.transform, transform.translate(40 - root.state.rect.x, element.clientHeight / 2 - root.state.rect.y - root.state.rect.height / 2));
        setReady(true);
      } catch { if (!disposed) setError(true); }
    };
    const select = (event: MouseEvent) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-reader-node]'); if (!button) return;
      const node = model.nodes.get(decodeURIComponent(button.dataset.readerNode!)); if (node) callbacks.current.onSelect(node);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key) || !(event.target instanceof SVGElement) || event.target.getAttribute('role') !== 'button') return;
      const group = event.target.closest('g.markmap-node'), node = (group as unknown as { __data__?: INode })?.__data__;
      if (node && engine.current) { event.preventDefault(); engine.current.handleClick(event as unknown as MouseEvent, node); }
    };
    element.addEventListener('click', select); element.addEventListener('keydown', keyboard);
    const observer = new ResizeObserver(() => { if (!starting) void start(); else if (engine.current && container.clientWidth && container.clientHeight) run(map => map.renderData()); });
    observer.observe(container); void start();
    return () => { disposed = true; observer.disconnect(); element.removeEventListener('click', select); element.removeEventListener('keydown', keyboard); engine.current?.destroy(); element.remove(); engine.current = undefined; index.current.clear(); };
  }, [model, run]);
  useEffect(() => { if (visible && ready) run(map => map.renderData()); }, [visible, ready, run]);
  useEffect(() => {
    if (!ready) return;
    run(map => map.setHighlight(selectedId ? index.current.get(selectedId) : undefined));
  }, [selectedId, ready, run]);
  useEffect(() => {
    if (!focus || !ready) return;
    run(async map => {
      let parent = model.parents.get(focus.id);
      while (parent) { const node = index.current.get(parent); if (node) node.payload = { ...node.payload, fold: 0 }; parent = model.parents.get(parent); }
      const node = index.current.get(focus.id); if (!node) return;
      node.payload = { ...node.payload, fold: 0 };
      await map.renderData(); await map.setHighlight(node); await map.ensureVisible(node, { left: 24, right: 24, top: 90, bottom: 40 });
    });
  }, [focus, ready, model, run]);
  const selected = selectedId ? model.nodes.get(selectedId) : undefined;
  const restore = () => run(async map => { const k = map.svg.property('__zoom').k; await map.rescale(1 / k); await map.ensureVisible((selectedId && index.current.get(selectedId)) || map.state.data!, { left: 24, right: 24, top: 90, bottom: 40 }); });
  const fold = (all: boolean) => run(async map => { for (const node of index.current.values()) node.payload = { ...node.payload, fold: !all && node.state.depth >= 2 ? 1 : 0 }; await map.renderData(); });
  return <div className="mindmap-stage" ref={holder}>
    <div className="mindmap-controls"><button disabled={!ready} onClick={() => run(map => map.rescale(1.25))} aria-label="放大脑图">＋</button><span>{scale < .01 ? (scale * 100).toPrecision(2) : Math.round(scale * 100)}%</span><button disabled={!ready} onClick={() => run(map => map.rescale(.8))} aria-label="缩小脑图">−</button><button disabled={!ready} onClick={restore}>恢复可读比例</button><button disabled={!ready} onClick={() => run(map => map.fit(1))}>查看全图</button><button disabled={!ready} onClick={() => fold(false)}>章节主干</button><button disabled={!ready} onClick={() => fold(true)}>展开全部</button><button disabled={!ready || !selected} onClick={() => run(map => map.centerNode(index.current.get(selectedId!)!, { top: 90, bottom: 40 }))}>定位选中节点</button><button disabled={!selected?.target} onClick={() => { if (selected?.target) callbacks.current.onJump(selected.target); }}>查看原文</button></div>
    <div className="mindmap-canvas-wrap" ref={canvas} />
    {!ready && !error && <div className="map-loading" role="status">正在准备章节结构…</div>}
    {error && <div className="map-loading" role="alert">脑图暂时无法显示，可切换 Markdown 阅读或重新打开文件。</div>}
    <p className="mindmap-hint">拖动平移 · 滚轮缩放 · 圆点展开 · 点击文字选中<span>{selected ? `已选：${selected.label}` : '100% 为正常阅读比例'}</span></p>
  </div>;
}
