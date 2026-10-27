import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../../src/modules/reader/parse.ts';

test('mindmap preserves heading, paragraph and nested list order as directly readable branches', () => {
  const content = parseMarkdown('# 主题\n\n章节说明\n\n### 分支\n\n- 要点甲\n  - 例子乙\n\n    例子说明\n\n## 另一个分支\n\n结尾');
  const root = (content as any).mindmap;
  assert.ok(root, 'reader must expose a mindmap of the same AST');
  const topic = root.children[0]; assert.equal(topic.label, '主题'); assert.equal(topic.children[0].label, '章节说明');
  const branch = topic.children[1]; assert.equal(branch.label, '分支');
  assert.equal(branch.children[0].label, '要点甲'); assert.equal(branch.children[0].children[0].label, '例子乙');
  assert.equal(branch.children[0].children[0].children[0].label, '例子说明');
  assert.equal(topic.children[2].label, '另一个分支');
  assert.equal(branch.target.id, content.headings[0].children[0].id); assert.equal(branch.children[0].target.blockIndex, 3);
});
test('frontmatter stays hidden while a headingless document retains paragraph order and compact code entries', () => {
  const content = parseMarkdown('+++\ntitle="# 伪标题"\n+++\n\n普通段落\n\n```md\n# 代码标题\n```\n\n- 无标题要点\n  - 子要点');
  const root = (content as any).mindmap; assert.ok(root);
  assert.deepEqual(root.children.map((node: any) => node.kind), ['paragraph', 'code', 'listItem']);
  assert.equal(root.children[0].label, '普通段落'); assert.match(root.children[1].label, /代码/); assert.doesNotMatch(root.children[1].label, /代码标题/);
  assert.equal(root.children[2].label, '无标题要点'); assert.equal(root.children[2].children[0].label, '子要点');
});
test('every repeated list node targets its own AST block including blocks beyond the first page', () => {
  const content = parseMarkdown('段落\n\n'.repeat(110) + '- 重复\n- 重复');
  const root = (content as any).mindmap; assert.ok(root);
  const [a, b] = root.children.slice(110); assert.notEqual(a.target.id, b.target.id); assert.equal(a.target.blockIndex, 110);
  const list = content.root.children[110] as any;
  assert.equal(a.target.id, list.children[0].data.readerId); assert.equal(b.target.id, list.children[1].data.readerId);
});
test('heading names cannot collide with generated paragraph or root node identifiers', () => {
  const content = parseMarkdown('# map-root\n\n# md-5\n\n正文\n\n- 要点');
  const ids: string[] = [], pending: any[] = [content.mindmap];
  while (pending.length) { const node = pending.pop()!; ids.push(node.id); pending.push(...node.children); }
  assert.equal(new Set(ids).size, ids.length);
});
test('headings inside list items keep their own outline IDs and navigation targets', () => {
  const content = parseMarkdown('# Topic\n\n- ## Nested heading\n\n  Detail\n\n- Introduction\n\n  ### Later heading\n\n  More detail');
  const ids = new Set<string>(), pending = [content.mindmap];
  while (pending.length) { const node = pending.pop()!; ids.add(node.id); pending.push(...node.children); }
  assert.ok(ids.has('nested-heading')); assert.ok(ids.has('later-heading'));
});
test('explicit line breaks preserve word boundaries in paragraph and list labels', () => {
  const root = parseMarkdown('first  \nsecond\n\n- machine\\\n  learning').mindmap;
  assert.equal(root.children[0].label, 'first\nsecond'); assert.equal(root.children[1].label, 'machine\nlearning');
});
test('a code-first list item retains code before its later paragraph', () => {
  const item = parseMarkdown('- ```txt\n  code\n  ```\n\n  after code').mindmap.children[0];
  assert.equal(item.label, '列表项'); assert.deepEqual(item.children.map(node => node.kind), ['code', 'paragraph']); assert.equal(item.children[1].label, 'after code');
});
