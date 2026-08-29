# @deepseek-ai/dsh-article-control

English | [中文](README.zh.md)

Human workflow controller for article branches. `ctx.articleControl` creates root articles, advances stages, returns review/final work to draft, rolls back to historical drafts, and creates recoverable child branches through ordinary Session forks.

## Service contract

The controller is the only browser-facing mutation surface. It wraps `ctx.articles` and `ctx.articleWorkspace` so every human action uses the active branch CAS ref and respects working-copy conflict checks. `next()` wakes the Agent only for model-writing stages: idea requests a draft, draft moves to review immediately, review requests a final, and final rejects.

Branch creation is recoverable. If the source Agent is running, `createBranch()` stores a `draft` branch request and does not fork partial model output. Once the Agent is idle, `confirmBranch()` creates a refreshed `creating` request from the latest complete conversation and article version. Fork failures keep the parent request; if a child Session already exists but initialization fails, the child Session id remains available for retry or ordinary opening.

## Model Experience

### Workflow followups

#### What the model sees

For idea-to-draft and review-to-final transitions, the controller queues a plugin-authored user message wrapped in `<article_workflow>`. That message instructs the model to call `article_read_current` and then `article_write` for the requested document kind.

#### Token effect

Each queued workflow followup adds one short user message to the next model request for that Session. Pure state moves such as draft-to-review, request-changes, rollback, and branch request bookkeeping add no model-visible text by themselves.

#### KV Cache effect

The workflow followup appends after prior history, so it does not invalidate the earlier reusable prefix. Branch creation copies completed history through the Session fork mechanism and then queues the branch idea as normal child Session input.

## Known Limitations and Deferred Work

- **No automatic branch merge** — child branch output never changes the parent branch.
- **Fork requires a live child Agent for initialization** — a created child Session whose Agent cannot be reached is preserved and reported as a failed branch request.
- **Images are deferred** — image generation and editing will need branch-local attachment/job handling before being added here.
