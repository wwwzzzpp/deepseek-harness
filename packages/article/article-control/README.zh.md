# @deepseek-ai/dsh-article-control

[English](README.md) | 中文

面向文章分支的人工工作流控制器。`ctx.articleControl` 创建根文章、推进阶段、把审核/终稿退回草稿、回退到历史草稿，并通过普通 Session fork 创建可恢复的子分支。

## Service contract

该控制器是唯一面向浏览器的变更 surface。它包装 `ctx.articles` 和 `ctx.articleWorkspace`，确保每个人工动作都使用活跃分支 CAS ref，并遵守工作副本冲突检查。`next()` 只在需要模型写作的阶段唤醒 Agent：选题请求草稿，草稿立即进入审核，审核请求终稿，终稿拒绝继续前进。

分支创建是可恢复的。如果源 Agent 正在运行，`createBranch()` 会保存一个 `draft` 分支请求，不会从半截模型输出 fork。Agent 空闲后，`confirmBranch()` 会用最新完整对话和文章版本创建一个刷新的 `creating` 请求。fork 失败会保留父侧请求；如果子 Session 已经创建但初始化失败，子 Session id 会继续保留，用于重试或普通打开。

## Model Experience

### Workflow followups

#### What the model sees

对于选题到草稿、审核到终稿的迁移，控制器会排入一条插件作者身份的 user message，并用 `<article_workflow>` 包裹。该消息要求模型调用 `article_read_current`，随后按请求的 document kind 调用 `article_write`。

#### Token effect

每条排队的 workflow followup 会在该 Session 下一次模型请求中增加一条短 user message。草稿进入审核、request-changes、rollback 和分支请求账本这类纯状态迁移本身不增加模型可见文本。

#### KV Cache effect

workflow followup 追加在既有历史之后，因此不会使更早的可复用 prefix 失效。分支创建通过 Session fork 机制复制已完成历史，然后把分支想法作为普通子 Session 输入排入队列。

## Known Limitations and Deferred Work

- **没有自动分支合并** —— 子分支输出永远不会改变父分支。
- **初始化需要 live child Agent** —— 如果已创建的子 Session 无法取得 Agent，它会被保留，并以 failed branch request 报告。
- **图片能力延后** —— 生图和改图加入前，需要先有分支本地 attachment/job 处理。
