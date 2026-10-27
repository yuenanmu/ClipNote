import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../../src/modules/source/parser.ts';
import { planAnalysis } from '../../src/modules/analysis/plan.ts';
import { validateOutline } from '../../src/modules/analysis/validate.ts';
import { AnalysisError } from '../../src/modules/analysis/errors.ts';
import type { AnalysisProfile, SourceRef, NoteOutline } from '../../src/contracts/analysis.ts';
export const profile: AnalysisProfile = { provider: 'synthetic', model: 'fixture', promptVersion: 't06-v1', inputCharBudget: 2000, outputCharBudget: 64000, overlapChars: 80 };
const source = (text: string, extension = 'txt') => parseSource(Buffer.from(text), `合成.${extension}`);
const ref = (s: ReturnType<typeof source>, index = 0): SourceRef => ({ segmentId: s.segments[index].segmentId, startOffset: 0, endOffset: s.segments[index].text.length });
const outline = (refs: SourceRef[]): NoteOutline => ({ title: '合成笔记', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text: '要点', refs, children: [{ kind: 'example', text: '例子', refs, children: [] }] }] }] });
const code = (expected: string) => (error: unknown) => error instanceof AnalysisError && error.code === expected;

test('short sources use one deterministic request without local paths and preserve exact segment references', () => {
  const s = source('第一段\r\n第二行\r\n\r\n第二段'); const plan = planAnalysis(s, profile);
  assert.equal(plan.chunks.length, 1); assert.deepEqual(plan.chunks[0].core, s.segments.map((_, i) => ref(s, i)));
  assert.equal(plan.planId, planAnalysis(s, profile).planId); assert.notEqual(plan.planId, planAnalysis(s, { ...profile, model: 'other' }).planId);
  assert.ok(plan.chunks[0].request.includes(JSON.stringify(s.segments[0].text))); assert.ok(!plan.chunks[0].request.includes(s.originalPath));
});
test('long paragraphs are fully covered within serialized budgets without splitting emoji or inventing timestamps', () => {
  const s = source(('中文😀\r\n"\\').repeat(1300)); const plan = planAnalysis(s, profile); assert.ok(plan.chunks.length > 1);
  let end = 0; let recovered = '';
  for (const chunk of plan.chunks) {
    assert.ok(chunk.request.length <= profile.inputCharBudget);
    for (const r of chunk.core) { assert.equal(r.startOffset, end); end = r.endOffset; const piece = s.segments[0].text.slice(r.startOffset, r.endOffset); assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(piece)); recovered += piece; }
    assert.ok(chunk.context.reduce((n, r) => n + r.endOffset - r.startOffset, 0) <= profile.overlapChars);
    assert.ok(!chunk.request.includes('startMs'));
  }
  assert.equal(recovered, s.segments[0].text);
});
test('invalid budgets and excessive chunk counts fail explicitly rather than silently truncating input', () => {
  const s = source('原文');
  for (const patch of [{ inputCharBudget: NaN }, { inputCharBudget: 10 }, { overlapChars: -1 }, { outputCharBudget: Infinity }]) assert.throws(() => planAnalysis(s, { ...profile, ...patch }), code('INVALID_PROFILE'));
  assert.throws(() => planAnalysis(source('长'.repeat(2_000_000)), { ...profile, inputCharBudget: 1000 }), code('TOO_LARGE'));
});
test('outline validation returns a clean structure and rejects empty, unknown, cyclic and excessively nested structures', () => {
  const s = source('原文依据'); const value = outline([ref(s)]); assert.deepEqual(validateOutline(value, s), value);
  for (const invalid of [{ ...value, sections: [] }, { ...value, password: 'private' }, { ...value, title: '' }]) assert.throws(() => validateOutline(invalid, s), code('INVALID_STRUCTURE'));
  const cyclic = outline([ref(s)]); cyclic.sections[0].items[0].children.push(cyclic.sections[0].items[0]); assert.throws(() => validateOutline(cyclic, s), code('INVALID_STRUCTURE'));
});
test('every substantive entry needs existing in-range evidence and chunk references cannot cite unseen text', () => {
  const s = source('字'.repeat(6000)); const plan = planAnalysis(s, profile); const chunk = plan.chunks[0];
  assert.doesNotThrow(() => validateOutline(outline(chunk.core), s, chunk));
  for (const refs of [[], [{ ...ref(s), segmentId: 'foreign' }], [{ ...ref(s), startOffset: -1 }], [{ ...ref(s), endOffset: 6001 }], [{ ...ref(s), endOffset: 0 }], [ref(s)]]) assert.throws(() => validateOutline(outline(refs), s, chunk), code('INVALID_REFERENCE'));
  const invalid = outline(chunk.core); invalid.sections[0].items[0].children[0].refs = []; assert.throws(() => validateOutline(invalid, s, chunk), code('INVALID_REFERENCE'));
});
test('source segment identities, offsets and text must be internally consistent before analysis', () => {
  const s = source('原文'); assert.throws(() => planAnalysis({ ...s, segments: [s.segments[0], s.segments[0]] }, profile), code('INVALID_SOURCE'));
  assert.throws(() => planAnalysis({ ...s, segments: [{ ...s.segments[0], text: '篡改' }] }, profile), code('INVALID_SOURCE'));
});
