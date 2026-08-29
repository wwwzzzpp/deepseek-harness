# @deepseek-ai/dsh-article

English | [中文](README.zh.md)

Event-sourced article tree state. `ctx.articles` owns the current article branch inside one Session log, records immutable Markdown document revisions, folds branch-creation requests, and registers the `article` Session projection used by the browser panel.

## Service contract

The service accepts only the exact live `Agent` registered under its id. Mutations use `ArticleRef { branchId, revision }` as a compare-and-set fence; stale refs reject before any event is appended. Each accepted mutation appends complete post-state `article/change` data, while documents append as immutable `article/document` records before the change that selects them. Branch requests append complete `article/branch-change` records and may move only through `draft -> creating -> ready|failed`, `draft -> cancelled`, or `failed -> creating|cancelled`.

`initializeBranch()` is the only operation that changes the active branch id in a forked Session. It requires the inherited parent article to match the Session's durable `parentSession`, copies the parent's current documents into new `branch-seed` document revisions owned by the child branch, and starts the child branch at revision 1.

Strict replay rejects malformed payloads, discontinuous revisions, document pointers that do not belong to the current branch, illegal stage transitions, and invalid branch-request transitions. Old draft, review, and final document revisions remain in the log after rollback.

## Model Experience

### Article projection

#### What the model sees

No prompt content is injected by this service directly. It registers the `article` Session projection, which client UI and model tools can read as `ArticleProjection` after the host has folded durable `article/change` and `article/branch-change` events.

#### Token effect

None by itself. Tokens are added only when another component, such as `@deepseek-ai/dsh-tool-article`, renders article state into a tool result or prompt section.

#### KV Cache effect

None by itself. Projection updates are UI/runtime state, not model-input text.

## Known Limitations and Deferred Work

- **No global article database** — the Session log is the durable authority; tree reconstruction depends on Session summaries carrying article projections.
- **No branch merge** — child branches retain parent lineage but never write back to the parent branch.
- **Trusted in-process writers** — a plugin with direct Session access can append counterfeit article events; strict replay detects inconsistent logs but does not isolate plugins.
