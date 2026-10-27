import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../../src/modules/reader/parse.ts';

test('mindmap preserves heading and nested list ancestry with paragraphs attached as descriptions', () => {
  const content = parseMarkdown('# 主题\n\n章节说明\n\n### 分支\n\n- 要点甲\n  - 例子乙\n\n    例子说明\n\n## 另一个分支\n\n结尾');
  const root = (content as any).mindmap;
  assert.ok(root, 'reader must expose a mindmap of the same AST');
  const topic = root.children[0]; assert.equal(topic.label, '主题'); assert.equal(topic.details[0].text, '章节说明');
  const branch = topic.children[0]; assert.equal(branch.label, '分支');
  assert.equal(branch.children[0].label, '要点甲'); assert.equal(branch.children[0].children[0].label, '例子乙');
  assert.equal(branch.children[0].children[0].details[0].text, '例子说明');
  assert.equal(topic.children[1].label, '另一个分支');
  assert.equal(branch.target.id, content.headings[0].children[0].id); assert.equal(branch.children[0].target.blockIndex, 3);
});
test('frontmatter and code cannot create branches; a headingless document retains readable descriptions and lists', () => {
  const content = parseMarkdown('+++\ntitle="# 伪标题"\n+++\n\n普通段落\n\n```md\n# 代码标题\n```\n\n- 无标题要点\n  - 子要点');
  const root = (content as any).mindmap; assert.ok(root);
  assert.equal(root.children.length, 1); assert.equal(root.children[0].label, '无标题要点');
  assert.equal(root.details[0].text, '普通段落'); assert.equal(root.children[0].children[0].label, '子要点');
});
test('every repeated list node targets its own AST block including blocks beyond the first page', () => {
  const content = parseMarkdown('段落\n\n'.repeat(110) + '- 重复\n- 重复');
  const root = (content as any).mindmap; assert.ok(root);
  const [a, b] = root.children; assert.notEqual(a.target.id, b.target.id); assert.equal(a.target.blockIndex, 110);
  const list = content.root.children[110] as any;
  assert.equal(a.target.id, list.children[0].data.readerId); assert.equal(b.target.id, list.children[1].data.readerId);
});
test('heading names cannot collide with generated paragraph or root node identifiers', () => {
  const content = parseMarkdown('# map-root\n\n# md-5\n\n正文\n\n- 要点');
  const ids: string[] = [], pending: any[] = [content.mindmap];
  while (pending.length) { const node = pending.pop()!; ids.push(node.id); for (const detail of node.details) ids.push(detail.target.id); pending.push(...node.children); }
  assert.equal(new Set(ids).size, ids.length);
});
