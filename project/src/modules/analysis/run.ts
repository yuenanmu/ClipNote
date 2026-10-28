import type { SourceDocument } from '../../contracts/source.ts';
import type { AnalysisProfile, AnalysisAdapter, AnalysisOptions, AnalysisResult, NoteOutline, NoteItem, SourceRef, ChunkCheckpoint, AnalysisChunk } from '../../contracts/analysis.ts';
import { planAnalysis, ANALYSIS_INSTRUCTION } from './plan.ts';
import { validateOutline } from './validate.ts';
import { renderMarkdown } from './markdown.ts';
import { AnalysisError } from './errors.ts';
function refKey(refs: SourceRef[]): string { return JSON.stringify(refs.map(r => [r.segmentId, r.startOffset, r.endOffset]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))); }
function mergeOutlines(outlines: NoteOutline[]): NoteOutline {
  const result: NoteOutline = { title: outlines[0].title, sections: [] }; const sections = new Map<string, NoteOutline['sections'][number]>();
  function mergeItems(target: NoteItem[], incoming: NoteItem[]) {
    const known = new Map(target.map(i => [JSON.stringify([i.kind, i.text, refKey(i.refs)]), i]));
    for (const item of incoming) { const key = JSON.stringify([item.kind, item.text, refKey(item.refs)]); let entry = known.get(key); if (!entry) { entry = { ...item, refs: structuredClone(item.refs), children: [] }; target.push(entry); known.set(key, entry); } mergeItems(entry.children, item.children); }
  }
  for (const outline of outlines) for (const section of outline.sections) {
    const key = JSON.stringify([section.heading, refKey(section.refs)]); let entry = sections.get(key);
    if (!entry) { entry = { ...section, refs: structuredClone(section.refs), items: [] }; sections.set(key, entry); result.sections.push(entry); }
    mergeItems(entry.items, section.items);
  }
  return result;
}
export async function analyzeSource(source: SourceDocument, profile: AnalysisProfile, adapter: AnalysisAdapter, options: AnalysisOptions = {}): Promise<AnalysisResult> {
  const started = performance.now(); const plan = planAnalysis(source, profile); const snapshot = structuredClone(source); options.onPrepared?.(performance.now() - started); const completed = new Map<string, ChunkCheckpoint>();
  const checkpoints = () => plan.chunks.flatMap(c => completed.has(c.chunkId) ? [structuredClone(completed.get(c.chunkId)!)] : []);
  const cancelled = () => { if (options.signal?.aborted) throw new AnalysisError('CANCELLED'); };
  function output(value: unknown): unknown {
    let serialized: string;
    try { serialized = typeof value === 'string' ? value : JSON.stringify(value); } catch { throw new AnalysisError('INVALID_STRUCTURE'); }
    if (typeof serialized !== 'string') throw new AnalysisError('INVALID_STRUCTURE');
    if (serialized.length > plan.profile.outputCharBudget) throw new AnalysisError('TOO_LARGE');
    try { return JSON.parse(serialized); } catch { throw new AnalysisError('INVALID_STRUCTURE'); }
  }
  const segments = new Map(snapshot.segments.map(segment => [segment.segmentId, segment]));
  function split(chunk: AnalysisChunk): AnalysisChunk[] | undefined {
    const total = chunk.core.reduce((sum, ref) => sum + ref.endOffset - ref.startOffset, 0);
    if (total < 2) return undefined;
    const left: SourceRef[] = [], right: SourceRef[] = []; let remaining = Math.floor(total / 2);
    for (const ref of chunk.core) {
      const size = ref.endOffset - ref.startOffset;
      if (remaining <= 0) { right.push(ref); continue; }
      if (remaining >= size) { left.push(ref); remaining -= size; continue; }
      let cut = ref.startOffset + remaining; const text = segments.get(ref.segmentId)!.text;
      if (/[\uDC00-\uDFFF]/.test(text[cut]) && /[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
      if (cut > ref.startOffset) left.push({ ...ref, endOffset: cut });
      if (cut < ref.endOffset) right.push({ ...ref, startOffset: cut });
      remaining = 0;
    }
    if (!left.length || !right.length) return undefined;
    return [left, right].map((core, index) => {
      const data = core.map(ref => ({ ...ref, text: segments.get(ref.segmentId)!.text.slice(ref.startOffset, ref.endOffset) }));
      const request = ANALYSIS_INSTRUCTION + '\n' + JSON.stringify({ sourceId: snapshot.sourceId, promptVersion: plan.profile.promptVersion, ...(plan.profile.instructions ? { userInstructions: plan.profile.instructions } : {}), core: data, context: [] });
      return { chunkId: `${chunk.chunkId}.${index + 1}`, index: chunk.index, core, context: [], request };
    });
  }
  async function analyzeChunk(chunk: AnalysisChunk, depth: number): Promise<NoteOutline> {
    for (let repair = 0; repair <= 1; repair++) {
      cancelled();
      const response = await adapter({ chunk: structuredClone(chunk), profile: { ...plan.profile }, signal: options.signal, repair: repair === 1 });
      cancelled();
      if (response?.status === 'truncated') {
        const children = options.splitTruncated && depth < 3 ? split(chunk) : undefined;
        if (!children) throw new AnalysisError('TRUNCATED');
        const outlines: NoteOutline[] = []; for (const child of children) outlines.push(await analyzeChunk(child, depth + 1));
        return validateOutline(mergeOutlines(outlines), snapshot, chunk);
      }
      if (response?.status !== 'completed') throw new AnalysisError('SERVICE_FAILED');
      try { return validateOutline(output(response.value), snapshot, chunk); }
      catch (error) { if (!(error instanceof AnalysisError) || error.code !== 'INVALID_STRUCTURE' || repair === 1) throw error; }
    }
    throw new AnalysisError('INVALID_STRUCTURE');
  }
  try {
    cancelled();
    if (options.checkpoints !== undefined && (!Array.isArray(options.checkpoints) || options.checkpoints.length > plan.chunks.length)) throw new AnalysisError('INVALID_CHECKPOINT');
    for (const cp of options.checkpoints ?? []) {
      const chunk = plan.chunks.find(c => c.chunkId === cp?.chunkId);
      if (!cp || Object.keys(cp).length !== 3 || cp.planId !== plan.planId || !chunk || completed.has(cp.chunkId)) throw new AnalysisError('INVALID_CHECKPOINT');
      try { completed.set(cp.chunkId, { planId: plan.planId, chunkId: chunk.chunkId, outline: validateOutline(output(cp.outline), snapshot, chunk) }); } catch { throw new AnalysisError('INVALID_CHECKPOINT'); }
    }
    for (const chunk of plan.chunks) {
      cancelled(); if (completed.has(chunk.chunkId)) continue;
      const outline = await analyzeChunk(chunk, 0);
      const cp = { planId: plan.planId, chunkId: chunk.chunkId, outline }; completed.set(chunk.chunkId, cp);
      await options.onCheckpoint?.(structuredClone(cp)); cancelled();
    }
    const all = checkpoints(); const outline = validateOutline(mergeOutlines(all.map(cp => cp.outline)), snapshot); const markdown = renderMarkdown(outline, snapshot); cancelled();
    const refs = new Set<string>();
    const visit = (items: NoteItem[]) => items.forEach(i => { i.refs.forEach(r => refs.add(r.segmentId)); visit(i.children); });
    outline.sections.forEach(s => { s.refs.forEach(r => refs.add(r.segmentId)); visit(s.items); });
    return { outline, markdown, sourceRefs: snapshot.segments.filter(s => refs.has(s.segmentId)).map(s => s.segmentId), attempt: { provider: plan.profile.provider, model: plan.profile.model, promptVersion: plan.profile.promptVersion, planId: plan.planId }, checkpoints: all };
  } catch (error) { throw new AnalysisError(options.signal?.aborted ? 'CANCELLED' : error instanceof AnalysisError ? error.code : 'SERVICE_FAILED', checkpoints()); }
}
