# M06 Markdown 阅读

## 职责与边界

独立笔记区管理已有 MD 的持久路径引用，并列出当前库的归档笔记。每份笔记可切换 Markdown 与 Mindmap；正文保留可折叠标题树、定位、来源查看和主动刷新。Obsidian/外部编辑器为主动选择的可选入口。

首版只读，不修改 Markdown、不拖动节点改写正文、不调用 AI，也不要求 SmartSub 或 Obsidian 已安装。

## 输入、输出与关系

- 输入：受控文件选择得到的 Markdown 路径，或 SavedRevision 及来源映射。
- 输出：同一 Markdown AST 驱动的标题树、正文锚点、脑图和本地原文定位。标题是脑图主干，嵌套列表是子分支，段落等是节点说明；代码/frontmatter 不产生伪分支。
- 文件访问/外部打开经 [M01](桌面壳与公共契约.md)；版本与原文由 [M05](本地存储与版本.md) 提供。直接阅读不经过 M07 的分析链。
- 实际位置：`project/src/modules/reader/` 负责有界读取、mdast 和链接分类；`project/src/main/reader-controller.ts`/`reader-worker.ts` 维护会话和 Worker；`project/src/renderer/features/reader/` 负责标题树与白名单正文渲染。类型位于 `project/src/contracts/reader.ts`。

## 当前接口

- `parseMarkdown(text):ReaderContent` 返回 root、ReaderHeading 目录、MindmapNode 根节点和规范化 HTTP(S) 链接白名单。脑图节点含 id/label/target/details/children；target 使用 ReaderPosition 的 id/blockIndex，与正文块共享 AST 定位，可跨页定位段落、列表项和标题。标题 slug 与生成块/root ID 使用不相交命名空间。
- `noteList()` 列出外部文件登记及 available 状态；`noteAdd()` 经系统选择框验证并登记/打开；`noteOpen(noteId)` 重读已登记路径；`noteRemove(noteId)` 只移除登记；`noteRelink(noteId)` 由系统选择新路径；`noteSource(sourceId)` 只接受主进程缓存中已导入的 MD 原路径。全部共用 reader 控制器的可信 frame 校验/串行锁与固定错误；renderer 不提供任意路径。
- `NoteCatalog` 使用 userData/reader/notes.json 原子保存 version1 路径登记，最多1000条；重复路径复用已有 ID（Windows 忽略大小写），未知/损坏结构不被覆盖。移出不删除文件；不可用登记保留供重新关联。归档笔记直接消费 M05 的版本列表，不复制进外部文件目录。
- `loadReader(target,stateDir):Promise<LoadedReader>` 仅供可信 Worker 使用。file 目标来自系统选择框；revision 目标通过 M05 校验已提交版本，读取当前 note.md 和来源片段标识。归档刷新必须仍匹配此前已登记的笔记路径，避免更换库后静默换成另一个文件。
- `window.clipnote.readerOpen()`、`readerRevision(sourceId,revisionId)` 返回 ReaderDocument；`readerRefresh(readerId)` 重读；`readerExternal(readerId)` 交系统默认应用；`readerLink(readerId,url)` 只允许会话已登记的 HTTP(S)。结果为 ok/value、cancelled 或固定 error，页面不传任意路径。
- 会话最多5份、主进程串行操作；失效 ID 要求重新打开。打开/刷新失败保留旧会话和正文。来源查看复用 `openRevision`，从版本快照读取原文、实际时间和行/字符位置，不读取已删除的原文件。

持久笔记列表独立于最多5份临时阅读会话；从列表再次打开会重新加载并建立会话。添加/重新关联先完整验证读取成功再更新登记，取消或失败保留旧登记/正文；登记文件只保存路径引用，不保存用户正文。

## Mindmap 界面

React/SVG 左向右树布局，深色画布与分支颜色；节点文字回跳对应 Markdown 块，独立圆点折叠分支。段落说明按需显示，较长说明分页保留全文。支持拖动、滚轮/按钮缩放、适应画布、主干收起/全部展开；切换视图保留当前文档内的画布状态。默认进入 Mindmap，无标题时以文件名作为根节点。

可读缩放下按视口过滤节点；18%以下使用分色批量 SVG 路径显示全图概览，明确提示放大后阅读文字；双击空白画布可放大。避免大图适应画布时生成数千个交互 DOM。节点长标签视觉换行/省略，完整原文可通过节点回跳，内容本身不改写。

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
