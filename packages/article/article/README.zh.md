# @deepseek-ai/dsh-article

[English](README.md) | 中文

事件溯源的文章树状态。`ctx.articles` 在一个 Session 日志内持有当前文章分支，记录不可变 Markdown 文档版本，折叠分支创建请求，并注册浏览器面板读取的 `article` Session 投影。

## Service contract

该服务只接受按 id 注册的精确 live `Agent`。变更使用 `ArticleRef { branchId, revision }` 作为 compare-and-set 栅栏；过期 ref 会在追加任何事件前被拒绝。每次接受的变更都会追加完整后状态 `article/change` 数据，而文档会先作为不可变 `article/document` 记录追加，再由后续 change 选中。分支请求追加完整 `article/branch-change` 记录，并且只能按 `draft -> creating -> ready|failed`、`draft -> cancelled` 或 `failed -> creating|cancelled` 迁移。

`initializeBranch()` 是 fork 后 Session 中唯一能改变活跃 branch id 的操作。它要求继承到的父文章和 Session 的 durable `parentSession` 匹配，把父分支当前文档复制为子分支拥有的 `branch-seed` 文档版本，并让子分支从 revision 1 开始。

严格重放会拒绝畸形 payload、不连续 revision、不属于当前分支的文档指针、非法阶段迁移和非法分支请求迁移。回退之后，旧草稿、审核稿和终稿文档版本仍保留在日志中。

## Model Experience

### Article projection

#### What the model sees

本服务自身不注入 prompt 内容。它注册 `article` Session 投影；host 折叠 durable `article/change` 和 `article/branch-change` 事件后，客户端 UI 和模型工具可以把它读成 `ArticleProjection`。

#### Token effect

自身没有 token 成本。只有其他组件（例如 `@deepseek-ai/dsh-tool-article`）把文章状态渲染成工具结果或 prompt section 时才会增加 token。

#### KV Cache effect

自身没有 KV-cache 影响。投影更新是 UI/runtime 状态，不是模型输入文本。

## Known Limitations and Deferred Work

- **没有全局文章数据库** —— Session 日志是 durable authority；文章树重建依赖 Session summary 携带 article projection。
- **没有分支合并** —— 子分支保留父谱系，但绝不会写回父分支。
- **信任同进程写入者** —— 拥有直接 Session 访问权的插件可以追加伪造 article events；严格重放能检测不一致日志，但不隔离插件。
