# Agent Note: 文章树工作台

Status: implemented

[English](2026-08-29-article-tree-workbench.md) | 中文

## Problem

长文写作需要可控地经过选题、草稿、审核和终稿，同时对话仍然是用户决定下一步的位置。单个 Markdown 文件或隐藏的模型工作流无法同时保存人工回退、外部编辑和探索性分支，因为 UI、模型工具、工作区文件和 Session 历史不会共享同一个持久文章状态。

写作中的探索还增加了一个约束：从当前步骤产生的新想法必须成为子对话中的子文章线，而不是自动合并回父草稿的请求。父分支和子分支的草稿、审核稿、终稿、文件和回退历史必须保持隔离。

## Decision

文章工作台是由 `@deepseek-ai/dsh-article-workbench` 加载的第一方插件栈。它组合 `@deepseek-ai/dsh-article`、`@deepseek-ai/dsh-article-workspace`、`@deepseek-ai/dsh-article-control`、`@deepseek-ai/dsh-tool-article` 和 `@deepseek-ai/dsh-client-ui-article`。

`@deepseek-ai/dsh-article` 拥有事件溯源的文章 Projection。`article/document` 事件保存不可变 Markdown 文档版本。`article/change` 事件保存每次状态转换后的完整分支状态。`article/branch-change` 事件保存可恢复的分支请求、父子关系、子 Session id 和失败状态。`article/action` 事件记录人工操作，例如推进、提交审核、回退、同步和创建分支。Session Projection 是 Dock UI、Remote API 和模型工具的读取模型。

每棵文章树有一个 `ArticleTreeId`。每条独立文章线有一个 `ArticleBranchId`；根文章也是一个没有父分支的分支。分支记录包含所属 `sessionId`、可选父分支和父 Session、分叉阶段、分叉文章版本、分叉文档版本、当前阶段和 CAS 版本。Fold 会拒绝文档归属不一致和非法的分支请求生命周期转换，因此冷重放和在线服务拥有相同权威。

`@deepseek-ai/dsh-article-control` 拥有用户控制的变更。`next`、`requestChanges`、`rollback`、`synchronize` 和分支请求方法都要求调用方提供当前 `ArticleRef`，因此过期 UI 操作会失败，而不是覆盖更新后的分支状态。分支创建使用 Harness 现有 Session fork 路径：子 Session 获得父对话已完成历史、相同 cwd、父 Preset 组合，以及包含已保存新想法的用户消息。如果 Session 已存在但文章初始化失败，请求会记录子 Session id 并进入 `failed`；父 UI 可以重试初始化、打开普通分叉对话，或取消文章关联。

审核循环是封闭的人工控制循环，而不是模型工作流。从草稿推进会保存一个分支本地审核模板作为 `review` 文档，并把分支推进到审核阶段；在审核阶段推进会遭到拒绝，直到用户做出明确决定。`requestChanges` 会把分支返回到当前草稿并清除 review 和 final 指针，之后模型可以写入新草稿，分支可以再次提交审核，如此反复。`approveFinal` 要求 Agent 空闲、同步审核工作副本、以 `article/action` 事件记录批准事实，然后才要求模型写入终稿。未完成的 `next` 和 `approve` 动作会在对应草稿或终稿写入时以 completed 闭合；批准事实保存在 Session 日志中，绝不在临时 UI 状态中。

`@deepseek-ai/dsh-article-workspace` 只在 `.dsh/article/<tree-id>/<branch-id>/` 下物化当前分支。它把 Markdown 文件视为由 Session 日志支持的外部工作副本。物化会拒绝覆盖脏的已跟踪文件或无关现有文件。同步会在检查当前文章 CAS 版本后，把编辑过的分支本地 Markdown 文件导入为新的人工文档版本。

`@deepseek-ai/dsh-tool-article` 给模型提供分支本地读写工具。模型写入必须声明当前分支 id 和版本，检查分支工作区干净，追加新的不可变文档版本，并重新物化分支文件。该工具不能创建分支、回退、合并分支，也不能写入兄弟或父分支。

`@deepseek-ai/dsh-client-ui-article` 在 `conversation.input.dock` 注册紧凑 Dock 面板。它可以创建根文章、推进阶段、打开分支文件、同步编辑、在分支内回退、在当前 Agent 运行时记录分支想法、在运行结束后确认保存的分支、重试失败的分支初始化，并根据 Session 摘要和文章 Projection 渲染递归文章树。打开树节点会打开该节点所属的 Session。文章树来自 Session Projection；不存在独立的全局文章树数据库。

## Alternatives considered

**把个人出版系统作为嵌入式 Web 应用迁移** — 拒绝。原系统证明了有用的工作流概念，但嵌入它会保留另一套状态权威，并让 Harness 的 Session 历史、插件加载、Remote API 和模型可见日志服从外部工作台。

**把分支表示为合并回父文章的请求** — 拒绝。用户需要新想法成为拥有独立对话和回退历史的独立文章线。自动合并会让父分支状态依赖子分支工作，并产生隐藏的跨分支写入。

**把文章树存入新的全局数据库** — 拒绝。Session 日志已经提供追加式持久化和重放。第二个数据库需要与 Session fork、冷 Session、删除或失败的子分支初始化做协调。当前实现从文章 Projection 和 Session 摘要读取父子关系。

**允许模型工具驱动分支和回退** — 拒绝。分支创建、回退和草稿恢复是误触成本较高的用户控制操作。模型可以编辑当前分支文档，而控制操作保留在 UI 和 Remote 方法之后。

## Consequences

工作台在 Harness 内建立了第一条原生文章写作路径：UI、模型工具、Markdown 文件和分支导航共享同一个 Session 日志权威。父分支、子分支和孙分支可以独立演进，因为每个分支都拥有自己的 Session、文档版本、工作区目录和 CAS 版本。

该实现明确排除自动分支合并。用户仍可通过 Harness 打开和引用其他 Session，但文章插件不会把另一分支自动加入当前模型请求，也不会让子分支覆盖父分支文件。

初始工作台覆盖文字文档和分支本地 Markdown 编辑。生图和改图不属于本次决策；加入时必须在同一条不合并规则下使用分支本地图片版本、Harness attachments 和 Harness jobs。

## Verification

文章 Fold 单测覆盖根分支创建、草稿/审核/终稿推进、跨多轮审核的 request-changes 重放、分支请求生命周期恢复，以及分支本地回退隔离。文章控制测试覆盖审核模板、审核阶段拒绝隐式推进、多轮"审核意见-改稿-再审核"循环（未经批准永远不会产生终稿），以及批准审计闭合。文章服务回归测试覆盖子分支初始化后对继承父分支请求的过滤。仓库 typecheck 会先构建 host face，再检查 client contracts，这验证了 Remote 客户端生成和客户端 Dock 包可以一起编译。生成的工具目录包含分支本地文章工具。
