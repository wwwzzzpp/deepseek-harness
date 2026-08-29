# Agent Note: Article tree workbench

Status: implemented

English | [中文](2026-08-29-article-tree-workbench.zh.md)

## Problem

Long-form writing needs a controllable progression through idea, draft, review, and final states while the agent conversation remains the place where the user decides what happens next. A single Markdown file or a hidden model workflow cannot preserve manual rollback, external edits, and exploratory branches because the UI, model tools, workspace files, and session history would not share one durable article state.

Exploration during writing adds another constraint: a new idea created from the current step must become a child article line in a child conversation, not an automatic merge request into the parent draft. Parent and child drafts, review documents, final versions, files, and rollback histories must remain isolated.

## Decision

The article workbench is a first-party plugin stack loaded by `@deepseek-ai/dsh-article-workbench`. It composes `@deepseek-ai/dsh-article`, `@deepseek-ai/dsh-article-workspace`, `@deepseek-ai/dsh-article-control`, `@deepseek-ai/dsh-tool-article`, and `@deepseek-ai/dsh-client-ui-article`.

`@deepseek-ai/dsh-article` owns the event-sourced article projection. `article/document` events store immutable Markdown document revisions. `article/change` events store the full branch state after each state transition. `article/branch-change` events store recoverable branch requests, parent-child relationships, child session ids, and failure states. `article/action` events record manual operations such as advancing, review submission, rollback, synchronization, and branch creation. The Session projection is the read model for the dock UI, Remote APIs, and model tools.

Each article tree has one `ArticleTreeId`. Each independent article line has one `ArticleBranchId`; the root article is a branch with no parent. Branch records include their owning `sessionId`, optional parent branch and parent session, fork stage, fork article revision, fork document revision, current stage, and CAS revision. The fold rejects document ownership mismatches and invalid branch request lifecycle transitions so cold replay has the same authority as the live service.

`@deepseek-ai/dsh-article-control` owns user-controlled mutations. The `next`, `requestChanges`, `rollback`, `synchronize`, and branch request methods require the caller's current `ArticleRef` so stale UI actions fail instead of overwriting a newer branch state. Branch creation uses the existing Harness session fork path: the child session receives the completed parent history, the same cwd, the parent preset composition, and a user message containing the saved exploration idea. If article initialization fails after the session exists, the request records the child session id and enters `failed`; the parent UI can retry initialization, open the ordinary fork, or cancel the article association.

The review loop is a closed human-controlled cycle, not a model workflow. Advancing from draft saves a branch-local review template as a `review` document and moves the branch to review stage; advancing from review is rejected until the user chooses an explicit decision. `requestChanges` returns the branch to its current draft and clears the review and final pointers, after which the model may write a new draft and the branch can be submitted for review again, repeatedly. `approveFinal` requires an idle agent, syncs the review working copy, records the approval fact as an `article/action` event, and only then asks the model to write the final document. Pending `next` and `approve` actions close as completed when the corresponding draft or final document arrives; the approval fact lives in the Session log, never in transient UI state.

`@deepseek-ai/dsh-article-workspace` materializes only the current branch under `.dsh/article/<tree-id>/<branch-id>/`. It treats Markdown files as external working copies backed by the Session log. Materialization refuses to overwrite dirty tracked files or unrelated files. Synchronization imports an edited branch-local Markdown file as a new manual document revision after checking the current article CAS revision.

`@deepseek-ai/dsh-tool-article` gives the model branch-local read and write tools. Model writes must name the current branch id and revision, check the branch workspace is clean, append a new immutable document revision, and rematerialize the branch files. The tool cannot create branches, roll back, merge branches, or write a sibling or parent branch.

`@deepseek-ai/dsh-client-ui-article` registers a compact dock panel in `conversation.input.dock`. It creates the root article, advances stages, opens branch files, synchronizes edits, rolls back within the branch, records branch ideas while the current agent is running, confirms a saved branch after the run, retries failed branch initialization, and renders a recursive article tree from session summaries and article projections. Opening a tree node opens that node's owning session. The tree is derived from Session projections; there is no separate global article-tree database.

## Alternatives considered

**Port the personal publishing system as an embedded web app** — rejected. The earlier system proves useful workflow concepts, but embedding it would keep a separate state authority and make Harness session history, plugin loading, Remote APIs, and model-visible logging subordinate to an external workbench.

**Represent branches as merge requests back into the parent article** — rejected. The user needs a new idea to become an independent article line with its own conversation and rollback history. Automatic merge behavior would make parent branch state depend on child work and would create hidden cross-branch writes.

**Store the tree in a new global article database** — rejected. Session logs already provide append-only durability and replay. A second database would need reconciliation with session forks, cold sessions, and deleted or failed child initialization. The implemented tree reads parent-child relationships from article projections and session summaries.

**Let model tools drive branching and rollback** — rejected. Branch creation, rollback, and draft recovery are user-control operations with high cost when triggered incorrectly. The model can edit the current branch document, while control actions stay behind UI and Remote methods.

## Consequences

The workbench creates the first native article-writing path inside Harness: the UI, model tools, Markdown files, and branch navigation all share the same Session-log authority. A parent branch, child branch, and grandchild branch can evolve independently because every branch owns its own session, document revisions, workspace directory, and CAS revision.

The implementation deliberately excludes automatic branch merging. Users can open and reference other sessions through Harness, but the article plugin never imports another branch into the current prompt or overwrites parent files from a child branch.

The initial workbench covers text documents and branch-local Markdown editing. Image generation and image editing remain outside this decision; when added, they must use branch-local image revisions, Harness attachments, and Harness jobs under the same no-merge rule.

## Verification

The article fold unit tests cover root branch creation, draft/review/final progression, request-changes replay across repeated review rounds, branch request lifecycle recovery, and branch-local rollback isolation. The article control tests cover the review template, the rejected implicit advance from review, the multi-round review-comments-rewrite-re-review loop that never produces a final without approval, and approval audit closure. The article service regression test covers inherited parent branch request filtering after child branch initialization. The repository typecheck builds the host face before checking client contracts, which verifies the Remote client generation and client dock package compile together. The generated tool catalog includes the branch-local article tools.
