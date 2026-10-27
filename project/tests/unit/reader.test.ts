import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, classifyLink, MAX_READER_BYTES } from '../../src/modules/reader/parse.ts';
import type { ReaderHeading } from '../../src/contracts/reader.ts';
const flatten = (headings: ReaderHeading[]): ReaderHeading[] => headings.flatMap(item => [item, ...flatten(item.children)]);
test('an empty or heading-free document remains readable without invented headings', () => {
  assert.equal(parseMarkdown('').root.children.length, 0);
  const parsed = parseMarkdown('普通正文\n\n第二段');
  assert.equal(parsed.headings.length, 0); assert.equal(parsed.root.children.length, 2);
});
test('one AST gives formatted, repeated and skipped headings unique matching anchors', () => {
  const parsed = parseMarkdown('# 中文 **介绍**\n\n### 同名\n\n## 同名\n\n# 中文 介绍\n\n同名\n---');
  const headings = flatten(parsed.headings);
  assert.deepEqual(headings.map(item => item.title), ['中文 介绍', '同名', '同名', '中文 介绍', '同名']);
  assert.deepEqual(headings.map(item => item.depth), [1,3,2,1,2]);
  assert.equal(new Set(headings.map(item => item.id)).size, 5);
  assert.equal(parsed.headings[0].children[0].depth, 3);
  for (const heading of headings) assert.equal((parsed.root.children[heading.blockIndex].data as { id?: string })?.id, heading.id);
});
test('YAML and TOML frontmatter plus fenced and indented code do not create fake headings', () => {
  for (const delimiter of ['---','+++']) {
    const parsed = parseMarkdown(`${delimiter}\n# 假标题\n${delimiter}\n\n~~~md\n# 围栏标题\n~~~\n\n    # 缩进标题\n\n# 真标题`);
    assert.deepEqual(flatten(parsed.headings).map(item => item.title), ['真标题']);
  }
});
test('GFM tables, tasks and raw HTML remain AST data rather than executable markup', () => {
  const parsed = parseMarkdown('|列|值|\n|--|--|\n|a|b|\n\n- [x] 已完成\n\n<script>globalThis.bad=1</script>');
  assert.equal(parsed.root.children[0].type, 'table');
  assert.equal(parsed.root.children.at(-1)!.type, 'html');
});
test('links admit known fragments, safe HTTP(S) and only the registered archive source', () => {
  const parsed = parseMarkdown('# 介绍\n\n[外链](https://example.com/a)');
  assert.deepEqual(classifyLink('#%E4%BB%8B%E7%BB%8D', parsed), { kind: 'anchor', id: '介绍' });
  assert.deepEqual(classifyLink('https://example.com/a', parsed), { kind: 'external', url: 'https://example.com/a' });
  const archive = { sourceId: 's', revisionId: 'r', sourceFile: 'source.srt', segmentIds: ['segment-1'] };
  assert.deepEqual(classifyLink('source.srt#segment-1', parsed, archive), { kind: 'source', segmentId: 'segment-1' });
  assert.deepEqual(classifyLink('clipnote-source:segment-1', parsed, archive), { kind: 'source', segmentId: 'segment-1' });
  for (const url of ['javascript:alert(1)','data:text/html,x','file:///C:/private','//host/a','https://u:p@example.com','https://example.com/\nx','#missing','source.srt#missing','../../source.srt']) assert.equal(classifyLink(url, parsed, archive).kind, 'blocked', url);
  assert.equal(classifyLink('source.srt', parsed).kind, 'blocked');
});
test('anchor collisions remain unique even when a title already contains a generated suffix', () => {
  const headings = flatten(parseMarkdown('# a\n# a\n# a-2\n# a').headings);
  assert.equal(new Set(headings.map(item => item.id)).size, 4);
});
test('oversized and excessive structures fail explicitly rather than return truncated content', () => {
  assert.throws(() => parseMarkdown('字'.repeat(MAX_READER_BYTES)), { code: 'READER_TOO_LARGE' });
  assert.throws(() => parseMarkdown('x\n\n'.repeat(11_000)), { code: 'READER_TOO_COMPLEX' });
  assert.throws(() => parseMarkdown('> '.repeat(80) + '正文'), { code: 'READER_TOO_COMPLEX' });
});
