import type { SourceDocument } from '../../contracts/source.ts';
import type { AnalysisProfile, AnalysisAdapter, AnalysisOptions, AnalysisResult, NoteOutline, NoteItem, SourceRef, ChunkCheckpoint } from '../../contracts/analysis.ts';
import { planAnalysis } from './plan.ts';
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
  const plan = planAnalysis(source, profile); const snapshot = structuredClone(source); const completed = new Map<string, ChunkCheckpoint>();
  const checkpoints = () => plan.chunks.flatMap(c => completed.has(c.chunkId) ? [structuredClone(completed.get(c.chunkId)!)] : []);
  const cancelled = () => { if (options.signal?.aborted) throw new AnalysisError('CANCELLED'); };
  function output(value: unknown): unknown {
    let serialized: string;
    try { serialized = typeof value === 'string' ? value : JSON.stringify(value); } catch { throw new AnalysisError('INVALID_STRUCTURE'); }
    if (typeof serialized !== 'string') throw new AnalysisError('INVALID_STRUCTURE');
    if (serialized.length > plan.profile.outputCharBudget) throw new AnalysisError('TOO_LARGE');
    try { return JSON.parse(serialized); } catch { throw new AnalysisError('INVALID_STRUCTURE'); }
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
      let outline: NoteOutline | undefined;
      for (let repair = 0; repair <= 1; repair++) {
        cancelled();
        const response = await adapter({ chunk: structuredClone(chunk), profile: { ...plan.profile }, signal: options.signal, repair: repair === 1 });
        cancelled();
        if (response?.status === 'truncated') throw new AnalysisError('TRUNCATED');
        if (response?.status !== 'completed') throw new AnalysisError('SERVICE_FAILED');
        try { outline = validateOutline(output(response.value), snapshot, chunk); break; }
        catch (error) { if (!(error instanceof AnalysisError) || error.code !== 'INVALID_STRUCTURE' || repair === 1) throw error; }
      }
      const cp = { planId: plan.planId, chunkId: chunk.chunkId, outline: outline! }; completed.set(chunk.chunkId, cp);
      await options.onCheckpoint?.(structuredClone(cp)); cancelled();
    }
    const all = checkpoints(); const outline = validateOutline(mergeOutlines(all.map(cp => cp.outline)), snapshot); const markdown = renderMarkdown(outline, snapshot); cancelled();
    const refs = new Set<string>();
    const visit = (items: NoteItem[]) => items.forEach(i => { i.refs.forEach(r => refs.add(r.segmentId)); visit(i.children); });
    outline.sections.forEach(s => { s.refs.forEach(r => refs.add(r.segmentId)); visit(s.items); });
    return { outline, markdown, sourceRefs: snapshot.segments.filter(s => refs.has(s.segmentId)).map(s => s.segmentId), attempt: { provider: plan.profile.provider, model: plan.profile.model, promptVersion: plan.profile.promptVersion, planId: plan.planId }, checkpoints: all };
  } catch (error) { throw new AnalysisError(options.signal?.aborted ? 'CANCELLED' : error instanceof AnalysisError ? error.code : 'SERVICE_FAILED', checkpoints()); }
}
