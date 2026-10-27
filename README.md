# ClipNote

ClipNote 是开发中的 Windows 桌面 App，目标是把视频字幕或已有文本整理成可追溯的 Markdown 层级笔记，在 App 内阅读并保存到指定本地位置。

首版设计支持 SRT、VTT、TXT、MD 导入，API 与 ChatGPT 订阅两种 AI 连接，以及可选 SmartSub 来源。SmartSub 接入也属于首版交付要求；文件分析和本地阅读可独立使用。Obsidian 只是可选外部编辑器。

当前已有可运行的桌面文件工作台：选择 SRT/VTT/TXT/MD，查看来源片段、字幕时间、行号和原文高亮。可选择本地保存目录、归档完整来源、保留独立版本，关闭重开后从归档打开；保存失败的完整草稿可重试。导入与归档完全在本地进行，无需 AI 登录或 SmartSub。未保存的会话来源关闭后清空；AI 笔记生成、Markdown 标题树与安装包属于后续任务。

已安装依赖时，在 `project/` 中执行 `npm.cmd run build`，再执行 `npm.cmd start` 即可打开窗口。首次准备与所有验证命令见 [project/README](project/README.md)；可用[合成字幕](project/tests/fixtures/示例%20字幕.srt)试用。任务授权与实际进度统一见[任务清单](docs/任务清单.md)。

## 目录与阅读顺序

- 项目根目录为本 README 所在目录；B 电脑为 `D:\Obsidian\yuenanmu\10-项目\ClipNote`，A 电脑路径以其实际克隆为准。
- `project/`：桌面源码、测试、配置及 T02 验证工具，不另建仓库。
- `docs/`：需求、架构、任务和交接。
- [问题记录](docs/问题记录.md)：持续维护同一文件，保存值得复用的问题与防复发办法。
- `prompts/`：对话参考模板，不构成授权。

先读 [AGENTS](AGENTS.md)、[项目索引](docs/项目索引.md)、[当前交接](docs/当前交接.md)，再读[架构](docs/架构.md)、[模块索引](docs/模块/模块索引.md)及相关任务。任务清单用复选框显示完成情况，模块文档说明职责、接口与依赖。

## 当前阶段

T03 已于2026-10-27按授权整合到本地 main（a183045）。随后按用户“继续后续开发”的指示实施 T04，本地归档与版本保存位于 feat/storage，尚未合入 main。当前的“保存来源”生成原文归档 Markdown，明确标注未进行 AI 整理。API 与 B 电脑官方登录真实验证继续延后；B 的 SmartSub3.10.1 自带 CLI 帮助可用，真实任务/字幕链仍未验证。T05 及后续任务另行选择；本次未推送远程。

技术路线采用 Electron、React、TypeScript 与 pi-ai，SmartSub 通过 CLI 适配。T02 曾在 A 电脑完成一次订阅文本请求；B 的本地运行环境和桌面功能已建立，官方登录仍待可用网络。API、完整登录生命周期、SmartSub 实际任务与打包仍需真实验收。

本地来源、生成笔记、模型、运行时和凭据不进入 Git；仅保存必要的公开或合成验证资料。
