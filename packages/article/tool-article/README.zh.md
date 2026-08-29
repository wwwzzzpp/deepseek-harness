# @deepseek-ai/dsh-tool-article

[English](README.md) | 中文

面向活跃文章分支的模型工具。该包注册 `article_read_current`，并在 writable 时注册 `article_write`，让模型可以产出完整 Markdown 版本，但不能控制工作流按钮或分支创建。

## Tools

- `article_read_current()` 返回当前 branch id、revision、stage、title、branch name、可选 parent ids、可选 workspace directory 和活跃 Markdown 文档。
- `article_write(branch_id, revision, kind, markdown)` 在检查精确 branch CAS ref 和当前工作副本干净后，保存一个完整的新不可变文档版本。

write 工具永远不会创建分支、回退、合并，也不会修改父分支和兄弟分支。终稿只能从审核或终稿阶段写入；review notes 要求当前分支已不在 idea 阶段。

## Model Experience

### Article tools and guidance

#### What the model sees

模型会收到一个名为 `tool:article` 的 system-prompt section，要求它先调用 `article_read_current` 再调用 `article_write`，只写当前分支，并把分支和回退留给人工控制。当该包在作用域内时，模型也会看到两个工具 schema。

#### Token effect

固定 prompt-section 成本很小，另外有 `article_read_current` 和可选 `article_write` 的 schema 成本。每个 read result 可能包含当前 Markdown；每个 write result 是紧凑的 saved-revision summary。

#### KV Cache effect

只要插件作用域和 writable config 不变，prompt section 和 schemas 对 prefix 是稳定的。工具调用和结果追加在可复用 request prefix 之后。

## Known Limitations and Deferred Work

- **只支持完整文档写入** —— partial edits 和 patch-style review comments 不是独立操作。
- **工作流控制仅限人工** —— 模型不能通过这些工具推进阶段、回退或创建分支。
- **暂未提供图片工具** —— 分支本地生图和改图需要后续基于 attachment/job 的工具集。
