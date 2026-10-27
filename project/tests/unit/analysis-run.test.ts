import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../../src/modules/source/parser.ts';
import { planAnalysis } from '../../src/modules/analysis/plan.ts';
import { analyzeSource } from '../../src/modules/analysis/run.ts';
import { renderMarkdown } from '../../src/modules/analysis/markdown.ts';
import { AnalysisError } from '../../src/modules/analysis/errors.ts';
import { parseMarkdown } from '../../src/modules/reader/parse.ts';
import type { AnalysisProfile, SourceRef, NoteOutline, AnalysisChunk, ChunkCheckpoint } from '../../src/contracts/analysis.ts';
const profile: AnalysisProfile = { provider: 'synthetic', model: 'fixture', promptVersion: 't06-v1', inputCharBudget: 2000, outputCharBudget: 64000, overlapChars: 80 };
const source = (text: string) => parseSource(Buffer.from(text), '合成.txt');
const outline = (refs: SourceRef[], text = '要点'): NoteOutline => ({ title: '合成笔记', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text, refs, children: [] }] }] });
const result = (chunk: AnalysisChunk) => ({ status: 'completed' as const, value: outline(chunk.core) });
const code = (expected: string) => (e: unknown) => e instanceof AnalysisError && e.code === expected;

test('serial analysis covers all chunks and returns deterministic Markdown with explicit attempt ownership', async () => {
  const s = source('原文'.repeat(4000)); const plan = planAnalysis(s, profile); const calls: number[] = []; let active = 0;
  const value = await analyzeSource(s, profile, async request => { assert.equal(active++, 0); calls.push(request.chunk.index); await Promise.resolve(); active--; return result(request.chunk); });
  assert.deepEqual(calls, plan.chunks.map(c => c.index)); assert.equal(value.checkpoints.length, plan.chunks.length);
  assert.deepEqual(value.attempt, { provider: profile.provider, model: profile.model, promptVersion: profile.promptVersion, planId: plan.planId });
  assert.equal(value.markdown, renderMarkdown(value.outline, s)); assert.deepEqual(value.sourceRefs, [s.segments[0].segmentId]);
});
test('one format repair is allowed per malformed completed block; invalid references and truncation never become success', async () => {
  const s = source('依据'); let calls: boolean[] = [];
  const fixed = await analyzeSource(s, profile, async r => { calls.push(r.repair); return r.repair ? result(r.chunk) : { status: 'completed', value: 'not-json' }; });
  assert.deepEqual(calls, [false, true]); assert.equal(fixed.checkpoints.length, 1);
  calls = [];
  await assert.rejects(analyzeSource(s, profile, async r => { calls.push(r.repair); return { status: 'completed', value: {} }; }), code('INVALID_STRUCTURE')); assert.deepEqual(calls, [false, true]);
  let count = 0;
  await assert.rejects(analyzeSource(s, profile, async r => { count++; return { status: 'completed', value: outline([{ ...r.chunk.core[0], segmentId: 'foreign' }]) }; }), code('INVALID_REFERENCE')); assert.equal(count, 1);
  await assert.rejects(analyzeSource(s, profile, async r => ({ status: 'truncated', value: result(r.chunk).value })), code('TRUNCATED'));
});
test('failure retains validated completed checkpoints, supports explicit resume and rejects foreign or duplicate checkpoints', async () => {
  const s = source('原文'.repeat(4000)); let saved: ChunkCheckpoint[] = [];
  await assert.rejects(analyzeSource(s, profile, async r => { if (r.chunk.index === 1) throw new Error('private service content'); return result(r.chunk); }, { onCheckpoint: cp => { saved.push(cp); } }), (e: unknown) => { assert.ok(e instanceof AnalysisError); assert.equal(e.code, 'SERVICE_FAILED'); assert.ok(!e.message.includes('private')); assert.equal(e.checkpoints.length, 1); return true; });
  const calls: number[] = []; const resumed = await analyzeSource(s, profile, async r => { calls.push(r.chunk.index); return result(r.chunk); }, { checkpoints: saved });
  assert.ok(!calls.includes(0)); assert.equal(resumed.checkpoints.length, planAnalysis(s, profile).chunks.length);
  for (const checkpoints of [[...saved, ...saved], [{ ...saved[0], planId: 'foreign' }], [{ ...saved[0], chunkId: 'unknown' }]]) await assert.rejects(analyzeSource(s, profile, async r => result(r.chunk), { checkpoints }), code('INVALID_CHECKPOINT'));
  await assert.rejects(analyzeSource(s, { ...profile, model: 'other' }, async r => result(r.chunk), { checkpoints: saved }), code('INVALID_CHECKPOINT'));
});
test('cancellation before or during a call preserves progress and cannot publish the late response', async () => {
  const s = source('原文'.repeat(4000)); const controller = new AbortController(); let calls = 0;
  await assert.rejects(analyzeSource(s, profile, async r => { calls++; assert.equal(r.signal, controller.signal); if (calls === 2) controller.abort(); return result(r.chunk); }, { signal: controller.signal }), (e: unknown) => e instanceof AnalysisError && e.code === 'CANCELLED' && e.checkpoints.length === 1);
  calls = 0; await assert.rejects(analyzeSource(s, profile, async r => { calls++; return result(r.chunk); }, { signal: controller.signal }), code('CANCELLED')); assert.equal(calls, 0);
});
test('overlap duplicates merge only when kind, exact text and evidence agree; unique children and different evidence survive', async () => {
  const s = source('字'.repeat(5000)); const plan = planAnalysis(s, profile); assert.ok(plan.chunks.length > 1);
  const merged = await analyzeSource(s, profile, async r => {
    const evidence = r.chunk.index === 0 ? [{ ...r.chunk.core[0], startOffset: r.chunk.core[0].endOffset - 20 }] : r.chunk.context.slice(-1);
    const own = outline(evidence.length ? evidence : r.chunk.core, '相同文字');
    // Exact duplicate within one result must not drop a unique child.
    const parent = own.sections[0].items[0]; own.sections[0].items.push({ ...parent, children: [{ kind: 'example', text: `例子${r.chunk.index}`, refs: r.chunk.core, children: [] }] });
    return { status: 'completed', value: own };
  });
  const examples = merged.outline.sections.flatMap(s => s.items.flatMap(i => i.children));
  assert.equal(examples.length, plan.chunks.length);
  assert.ok(merged.outline.sections.length > 1, 'same wording with different evidence is retained');
});
test('Markdown uses chapters and nested evidence lists, escapes injection and derives real times only from source', () => {
  const s = parseSource(Buffer.from('1\r\n00:00:01,230 --> 00:00:03,000\r\n真实字幕'), '合成.srt'); const refs = [{ segmentId: s.segments[0].segmentId, startOffset: 0, endOffset: 2 }];
  const value = outline(refs, '<script>x</script>\n# 伪标题 [危险](https://invalid.test)'); value.sections[0].items[0].children.push({ kind: 'limitation', text: '限制', refs, children: [] });
  const md = renderMarkdown(value, s); assert.ok(md.includes('00:00:01.230')); assert.ok(!md.includes('<script>')); assert.ok(!md.includes('\n# 伪标题')); assert.ok(md.includes('  - 限制：'));
  const parsed = parseMarkdown(md); assert.equal(parsed.headings.length, 1); assert.equal(parsed.headings[0].children.length, 1); assert.ok(parsed.mindmap.children[0].children[0].children.some(n => n.kind === 'listItem'));
  assert.equal(renderMarkdown(value, s), md);
  const txt = source('普通段落'); const txtMd = renderMarkdown(outline([{ segmentId: txt.segments[0].segmentId, startOffset: 0, endOffset: 4 }]), txt); assert.ok(txtMd.includes('段落1')); assert.ok(!txtMd.includes('00:00:'));
});
test('oversized model output fails without a repair call or partial success', async () => {
  const s = source('原文'); let calls = 0;
  await assert.rejects(analyzeSource(s, { ...profile, outputCharBudget: 1000 }, async () => { calls++; return { status: 'completed', value: 'x'.repeat(1001) }; }), code('TOO_LARGE')); assert.equal(calls, 1);
});

