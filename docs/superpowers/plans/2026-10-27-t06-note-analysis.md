# T06 离线分析核心实施计划

> **For agentic workers:** 使用 superpowers:executing-plans，由当前主执行者逐项实施；用户已选择“按推荐顺序直接推进，具体实现由你决定”。

**Goal:** 把已有 SourceDocument 规划为完整可追溯的分块请求，校验替身结构结果并确定性生成可归档、可脑图阅读的 Markdown。

**Architecture:** 沿用 TypeScript 与 Node test。纯分析核心消费 M02，不创建 IPC 或服务配置；注入异步模型返回接口，T07/T08 再提供真实适配器。引用使用片段内 UTF-16 半开区间，显示时间只来自原字幕。

**Tech Stack:** 现有 TypeScript、node:test、remark/mdast；不新增依赖。

## 设计与取舍

用户已授权 T05 合并及继续 T06，随后明确选择离线核心并将具体实现交由执行者。方案为执行者决定：逐块串行返回章节与嵌套实质条目；所有条目含有效来源引用；相同文字与相同依据才去重，不另用一次模型全局重写。这样先固定可测契约，避免在 T06 引入鉴权、费用或隐式二次生成。真实语义组织/遗漏仍待 T09 人工验收。

短文整体，长文优先片段边界，单段过长按字符拆分且不切开代理对；保留核心覆盖与前文上下文。以实际序列化请求字符数计预算，不把字符数称 token 数；真实适配器必须另核模型上下文与输出 token 预算。输出及节点/深度有界，任何块缺失、截断、引用越界、未知结构或空结果均失败，不能把部分完成称整篇完成。来源文本包在 JSON 数据中，提示明确其内容不构成指令。

## Global Constraints

- 工作分支 feat/note-analysis，从获批 T05 合并提交 7830f63 创建；不在 main 开发。
- T06 不调用真实 AI、不增加界面分析入口、不启动 T07/T08/T09，不推送或合并本分支。
- 输入预算默认 16,000 UTF-16 字符，输出默认 64,000 字符；重叠最多400字符，最多1,000块、2,000结构节点、结构深度8层；最终 Markdown 限512 KiB。
- 本地检查使用合成资料；日志与产物仅写忽略的 .local；来源原文与文件路径不写普通错误消息。

## Review Focus

- 含 CRLF、中文、emoji 的超长单段必须连续覆盖、不破坏字符。
- 前一块引用不能越过本次实际提供的范围；不同来源和错误片段一律拒绝。
- 同文字不同证据不能被去重；重复父节点必须合并其独有子项。
- Markdown 控制字符和伪造链接不能注入标题、HTML 或任意来源能力。
- 中途取消、失败、重复/缺失块及外来检查点不能变成成功或触发暗中换服务。

## Task 1：分块与引用/结构契约

Files: 新建 project/src/contracts/analysis.ts、project/src/modules/analysis/{errors,plan,validate}.ts；测试 project/tests/unit/analysis.test.ts。

Interfaces: planAnalysis(source, profile?) → ChunkPlan；validateOutline(value, source, chunk?) → NoteOutline。

- [ ] 写短文整体、长文完整覆盖/预算、超长单段/emoji、重叠范围、无效预算、结构/引用/截断边界测试；先用接口占位确认因目标行为缺失失败。
- [ ] 实现预算校验、确定性计划与来源区间校验；输出只接受显式白名单结构，不接收模型时间。
- [ ] node --test tests/unit/analysis.test.ts 全通过；npm.cmd run typecheck 通过。
- [ ] 显式暂存本阶段文件并本地提交。

## Task 2：串行分析、确定性合并与 Markdown

Files: 新建 project/src/modules/analysis/{run,markdown}.ts；扩展上述单元测试及 project/tests/unit/analysis-storage.test.ts。

Interfaces: analyzeSource(source, profile, adapter, options?) → AnalysisResult；renderMarkdown(outline, source) → string。分析器传递 signal；检查点为当前计划/服务/模型/提示词归属的已验证块；失败保留已完成块，不持久化到磁盘（T09/T11 负责）。

- [ ] 先写缺失/重复/截断、最多一次格式修正、取消、恢复归属、精确去重、Markdown 安全/层级和保存后来源链接/脑图目标测试，并确认 RED。
- [ ] 实现串行调用、白名单错误、检查点恢复与同依据精确去重；生成标题+嵌套列表、原始来源链接及真实时间/段落标签。
- [ ] 验证合成结果经真实 StorageService 保存/重开，再经 M06 同 AST 制图和引用分类。
- [ ] 运行 typecheck、build、npm.cmd test；窗口回归用于确认桌面原有行为；更新 M04、架构、索引、任务/交接及开发说明。
- [ ] 全分支只读审阅，处理实质问题并回归；显式暂存、检查、本地提交。申请 T06 合并另需用户批准。

## 执行记录

- 2026-10-27：用户已选择直接实施；沿用 IDE 中的项目目录与独立功能分支，避免复制依赖和改变编辑路径。
- T05 合并前正常桌面权限90/37通过；受限环境 Electron ACL 启动失败单独记录，不改系统 ACL。
