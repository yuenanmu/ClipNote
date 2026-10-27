# T05 Markmap 与对照阅读实施计划

用户已明确要求实施批准方案；在现有 feat/reader、5a712c5 上开发，一个主执行者写入，不合并、不推送、不启动 T06。

## 任务与完成条件

1. [x] 同 AST 有序脑图：标题/列表/段落直接入图，代码/表格紧凑入口，保持 ReaderPosition；真实行为 RED→GREEN。
2. [x] 本地 Markmap renderer：转义文字与 payload 定位，初始章节主干100%，宽文字/完整标签、无自动fit、标题定位、显式查看原文；替代旧布局/色块。
3. [x] Reader 三模式与分隔条：Markdown/Mindmap/对照，共用单实例；左正文40%/右脑图60%、两侧280px最小宽度、指针/键盘/双击、比例持久化、导航折叠及笔记/大纲页签，点击跨页联动且不退出双栏。
4. [x] 离线真实窗口、长文/1800条目/P009上限案例，类型/构建/本地与窗口回归、截图、独立只读审阅、文档与本地提交。准确记录见任务清单T05；最终本地90/窗口37通过。

## 接口与实现约束

- ReaderContent.mindmap 沿用 id/target/children，增加节点 kind 并按原文顺序生成段落子节点，不另写原文件。
- Markmap IPureNode payload 保留原节点ID/块索引；HTML content 只由已转义文本与应用自有标记组成，不加载外部assets/plugin。
- 模式为 markdown/mindmap/split；共享 active 位置，graph focus 与正文跳转分别控制，普通滚动不联动。
- 分栏比例只保存用户界面偏好；拖动不重新创建 Markdown/Markmap，不重置阅读位置；尺寸改变不自动fit。
- 大图fit使用真实缩放，不设旧 .001 下限；只主动查看全图才fit，始终保留文本。

## 验证重点

有序段落/列表、命名空间与精确目标；长文字保留/安全转义；首屏主干正常字号；展开/收起/缩放/resize不重置；三视图单实例；指针/触控/键盘分隔、双击恢复、重启比例；失效刷新/归档回查；接近20k AST节点的fit边界。

沿用用户指定当前目录/分支与 PowerShell/.local 进度记录，无需重新请求设计或另建 worktree。官方 Markmap API 已在设计讨论中核对，具体锁定版本由 npm registry 查询确认。
