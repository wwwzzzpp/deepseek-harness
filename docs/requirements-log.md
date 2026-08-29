# Requirements Completion Log

English | [中文](requirements-log.zh.md)

This file records product requirements that entered implementation and their actual delivery status. A plan is not completion; status follows implemented behavior and verification evidence.

## Summary

| ID | Requirement | Status | Completion date | Related modules |
| --- | --- | --- | --- | --- |
| REQ-2026-001 | Native DeepSeek Harness article-tree workbench | Partially complete | 2026-08-29 | `packages/article/`, `packages/client/ui-article/`, `packages/bundle/article-workbench/` |

## Requirement records

### REQ-2026-001 Native DeepSeek Harness article-tree workbench

- Status: partially complete
- Requested: 2026-08-29
- Completed: 2026-08-29
- User goal: migrate the personal publishing system into native DeepSeek Harness plugin capabilities, control the article workflow from topic to final draft inside the chat UI, and allow an independent article branch linked to a new conversation to be created from any step.
- Delivered result: the first native article-tree workbench is implemented. A user can create a root article from the conversation input Dock, advance idea, draft, review, and final stages, open and synchronize the current branch Markdown working copy, return to draft or a historical draft inside the current branch, and create a new child-branch conversation from the current stage. Each branch owns its own Session, article state, document versions, Markdown directory, and rollback history; a child branch never automatically merges into or overwrites its parent.
- Implementation: article state is stored in the Session log and restored through the `article` Projection. The control panel calls only `article-control` Remote methods for workflow advancement, rollback, and branch creation; the model can only read and write current-branch documents through article tools. `article-workspace` creates and synchronizes Markdown files under `.dsh/article/<tree-id>/<branch-id>/`; external edits are imported as new human revisions, and dirty unsynchronized files block overwrites. Branch creation uses the Harness Session fork mechanism, copies the parent branch's current documents into child-owned initial revisions, and sends the saved idea as the child conversation message.
- Acceptance:
  - [x] Loading the bundle provides the article workbench plugin stack and Dock control panel entry.
  - [x] A root branch can be created and advanced through idea, draft, review, and final stages.
  - [x] Document versions are immutable; rollback only selects a draft revision in the current branch and never deletes old finals.
  - [x] Markdown files are isolated by tree and branch, and unsynchronized external edits are not overwritten.
  - [x] Creating a child branch from the current branch creates an independent Session, branch id, copied document revisions, and Markdown directory.
  - [x] Creating a branch while the Agent is running saves the idea first and waits for confirmation after the current turn completes.
  - [x] Branch creation failure records recoverable state and preserves any child Session id that was already created.
  - [x] The branch tree is rebuilt from Session Projection data instead of a new global article-tree database.
  - [x] Child branches cannot automatically merge into or overwrite a parent branch through the article plugin.
  - [ ] Image generation, image editing, and image-version workflows are not implemented yet; they should later use the same branch isolation rules with Harness attachments and jobs.
  - [ ] Keyless Web Snapshot, complete GUI tests, and real-browser interaction acceptance are not yet complete.
- Verification evidence: `pnpm exec vitest run packages/article/article/tests/fold.spec.ts packages/article/article/tests/service.spec.ts` passed; `pnpm run typecheck` passed; `pnpm run gen-tool-catalog` regenerated the tool catalog.
- Implementation locations: `packages/article/article/`, `packages/article/article-workspace/`, `packages/article/article-control/`, `packages/article/tool-article/`, `packages/client/ui-article/`, `packages/bundle/article-workbench/`, `docs/tool-catalog.md`, `.agents/notes/implemented/feature/2026-08-29-article-tree-workbench.md`.
- Related requirements: none.
- Follow-up work: add branch-isolated image generation and editing workflows; add UI interaction tests, Keyless Web Snapshot coverage, and end-to-end coverage for failure recovery.