test('bare URLs and emails in model prose remain text and cannot consume generated evidence links', () => {
  const s = source('原文'); const refs = [{ segmentId: s.segments[0].segmentId, startOffset: 0, endOffset: 2 }];
  for (const prose of ['https://localhost', 'https://example.com/x?a=1', 'www.example.com', 'person@example.com']) {
    const value = outline(refs, prose); value.title = prose; value.sections[0].heading = prose;
    const parsed = parseMarkdown(renderMarkdown(value, s)); const links: string[] = [];
    const walk = (node: any) => { if (node.type === 'link') links.push(node.url); for (const child of node.children ?? []) walk(child); }; walk(parsed.root);
    assert.equal(links.length, 2, prose); assert.ok(links.every(url => url.startsWith('clipnote-source:')), prose);
  }
});

test('generated output exceeding actual reader AST complexity fails explicitly and preserves completed chunks', async () => {
  const s = source('原文'); const refs = [{ segmentId: s.segments[0].segmentId, startOffset: 0, endOffset: 2 }];
  const value = outline(refs, 'a ' + Array(6000).fill('@').join(' '));
  value.sections[0].items.push({ kind: 'point', text: 'b ' + Array(6000).fill('@').join(' '), refs, children: [] });
  assert.throws(() => renderMarkdown(value, s), code('TOO_LARGE'));
  await assert.rejects(analyzeSource(s, profile, async () => ({ status: 'completed', value })), (e: unknown) => e instanceof AnalysisError && e.code === 'TOO_LARGE' && e.checkpoints.length === 1);
});
