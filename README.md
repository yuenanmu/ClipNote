# ClipNote

ClipNote 是规划中的 Windows 桌面 App：把视频字幕或已有文本整理成可追溯的 Markdown 层级笔记，在 App 内查看标题树与正文，并保存到指定本地位置。

首版设计支持 SRT、VTT、TXT、MD 导入，API 与 ChatGPT 订阅两种 AI 连接，以及可选 SmartSub 来源。SmartSub 接入也属于首版交付要求；文件分析和本地阅读可独立使用。Obsidian 只是可选外部编辑器。

当前已建立 T02 最小接入验证工具、锁定依赖和本地检查；尚无 App 界面、业务模块或可安装产品。运行方式见 [project/README](project/README.md)。任务授权与实际进度统一见[任务清单](docs/任务清单.md)。

## 目录与阅读顺序

- 项目根目录：`D:\Obsidian\Obsidian\10-项目\ClipNote`，统筹项目、文档与各 agent 交接。
- `project/`：源码、测试与配置；当前仅有 T02 验证工具，不另建仓库。
- `docs/`：需求、架构、任务和交接。
- `prompts/`：对话参考模板，不构成授权。

先读 [AGENTS](AGENTS.md)、[项目索引](docs/项目索引.md)、[当前交接](docs/当前交接.md)，再读[架构](docs/架构.md)、[模块索引](docs/模块/模块索引.md)及相关任务。任务清单用复选框显示完成情况，模块文档说明职责、接口与依赖。

## 当前阶段

文档分支已按用户明确批准合入 main（cc19831）。当前在 chore/integration-validation 做 T02；API 真实验证由用户选择延后，SmartSub 安装尚缺。本分支不自动合并或推送，后续业务任务另行选择。

技术路线采用 Electron、React、TypeScript 与 pi-ai，SmartSub 通过 CLI 适配。已验证本机 Electron/pi-ai 运行和一次订阅文本请求；API、完整登录生命周期、Windows SmartSub CLI 与打包仍需相应真实验收。网站兼容沿用 SmartSub，ClipNote 优先验证 CLI 调用及字幕结果接入；不要求用户先列网站清单。上游能力仍不能代替本应用的实际集成验证。

本地来源、生成笔记、模型、运行时和凭据不进入 Git；仅保存必要的公开或合成验证资料。
