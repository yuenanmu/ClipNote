# ClipNote

ClipNote 是开发中的 Windows 桌面 App，目标是把视频字幕或已有文本整理成可追溯的 Markdown 层级笔记，在 App 内阅读并保存到指定本地位置。

首版设计支持 SRT、VTT、TXT、MD 导入，API 与 ChatGPT 订阅两种 AI 连接，以及可选 SmartSub 来源。SmartSub 接入也属于首版交付要求；文件分析和本地阅读可独立使用。Obsidian 只是可选外部编辑器。

当前已有文件工作台、归档版本和独立“笔记”区。可导入 SRT/VTT/TXT/MD 核对来源并保存独立版本；已有 MD 可加入持久列表，切换多个文件和归档笔记。每份笔记可选 Markdown、Markmap 脑图或可拖动比例的双栏对照：正文保留折叠大纲，脑图直接显示标题、列表和段落，按章节展开、保留完整文字，并可联动定位原文。原文件保持原位，移出列表只移除登记。导入、归档与阅读均在本地进行，无需 AI 登录、SmartSub 或 Obsidian；AI 整理和 Windows 候选包已实现；验收缺口见任务清单。

已安装依赖时，在 `project/` 中执行 `npm.cmd run build`，再执行 `npm.cmd start` 即可打开窗口。首次准备与所有验证命令见 [project/README](project/README.md)；可用[合成字幕](project/tests/fixtures/示例%20字幕.srt)试用。任务授权与实际进度统一见[任务清单](docs/任务清单.md)。

## 目录与阅读顺序

- 项目根目录为本 README 所在目录；B 电脑为 `D:\Obsidian\yuenanmu\10-项目\ClipNote`，A 电脑路径以其实际克隆为准。
- `project/`：桌面源码、测试、配置及 T02 验证工具，不另建仓库。
- `docs/`：需求、架构、任务和交接。
- [问题记录](docs/问题记录.md)：持续维护同一文件，保存值得复用的问题与防复发办法。
- `prompts/`：对话参考模板，不构成授权。

先读 [AGENTS](AGENTS.md)、[项目索引](docs/项目索引.md)、[当前交接](docs/当前交接.md)，再读[架构](docs/架构.md)、[模块索引](docs/模块/模块索引.md)及相关任务。任务清单用复选框显示完成情况，模块文档说明职责、接口与依赖。

## 当前阶段

用户于 2026-11-17 确认第一版开发和 Windows 打包完成。订阅候选和 Windows 打包已合入 main；v0.1.0-candidate 为第一版候选标签。真实服务质量、登录生命周期和跨电脑等验收缺口见[任务清单](docs/任务清单.md)。第二版方向见[开发计划](docs/第二版开发计划.md)。

技术路线采用 Electron、React、TypeScript；API 使用 pi-ai，订阅使用 DevKit，SmartSub 通过 CLI 适配。

本地来源、生成笔记、模型、运行时和凭据不进入 Git；仅保存必要的公开或合成验证资料。


在仓库根目录（终端路径以 `ClipNote` 结尾）启动已构建的应用：

```powershell
npm.cmd --prefix .\project start
```

根目录没有 `package.json`，不要在这里直接执行 `npm.cmd start`。如需重新构建，在根目录执行 `npm.cmd --prefix .\project run build`；启动命令本身不会构建。
