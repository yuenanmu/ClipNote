# ClipNote

ClipNote 是规划中的 Windows 桌面 App：把视频字幕或已有文本整理成可追溯的 Markdown 层级笔记，在 App 内查看标题树与正文，并保存到指定本地位置。

首版设计支持 SRT、VTT、TXT、MD 导入，API 与 ChatGPT 订阅两种 AI 连接，以及可选 SmartSub 来源。SmartSub 接入也属于首版交付要求；文件分析和本地阅读可独立使用。Obsidian 只是可选外部编辑器。

当前仓库仅有项目文档与协作模板，尚无业务实现、依赖清单、启动命令或可安装 App。任务授权与实际进度统一见[任务清单](docs/任务清单.md)。

## 目录与阅读顺序

- 项目根目录：`D:\Obsidian\Obsidian\10-项目\ClipNote`，统筹项目、文档与各 agent 交接。
- `project/`：后续源码、测试与构建配置，当前为空，不另建仓库。
- `docs/`：需求、架构、任务和交接。
- `prompts/`：对话参考模板，不构成授权。

先读 [AGENTS](AGENTS.md)、[项目索引](docs/项目索引.md)、[当前交接](docs/当前交接.md)，再读[架构](docs/架构.md)及相关任务。

## 当前阶段

本轮只做需求确认、文档和本地 Git 准备。初始化基线保留在 `main`，确认后的规划提交到 `docs/project-kickoff`，不合并、不推送；后续开发由用户另行选择任务。

技术路线采用 Electron、React、TypeScript 与 pi-ai，SmartSub 通过 CLI 适配。源码、运行时兼容、两种真实 AI 连接、Windows CLI 与打包均须后续验证。必测视频网站仍待用户填写，不能把上游支持范围等同于 ClipNote 已验收范围。

本地来源、生成笔记、模型、运行时和凭据不进入 Git；仅保存必要的公开或合成验证资料。
