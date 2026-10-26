# T03 桌面壳与文件来源实施计划

> **For agentic workers:** 使用 superpowers:executing-plans，在当前项目内逐项执行；以 docs/任务清单.md 为授权、进度与验收的唯一记录，不另设进度账本。

**Goal:** 交付可启动的 ClipNote 桌面窗口，安全导入 SRT/VTT/TXT/MD，查看片段与原文定位。

**Architecture:** Electron 主进程提供受限文件选择，沙箱 preload 仅暴露无参数的导入方法；Worker 读取/解码/解析文件，React 呈现结果。SourceDocument 保留原文、校验值和稳定片段标识，后续 T04 再做持久化。

**Tech Stack:** 继承 Electron 45.0.0、pi-ai 1.4.0；React、TypeScript、Vite、esbuild 固定已查得版本并写入锁文件。单元测试沿用 Node test，真实窗口采用 Playwright Electron 自动化。

**Spec:** [T03 与验收](../../任务清单.md#t03--桌面壳与文件来源)、[架构](../../架构.md)、[M01](../../模块/桌面壳与公共契约.md)、[M02](../../模块/文件来源.md)。用户于本轮明确授权：先尝试 T02 登录，无法完成则暂缓并开始桌面壳等后续任务。本轮后续实施范围为 T03。

## Global Constraints

- 分支 feat/source-import，基线 f441be1；已拉取主线包含 T02 阶段代码，T02 外部验收仍未全部满足。
- 项目为 Git 子模块，其专属元数据位于外层 .git/modules/ClipNote；Git 写操作仅限这个子模块，外层索引保持不动。
- contextIsolation/sandbox 开启，nodeIntegration 关闭；页面无任意文件、shell、网络与凭据接口。
- 默认检查离线、只用合成样例；本轮不调用真实 AI、不启动 SmartSub 任务。
- 原始文件不修改，原文换行保留；字幕时间来自实际输入，TXT/MD 不虚构时间。
- 来源上限 16 MiB、最多 20,000 片段；超过时明确报错。原文大于预览阈值时明确说明，仅界面截取，解析结果不截断。
- 不实施 T04 持久化、T05 Markdown 阅读器、T07/T08 登录产品化、安装打包或主线合并。

## Review Focus

- 不合格字幕中夹有正常片段时不得悄悄丢弃错误块：解析测试覆盖混合损坏块。
- 中文编码、BOM、CRLF/CR 与稳定行号：解析测试覆盖 UTF-8/UTF-16/GB18030 和原文范围。
- 本地窗口安全与受控 IPC：真实窗口检查隔离、取消、多余参数拒绝及网络资源阻断。
- 大文件、长片段及连续导入：单元与窗口检查大小限制、分页和交互恢复。
- 原文中的 HTML/脚本保持纯文本：真实窗口检查无脚本执行或外部请求。

### Task 1: 来源契约、解码与解析

**Files:** project/src/contracts/source.ts、project/src/modules/source/{parser,import-file}.ts、project/tests/unit/source.test.ts。

**Interfaces:** parseSource(bytes: Uint8Array, originalPath: string): SourceDocument；importSourceFile(filePath: string): Promise<SourceDocument>。SourceDocument 含 sourceId、sourceType、originalPath、fileName、format、encoding、checksum、rawText、segments；片段含 segmentId、order、text、原文 range、可选 startMs/endMs。

- [x] 写出四格式、稳定 ID、行号/换行、编码、空/损坏/混合错误、大小限制和中文路径测试；用明确未实现的函数确认目标失败。
- [x] 实现严格解码和解析，时间和范围均来自原文；保留 rawText，不静默修复损坏字幕。
- [x] 执行 node --test tests/unit/source.test.ts，全部通过；验证真实临时文件且清理仅限测试创建的目录。
- [x] 本阶段与桌面壳一起形成完整 T03 成果后本地提交。

### Task 2: 桌面入口、受限 IPC 与文件处理 Worker

**Files:** project/src/main/{index,import-controller,source-worker}.ts、project/src/preload/index.ts、project/src/contracts/desktop.ts、project/tests/unit/desktop.test.ts、project/tools/{build-desktop,start-desktop}.mjs、project/tsconfig.json、project/vite.config.ts、project/package.json、project/package-lock.json。

**Interfaces:** window.clipnote.importSource(): Promise<ImportResult>；ImportResult 是 imported/document、cancelled 或 error/code/message 的联合类型。主进程只接受本窗口主 frame、无参数请求；文件路径只由系统文件选择框产生。

- [x] 先写取消、异常、多余参数和重复请求测试并确认失败，再实现控制器。
- [x] 固定依赖，建立可重复 build/typecheck/test/start 命令；Vite 构建 renderer，esbuild 构建 main/preload/worker。
- [x] Worker 中进行有上限的读取/解析；主进程负责文件选择与可解释错误，窗口关闭时释放 Worker。
- [x] 运行类型检查、单元测试及构建，要求全部退出 0。

### Task 3: 可操作界面与真实窗口验收

**Files:** project/src/renderer/{index.html,main.tsx,App.tsx,styles.css}、project/tests/e2e/desktop.test.mjs、project/tests/fixtures/ 下合成资料及相关模块/任务/交接文档。

**Interfaces:** 使用 Task 2 的只读桥接结果，保持 imported 文档只在当前会话内；查看片段、切换原文、定位行号和分页，无 AI 请求。

- [x] 先写真实窗口测试：入口、文件选择取消、四格式导入、原文定位、错误后恢复、脚本文本及隔离检查；界面未实现时确认目标失败。
- [x] 实现中文桌面界面和加载/错误/取消状态，避免显示不存在的产品能力。
- [x] 执行 npm.cmd run typecheck、npm.cmd run build、npm.cmd test、npm.cmd run test:e2e；记录数量、失败/跳过和实际窗口截图。
- [x] 独立只读代码审阅，处理重要问题并复验；核对文档、Git 差异与暂存文件，更新 T02/T03 和交接后本地提交。
- [x] 交付分支和启动方式，等待用户对主线合并的明确批准。

实施结果：实现、自动检查与审阅修复已交付；38项本地测试及6组真实窗口场景通过。用户暂时没空试用，原生文件选择框人工项在任务清单中保持未确认；本计划勾选表示实施步骤完成，不替代 T03 总验收或主线合并。
