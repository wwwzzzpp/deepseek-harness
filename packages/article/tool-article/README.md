# @deepseek-ai/dsh-tool-article

English | [中文](README.zh.md)

Model-facing tools for the active article branch. The package registers `article_read_current` and, when writable, `article_write` so the model can produce complete Markdown revisions without controlling workflow buttons or branch creation.

## Tools

- `article_read_current()` returns the current branch id, revision, stage, title, branch name, optional parent ids, optional workspace directory, and the active Markdown documents.
- `article_write(branch_id, revision, kind, markdown)` saves a complete new immutable document revision after checking the exact branch CAS ref and current working-copy cleanliness.

The write tool never creates branches, rolls back, merges, or modifies parent and sibling branches. A final document may be written only from review or final stage; review notes require an existing non-idea branch.

## Model Experience

### Article tools and guidance

#### What the model sees

The model receives one system-prompt section named `tool:article` telling it to call `article_read_current` before `article_write`, write only the current branch, and leave branching and rollback to human controls. It also sees the two tool schemas when this package is in scope.

#### Token effect

There is a small fixed prompt-section cost plus the schema cost for `article_read_current` and optionally `article_write`. Each read result may include current Markdown; each write result is a compact saved-revision summary.

#### KV Cache effect

The prompt section and schemas are prefix-stable while the plugin scope and writable config stay unchanged. Tool calls and results append after the reusable request prefix.

## Known Limitations and Deferred Work

- **Complete-document writes only** — partial edits and patch-style review comments are not separate operations.
- **Human-only workflow controls** — the model cannot advance stages, roll back, or create branches through these tools.
- **No image tools yet** — branch-local image generation and editing require a later attachment/job-backed tool set.
