# @deepseek-ai/dsh-article-workspace

English | [中文](README.zh.md)

Conflict-safe Markdown working copies for article branches. `ctx.articleWorkspace` materializes the active branch under `.dsh/article/<tree-id>/<branch-id>/`, imports exact external edits as new human document revisions, and refuses to overwrite dirty tracked files.

## Service contract

Every branch gets its own directory and up to four files: `material.md`, `draft.md`, `review.md`, and `final.md`. Materialization writes only the current document pointers for the active branch. Existing tracked files must still match their recorded digest; unrelated files at reserved document paths are treated as conflicts instead of being overwritten.

Synchronization reads one tracked file and saves its full Markdown content as a new `human-file` revision on the current branch. It then rematerializes the branch and updates workspace metadata with fresh digests. `assertClean()` is used by rollback and final-stage controls so an unsynchronized external edit cannot be lost by re-exporting older durable content.

## Model Experience

### Working-copy paths

#### What the model sees

This service adds no prompt content. After materialization, `ArticleWorkspaceSnapshot` paths may appear in `article_read_current` or `article_write` results so the model can mention the branch-local Markdown directory.

#### Token effect

None by itself. File paths become tokens only when another component includes them in model-visible output.

#### KV Cache effect

None by itself. Digest changes update Session projection metadata rather than reusable prompt prefixes.

## Known Limitations and Deferred Work

- **Markdown is a working copy** — the Session log remains authoritative; editing files without clicking sync does not change durable article state.
- **Current-branch only** — synchronization and conflict checks operate on the live branch for one Agent, not on the whole article tree.
- **No live dirty badge for cold branches** — the browser tree can report lineage from projections, while exact filesystem dirty status is checked when a branch is opened or synchronized.
