# M04 AI 分析

## 职责与边界

复用 pi-ai 的服务适配和登录/刷新能力，提供 API 与 ChatGPT 订阅两条文本分析路径。将来源规划为请求，得到结构化章节、校验引用并生成 Markdown。

不自行发明 AI 协议，不下载视频或转写音频，不把订阅通路当 SmartSub 识别后端；不决定用户保存路径、不向来源补充外部知识。

## 输入、输出与关系

- 输入：SourceDocument、Profile、提示词版本、取消信号与已有分块检查点。
- 输出：ChunkPlan、NoteOutline、带归属的 GenerationAttempt，最终 Markdown 与引用元数据。
- 来源由 [M02](文件来源.md)/[M03](SmartSub适配.md) 生产；凭据保护及登录交互依赖 [M01](桌面壳与公共契约.md)；由 [M07](任务协调与恢复.md) 调度，结果交 [M05](本地存储与版本.md)。
- 实际位置：`project/src/modules/analysis/`；公共类型在 `project/src/contracts/analysis.ts`。当前实现是可注入服务返回接口的离线核心，真实 API/订阅适配和桌面入口分别在 T07/T08/T09 接入。

## 分析契约

短内容在模型预算内整体处理；超预算按语义边界分块，保留片段 ID、字符范围和重叠。不能截断后声称完整。单块与合并结果都有检查点；去重不能删除不同依据的关键论据或例子。

结构包括主题层级、摘要、论点、支撑、例子、限制和 sourceRefs。每条实质内容有可回查依据；引用必须指向已有片段及有效范围。结构/引用失败不标成功；格式修正最多自动一次，仍失败保留结果供选择重试。

确定性生成 Markdown，超过六级的细节用正文/列表表达。语义忠实与遗漏仍需真实样例人工检查，自动校验不能替代质量验收。

T06 输出适配通用 Mindmap：标题表示章节，嵌套列表表达论点/支撑/例子的隶属关系，说明与引用留在对应节点；使用 M06 同一 AST 检查结构与定位。脑图可用不代表内容忠实。

## 当前纯核心接口

- `planAnalysis(source, profile): ChunkPlan`：来源片段边界优先，超长单段按片段内 UTF-16 半开范围拆分，不切开代理对。core 完整连续覆盖来源片段，context 为有限前文；请求仅包含片段数据，不包含本地原路径。计划哈希覆盖来源内容、范围、服务/模型/提示词及预算，输入变化使旧检查点失效。
- `AnalysisProfile`：provider/model/promptVersion 与 inputCharBudget/outputCharBudget/overlapChars；建议默认16,000/64,000/400字符，字符预算不是 token 预算。输入可配1,000～128,000字符，输出1,000～512,000字符，重叠不超过输入的四分之一。实际 JSON 序列化请求必须在输入预算内；真实适配器另校模型上下文和输出 token 限制。
- `validateOutline(value, source, chunk?)`：只接受 title/sections，每章 heading/refs/items，实质条目 kind/text/refs/children；kind 为 summary/point/support/example/limitation。章节、父项和叶子均需来源引用；引用为 segmentId/startOffset/endOffset，不能越过片段或本次 core/context 实际提供的范围，不接受模型生成时间。
- `analyzeSource(source, profile, adapter, options?)`：串行调用注入的异步适配器，返回 outline/markdown/sourceRefs/attempt/checkpoints。适配器显式返回 completed/truncated；仅 completed 的格式/结构问题允许最多一次 repair，引用、截断、服务失败不自动换服务。signal 传入调用，调用前后检查；取消后迟到的结果不发布。
- 检查点包含 planId/chunkId/已校验 outline。失败携带已完成检查点，显式重试可传回；拒绝外来/重复/过期检查点并再次校验范围。回调收到副本。核心不落盘，T09/T11 再实现任务与持久恢复，不能把内存恢复宣称为跨重启恢复。
- 合并只在章节标题、条目类型/文字及引用范围完全相同的情况下去重，同时并集独有子项；不同依据保留。首个块的笔记标题为最终标题，章节按块序保留。无额外全局模型重写，语义级章节归并留到真实质量验收后评估。
- `renderMarkdown`：一级笔记标题、二级章节、嵌套条目列表；模型文字转义，URL/邮箱式词用行内代码保持字面内容以阻止GFM自动链接；来源链接使用既有 clipnote-source 协议，显示真实字幕时间或段落/字符范围。当前回跳定位来源片段，字符范围作为可见标签，不扩展 M06 到字符选区。生成末尾调用M06纯parseMarkdown核验实际大小/AST复杂度，超限转TOO_LARGE并保留检查点；不读取路径或发IPC。
- 安全上限：1,000块，最终结构2,000节点、条目8层，每条最多64引用，总引用20,000，最终 Markdown 512 KiB；超限明确失败，不截断后称成功。结构校验只验证可追溯性和形状，不能证明每条总结被来源语义支持或无遗漏。

## 服务与鉴权

API 地址/模型/密钥可配置；首版优先 OpenAI 兼容通路，其他协议经正式适配后再标支持。订阅研究基线采用新 openaiProvider，复用 pi-ai 的 OAuth，不混用旧示例或复制其他应用凭据。

服务类型已确认，不要求用户先研究账号资格。登录、权限、配额和真实文本请求由后续程序验证；需要人工时仅完成正常登录或 App 内配置。库文档证明有能力，不能代替 Electron 内实际请求。

API 与订阅分别配置和验收，参数差异由适配层处理。失败暂停，手动切换服务创建新尝试，来源可复用；不同尝试结果保留明确归属，不暗中换服务或扩大费用。

## 错误与验收重点

覆盖鉴权/配额、网络、取消、截断、长文重叠、错误结构/引用、令牌刷新与退出。两条路径都要真实文本推理完成，不能仅凭 token 或模型列表验收。凭据不回传页面、不写普通日志、输出或 Git。

## 关联任务与分支

T02 最小验证；T06 `feat/note-analysis` 定义分析契约；T07 `feat/api-provider`；T08 `feat/chatgpt-login`；T09 文件闭环和人工质量验收。子能力分支分别验证并经批准合并，不堆在一个长期大分支中。

授权、子项、完成与证据只在[任务清单](../任务清单.md)维护。
