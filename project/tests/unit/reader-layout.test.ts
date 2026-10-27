import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../../src/modules/reader/parse.ts';
import { markmapData } from '../../src/renderer/features/reader/markmap-data.ts';
import { boundSplitRatio, readSplitRatio } from '../../src/renderer/features/reader/split-preference.ts';
test('Markmap content escapes untrusted text and preserves original positions and ancestry', () => {
  const source = parseMarkdown('# 标题\n\n<script>window.attack=1</script>\n\n- 带有 "引号" 的要点\n  - 依据');
  const { root, nodes, parents } = markmapData(source.mindmap, '资料.md');
  const literal = root.children[0]; assert.match(literal.content, /&lt;script&gt;window.attack=1&lt;\/script&gt;/); assert.doesNotMatch(literal.content, /<script>/);
  const list = root.children[1], child = list.children[0];
  assert.match(list.content, /&quot;引号&quot;/); assert.equal(child.payload?.blockIndex, 2);
  assert.equal(parents.get(String(child.payload?.nodeId)), list.payload?.nodeId);
  assert.equal(nodes.get(String(child.payload?.nodeId))?.label, '依据');
});
test('split ratios stay finite and respect two 280px panes independently of available width', () => {
  assert.equal(boundSplitRatio(.1, 1008), .28); assert.equal(boundSplitRatio(.99, 1008), .72);
  assert.equal(boundSplitRatio(.4, 1008), .4); assert.equal(boundSplitRatio(NaN, 1008), .4);
  assert.equal(boundSplitRatio(.4, 568), .5);
});
test('invalid or unavailable saved preferences fall back to 40 percent', () => {
  for (const text of [null, '', 'NaN', 'Infinity', '-1', '1.2']) assert.equal(readSplitRatio({ getItem: () => text }), .4);
  assert.equal(readSplitRatio({ getItem: () => '.55' }), .55);
  assert.equal(readSplitRatio({ getItem: () => { throw new Error('disabled'); } }), .4);
});
