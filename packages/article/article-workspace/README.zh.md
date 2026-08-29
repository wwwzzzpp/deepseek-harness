# @deepseek-ai/dsh-article-workspace

[English](README.md) | 中文

面向文章分支的冲突安全 Markdown 工作副本。`ctx.articleWorkspace` 把活跃分支物化到 `.dsh/article/<tree-id>/<branch-id>/`，把精确的外部编辑导入为新的人工文档版本，并拒绝覆盖已经变脏的受跟踪文件。

## Service contract

每条分支都有自己的目录和最多四个文件：`material.md`、`draft.md`、`review.md`、`final.md`。物化只写活跃分支当前文档指针对应的文件。已有受跟踪文件必须仍匹配记录 digest；保留文档路径上出现的不相关文件会被视为冲突，而不是被覆盖。

同步会读取一个受跟踪文件，并把它的完整 Markdown 内容保存为当前分支的新 `human-file` 版本。随后它重新物化该分支，并用新的 digest 更新 workspace metadata。`assertClean()` 会被回退和终稿阶段控制使用，因此未同步的外部编辑不会因为重新导出旧 durable 内容而丢失。

## Model Experience

### Working-copy paths

#### What the model sees

本服务不增加 prompt 内容。物化之后，`ArticleWorkspaceSnapshot` 路径可能出现在 `article_read_current` 或 `article_write` 结果中，使模型可以提及分支本地 Markdown 目录。

#### Token effect

自身没有 token 成本。只有其他组件把文件路径放入模型可见输出时，它们才会变成 token。

#### KV Cache effect

自身没有 KV-cache 影响。digest 变化更新的是 Session projection metadata，而不是可复用 prompt prefix。

## Known Limitations and Deferred Work

- **Markdown 是工作副本** —— Session 日志仍是 authoritative；只编辑文件而不点击同步不会改变 durable article state。
- **只处理当前分支** —— 同步和冲突检查作用于一个 Agent 的 live branch，而不是整棵文章树。
- **冷分支没有实时 dirty badge** —— 浏览器树可以从 projections 报告谱系；精确文件系统 dirty 状态会在打开或同步某个分支时检查。
