# ClipNote 开发与验证

当前包含桌面文件工作台、本地归档与版本保存、Markdown 阅读器，以及 T02 独立接入探针。桌面源码使用 TypeScript，界面采用 React；探针继续使用 Node ESM。已支持四格式来源、版本保存/恢复，以及独立只读 Markdown 阅读；AI 分析和安装包尚未实现。

## 打开桌面窗口

依赖准备好后，在本目录执行：

```powershell
npm.cmd run build
npm.cmd start
```

也可以执行 `npm.cmd run dev` 顺序构建并打开窗口。当前不提供热更新。用 `tests/fixtures/示例 字幕.srt` 可体验字幕时间与行号定位。

导入只读取明确选择的文件，不改变原文件；会话保留最近五份来源，未归档的来源关闭后清空。单文件上限 16 MiB、最多 20,000 个片段；长原文按 200,000 字符分页，可从片段跳转并高亮对应原文。正文按纯文本显示，网络请求和外部窗口被阻断。同一应用数据目录只允许一个窗口实例，再次启动会唤起已有窗口。

## 保存、版本与恢复

1. 点击“选择保存目录”，选择本地父目录；应用在其中创建专属 `ClipNote/`。也可以直接选择已有且带 ClipNote 标记的库目录。
2. 导入文件后点击“保存来源”。此时保存完整原始字节、原文归档 Markdown 和追溯信息，不调用 AI。即使导入后原文件被修改，保存的仍是导入时的快照。
3. 左侧“已保存版本”可重新打开来源。每次保存创建独立版本，外部编辑过的 `note.md` 会标注修改并保留原样。
4. 完整草稿落盘后若保存失败，重启仍可看到待恢复草稿；可以先更改目录，再点击重试，不重新导入或调用模型。

库内目录为 `items/<sourceId>/revisions/<revisionId>/`，包含 `note.md`、`source.<原格式>`、`source.json`、`manifest.json` 和管理标记。普通编辑器可打开这些文件；移动整个库后重新选择库目录即可读取，内部文件引用使用相对路径。

保存先在开发 userData 的 `../.local/desktop/storage/drafts/` 准备草稿，再在目标盘独占创建版本目录；文件写入、刷新和校验后，最后创建 `.committed` 标记。未提交/损坏版本不会出现在成功列表。来源及元数据损坏会拒绝打开，Markdown 的外部修改只提示而不覆盖。草稿尚未完整落盘时发生的中断不能保证恢复；目标目录中的未提交残留保留原样，不擅自清理。

当前开发设置和恢复草稿在 `../.local/desktop/storage/`，输出位置必须明确选择；拒绝接管没有专属标记的同名 ClipNote 目录，也拒绝管理路径中的符号链接/junction。开发时禁止选代码仓库内作为输出，已忽略的 `.local/`、`.runtime/` 子目录除外。安装包的正式数据路径由 T12 确定。

## Markdown 阅读

点击工具栏“打开 Markdown”直接选择已有 `.md`，不需要先导入或归档。左侧目录可展开/收起，点击标题定位正文；重复标题有独立锚点，长文按100个根块分页，目录可以直接跳到其他页。无标题文档直接阅读正文，空文档明确提示。

在文件工作台左侧“已保存版本”点击“阅读笔记”，读取该版本当前的 `note.md`，包括外部人工修改。点击“查看来源”回到完整来源工作台；归档正文中的 `source.<格式>` 链接可查看该来源，`source.<格式>#<segmentId>` 或 `clipnote-source:<segmentId>` 可以定位实际片段。普通独立 MD 的任意相对文件链接不会获得读取本地文件的权限。

外部编辑后点击“刷新文件”，重新读取磁盘；失败时保留旧正文并显示错误。不会自动监听或改写文件。“外部打开”只在主动点击时调用系统默认 Markdown 应用；不强制 Obsidian，不自动创建笔记库。外部程序和浏览器本身的安装/关联不由本功能配置。

HTML 显示为文本，图片只显示替代说明，不自动访问远程地址或本地图片。仅正文中已登记的 HTTP(S) 链接可经主动点击交系统浏览器；脚本、data、file 等链接禁用。当前不提供内置编辑、图片加载或 Obsidian 专属库发现。

阅读限制：原文件及解码后 UTF-8 内容均不超过2 MiB，AST 最多20,000节点、64层嵌套。超限明确报错，完整内容不会被静默截断。标题树和正文使用同一 AST，代码/frontmatter 内的伪标题不会出现在目录。阅读路径拒绝符号链接/junction；文件删除、路径替换或归档缺失时提示无法读取。每个窗口最多保留5个受控阅读会话，过期后重新打开即可。

## 桌面源码与检查

- `src/main/`、`src/preload/`：窗口、可信主 frame 的受限导入/存储/阅读 IPC 和文件 Worker。
- `src/contracts/`、`src/modules/source/`、`src/modules/storage/`：来源字节快照、解析、版本发布和恢复；存储接口接受 Markdown 与白名单元数据，供后续生成流程复用。
- `src/modules/reader/`、`src/renderer/features/reader/`：Worker 读取解析，以及共用 AST 的标题树和正文；只渲染白名单 React 元素。
- `src/renderer/`：当前会话、来源预览、归档列表、重试与阅读入口；不直接访问 Node、文件系统或凭据。
- `npm.cmd run typecheck`：TypeScript 类型检查。
- `npm.cmd test`：来源/桌面控制单元测试及 T02 本地集成回归；不会发真实 AI 请求。
- `npm.cmd run test:e2e`：顺序检查导入、归档、阅读、安全与恢复，以及不带调试器、直接执行 `npm.cmd start` 的原生显示、重复启动、最小化、最大化、还原和关闭退出。Playwright 替换系统选择框返回值，后续 IPC/Worker/文件写入执行真实代码；普通启动回归按测试拥有的进程树发送 Windows 系统窗口命令，不调用 Playwright app.close()。无需另下浏览器，截图在 `../.local/test-artifacts/`：`npm-start-native.png` 含系统标题栏，`storage-versions.png` 为版本面板，`markdown-reader.png` 为阅读界面。

