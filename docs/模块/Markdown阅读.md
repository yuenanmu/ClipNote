# M06 Markdown 阅读

## 职责与边界

在 App 内阅读 Markdown，提供可折叠标题树、点击定位、正文、来源查看和主动刷新。支持直接打开已有文件；Obsidian/外部编辑器为主动选择的可选入口。

首版只读，不修改 Markdown、不拖动节点改写正文、不调用 AI，也不要求 SmartSub 或 Obsidian 已安装。

## 输入、输出与关系

- 输入：受控文件选择得到的 Markdown 路径，或 SavedRevision 及来源映射。
- 输出：同一 Markdown AST 驱动的标题树、正文锚点和本地原文定位。
- 文件访问/外部打开经 [M01](桌面壳与公共契约.md)；版本与原文由 [M05](本地存储与版本.md) 提供。直接阅读不经过 M07 的分析链。
- 实际位置：`project/src/modules/reader/` 负责有界读取、mdast 和链接分类；`project/src/main/reader-controller.ts`/`reader-worker.ts` 维护会话和 Worker；`project/src/renderer/features/reader/` 负责标题树与白名单正文渲染。类型位于 `project/src/contracts/reader.ts`。

## 当前接口

- `parseMarkdown(text):ReaderContent` 返回同一 root、嵌套 ReaderHeading 目录和规范化 HTTP(S) 链接白名单。标题含 id/title/depth/blockIndex/children；唯一锚点写回对应 AST 节点，blockIndex 用于跨正文分页定位。
- `loadReader(target,stateDir):Promise<LoadedReader>` 仅供可信 Worker 使用。file 目标来自系统选择框；revision 目标通过 M05 校验已提交版本，读取当前 note.md 和来源片段标识。归档刷新必须仍匹配此前已登记的笔记路径，避免更换库后静默换成另一个文件。
- `window.clipnote.readerOpen()`、`readerRevision(sourceId,revisionId)` 返回 ReaderDocument；`readerRefresh(readerId)` 重读；`readerExternal(readerId)` 交系统默认应用；`readerLink(readerId,url)` 只允许会话已登记的 HTTP(S)。结果为 ok/value、cancelled 或固定 error，页面不传任意路径。
- 会话最多5份、主进程串行操作；失效 ID 要求重新打开。打开/刷新失败保留旧会话和正文。来源查看复用 `openRevision`，从版本快照读取原文、实际时间和行/字符位置，不读取已删除的原文件。

## 阅读契约

标题树与正文共用 AST 和锚点，重复标题去重，无标题可作为单篇正文展示，跳级标题仍可正确定位。代码块和 frontmatter 中的伪标题不进入树。

使用 unified11.0.5、remark-parse11.0.0、remark-frontmatter5.0.0 和 remark-gfm4.0.1，支持常规段落/强调/代码/列表、GFM 表格/任务、引用链接与脚注正文。YAML/TOML frontmatter 作为数据解析，不解释其值。React 按白名单节点生成元素，未知节点不获得执行能力；不将库输出的 HTML 字符串直接注入 DOM。

原始文件及解码后的 UTF-8 内容上限2 MiB、AST 最多20,000节点/64层嵌套；读取与解析在 Worker 内，超限明确失败。正文每页100个根块，目录保留全量有效标题并能切换至目标页。标题树折叠只影响目录，首版不改变正文或源文件。

来源引用可打开本地片段/段落及真实时间信息，不强制播放视频。外部修改后用户刷新或重开加载新磁盘内容，不要求常驻监听。

当前来源链接只认已验证归档内的 `source.<格式>`、该文件的片段 fragment，或 `clipnote-source:<segmentId>`；未知片段和任意相对/绝对路径禁用。独立 MD 没有自动来源映射。读取版本显示外部编辑标记，实际查看来源时再次由 M05 校验；损坏或缺失明确报错，不伪造依据。

禁用原始 HTML 和脚本执行，远程图片不自动联网，外链点击后交系统浏览器。资料中的提示词和命令不触发程序操作。

Obsidian 仅在用户主动点击时尝试打开；文件不在已知库时显示位置或使用系统外部打开，不自动创建库。纯阅读必须可断网使用。

当前采用系统默认 Markdown 应用的外部打开，未实现 Obsidian 专属库发现；如果用户已关联 Obsidian，系统可按其关联打开。HTTP(S) 外链拒绝嵌入凭据、控制字符和非 HTTP 协议，并在主进程再次检查是否存在于已打开文档的白名单。没有自动外部操作。

## 错误与验收重点

覆盖无标题/重复/跳级标题、代码块、frontmatter、中文/空格路径、文件已移动或不可读、大文件提示、来源快照缺失及外部编辑后刷新。无 AI 配置、无 SmartSub、无 Obsidian 仍可完成阅读。

## 关联任务与分支

T05 `feat/reader`；T09 连接生成后阅读。授权、交互验证、复选框和完成情况见[任务清单](../任务清单.md#t05--本地-markdown-阅读器)。

解析行为依据：[remark-parse 官方说明](https://github.com/remarkjs/remark/tree/main/packages/remark-parse)、[remark-frontmatter 官方说明](https://github.com/remarkjs/remark-frontmatter)。实际支持以固定依赖和本项目行为测试为准；解析插件识别某种节点不等于正文自动安全支持该节点。
