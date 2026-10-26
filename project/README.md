# ClipNote 开发与验证

当前包含 T03 桌面文件工作台和 T02 独立接入探针。桌面源码使用 TypeScript，界面采用 React；探针继续使用 Node ESM。桌面已支持四格式导入、来源片段、原文位置和长文件分页；AI 分析、保存版本、Markdown 阅读器和安装包尚未实现。

## 打开桌面窗口

依赖准备好后，在本目录执行：

```powershell
npm.cmd run build
npm.cmd start
```

也可以执行 `npm.cmd run dev` 顺序构建并打开窗口。当前不提供热更新。用 `tests/fixtures/示例 字幕.srt` 可体验字幕时间与行号定位。

导入只读取明确选择的文件，不改变原文件；窗口保留最近五份来源，关闭后清空。单文件上限 16 MiB、最多 20,000 个片段；长原文按 200,000 字符分页，可从片段跳转并高亮对应原文。正文按纯文本显示，网络请求和外部窗口被阻断。

## 桌面源码与检查

- `src/main/`、`src/preload/`：窗口、可信主 frame 的受限导入 IPC 和文件处理 Worker。
- `src/contracts/`、`src/modules/source/`：来源契约、严格解码、时间戳/段落解析和有上限的读取。
- `src/renderer/`：当前会话、片段列表和原文预览；不直接访问 Node、文件系统或凭据。
- `npm.cmd run typecheck`：TypeScript 类型检查。
- `npm.cmd test`：来源/桌面控制单元测试及 T02 本地集成回归；不会发真实 AI 请求。
- `npm.cmd run test:e2e`：真实 Electron 窗口、四格式文件导入、取消/恢复、安全边界和长文件定位。测试替换系统文件选择对话框以选择合成文件，读取/解析/显示仍走真实链路。无需另下浏览器，截图在 `../.local/test-artifacts/`。

实际数量、验证时间和未测范围统一见 `../docs/任务清单.md`。

## 固定环境

- 开发 Node：>=24.14.1。
- Electron：45.0.0，实际内置 Node 24.22.0。
- @earendil-works/pi-ai：1.4.0，声明 Node >=22.19.0。
- React/React DOM：19.3.1；TypeScript：7.0.2；Vite：8.3.5；esbuild：0.28.2；Playwright：1.64.1。
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
