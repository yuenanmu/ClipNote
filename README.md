# ClipNote

ClipNote 是开发中的 Windows 桌面 App，目标是把视频字幕或已有文本整理成可追溯的 Markdown 层级笔记，在 App 内阅读并保存到指定本地位置。

首版设计支持 SRT、VTT、TXT、MD 导入，API 与 ChatGPT 订阅两种 AI 连接，以及可选 SmartSub 来源。SmartSub 接入也属于首版交付要求；文件分析和本地阅读可独立使用。Obsidian 只是可选外部编辑器。

当前已有文件工作台、归档版本和独立“笔记”区。可导入 SRT/VTT/TXT/MD 核对来源并保存独立版本；已有 MD 可加入持久列表，切换多个文件和归档笔记。每份笔记可切换 Markdown/Mindmap：正文保留折叠标题目录，脑图以标题和嵌套列表组织分支，支持折叠、平移缩放和节点回跳原文。原文件保持原位，移出列表只移除登记。导入、归档与阅读均在本地进行，无需 AI 登录、SmartSub 或 Obsidian；AI 笔记生成与安装包属于后续任务。

已安装依赖时，在 `project/` 中执行 `npm.cmd run build`，再执行 `npm.cmd start` 即可打开窗口。首次准备与所有验证命令见 [project/README](project/README.md)；可用[合成字幕](project/tests/fixtures/示例%20字幕.srt)试用。任务授权与实际进度统一见[任务清单](docs/任务清单.md)。

## 目录与阅读顺序

- 项目根目录为本 README 所在目录；B 电脑为 `D:\Obsidian\yuenanmu\10-项目\ClipNote`，A 电脑路径以其实际克隆为准。
- `project/`：桌面源码、测试、配置及 T02 验证工具，不另建仓库。
- `docs/`：需求、架构、任务和交接。
- [问题记录](docs/问题记录.md)：持续维护同一文件，保存值得复用的问题与防复发办法。
- `prompts/`：对话参考模板，不构成授权。

先读 [AGENTS](AGENTS.md)、[项目索引](docs/项目索引.md)、[当前交接](docs/当前交接.md)，再读[架构](docs/架构.md)、[模块索引](docs/模块/模块索引.md)及相关任务。任务清单用复选框显示完成情况，模块文档说明职责、接口与依赖。

## 当前阶段

T04 经用户实际试用认可，已于2026-10-27合入本地 main（b1b5880）。随后按用户指示在 feat/reader 开发 T05 本地 Markdown 阅读器，该分支尚未合入 main。当前“保存来源”仍生成原文归档，尚未进行 AI 整理。API 与 B 电脑官方登录真实验证继续延后；B 的 SmartSub3.10.1 自带 CLI 帮助可用，真实任务/字幕链仍未验证。T06 及后续任务另行选择；本次未推送远程。

技术路线采用 Electron、React、TypeScript 与 pi-ai，SmartSub 通过 CLI 适配。T02 曾在 A 电脑完成一次订阅文本请求；B 的本地运行环境和桌面功能已建立，官方登录仍待可用网络。API、完整登录生命周期、SmartSub 实际任务与打包仍需真实验收。

本地来源、生成笔记、模型、运行时和凭据不进入 Git；仅保存必要的公开或合成验证资料。