E2E 为每组测试创建独立 userData 和输出目录，只清理自己拥有的资源，不更改日常保存位置。内部 `CLIPNOTE_TEST_USER_DATA` 仅允许指向本项目 `.local/test-artifacts/` 内；不要在日常运行设置它。受限执行环境若阻止 Electron 访问运行时，应在获准的系统桌面运行检查，不通过关闭产品 sandbox 或修改系统 ACL 绕过。

实际数量、验证时间和未测范围统一见 `../docs/任务清单.md`。

## 固定环境

- 开发 Node：>=24.14.1。
- Electron：45.0.0，实际内置 Node 24.22.0。
- @earendil-works/pi-ai：1.4.0，声明 Node >=22.19.0。
- React/React DOM：19.3.1；TypeScript：7.0.2；Vite：8.3.5；esbuild：0.28.2；Playwright：1.64.1。
- Markdown：unified11.0.5、remark-parse11.0.0、remark-frontmatter5.0.0、remark-gfm4.0.1；@types/mdast4.0.4。新增依赖随清单及锁文件提交，安装禁用脚本，未升级既有运行时。
- 依赖用 package-lock.json 固定；Playwright 复用项目 Electron，未下载其他浏览器。

## 本地准备

在本目录执行；缓存和运行资料均放项目根的 `.local/`，不进入 Git：

```powershell
npm.cmd ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund --cache ..\.local\npm-cache
$env:ELECTRON_CACHE = (Join-Path (Resolve-Path ..) '.local\electron-cache')
$env:electron_config_cache = $env:ELECTRON_CACHE
node node_modules/electron/install.js
```

安装会联网获取固定依赖和 Electron 运行时；后续默认测试不调用真实 AI，不启动 SmartSub。不要在真实笔记目录运行文件故障测试。

## 验证入口

| 命令 | 验证内容 | 网络/人工条件 |
|---|---|---|
| `npm.cmd run test:integration` | T02 配置、安全输出、来源程序发现、本机 HTTP 替身、真实 Electron 加载与加密 | 依赖已准备后可离线；不代替真实服务验收 |
| `npm.cmd run verify:runtime` | 开发 Node 加载 SDK、API/OAuth 入口及静态模型目录 | 无真实请求；模型目录不代表账号权限 |
| `npm.cmd run verify:electron` | Electron 主进程、内置 Node、SDK 和 Windows 合成值加密往返 | 不创建窗口、不登录、不发 AI 请求 |
| `npm.cmd run verify:login` | ClipNote 独立浏览器授权、账号模型目录、一次合成文本推理 | 会打开浏览器，由用户登录，使用订阅额度 |
| `npm.cmd run verify:api` | 指定地址、模型、密钥下的一次合成文本请求 | 缺配置退出2；不会自动选择服务 |
| `npm.cmd run verify:smartsub` | 查找安装并仅验证真实 CLI 的 `--help` | 未发现退出2；不下载、安装、转写或修改后台任务 |

探针报告区分 `passed`、`not-run` 和 `failed`；退出码0为该探针范围通过，2为缺少前提而未运行，1为失败。真实 CLI help 通过不等于任务/字幕全链路通过，本机 HTTP 替身通过也不等于真实 API 服务已验证。

## 后补 API 配置

用户已选择 API 真实验证稍后补齐。准备好后，仅在已忽略的 `../.local/api.env` 填入 `.env.example` 中三个字段，再执行：

```powershell
node --env-file=../.local/api.env tools/verify-api.mjs
```

必须明确服务地址，避免把通用密钥发送到默认服务；不要把密钥放进命令参数、聊天、源码或提交。报告不输出请求头、密钥、错误响应正文或私人资料。本探针只发送固定的合成短提示词。

## 订阅边界

复用 pi-ai 新 openaiProvider OAuth，使用 ClipNote 名称及项目本地稳定 host ID，不读取 Codex 等其他软件的凭据。登录令牌仅存在本次进程内存；完成后清除本地内存并退出，不宣称已经撤销远端授权。

本轮真实文本请求已完成，但持久化凭据、重启恢复、刷新和远端撤销仍留给 T08，不能据此勾选整个登录模块。浏览器取消或五分钟未完成会终止本次验证；不要向聊天粘贴回调 URL。

## SmartSub 边界

可在本进程设置 `CLIPNOTE_SMARTSUB_DIR` 指向已有安装目录，再运行探针。只读发现 `SmartSub.exe` 及 `resources/automation/cli.cjs`，用应用自带运行时和参数数组执行，不需要全局 PATH/MCP。

B 电脑的实际安装位置保存在已忽略的 `../.local/smartsub.env`，可执行 `node --env-file=../.local/smartsub.env tools/verify-smartsub.mjs`。`smartsub.cmd` 是程序自带的 Windows 启动脚本；实际业务命令会连接或按需启动 SmartSub 后台，帮助命令不启动任务后台。

后续真实任务、查询/取消及字幕读取契约见 `../docs/T02接入契约.md`。没有安装时仅记录未运行，不自动获取 SmartSub、引擎或模型。

权威任务进度、验证时间/版本和未测影响统一见 `../docs/任务清单.md`，本文件不维护另一套完成状态。
