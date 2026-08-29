# 文章工作台

[English](article.md) | 中文

文章工作台让一个 Session 拥有文章树中的一条可独立编辑的文章分支。每条分支记录自己的标题、阶段、当前 Markdown 文档版本、工作副本元数据和父分支关系；创建子分支时会分叉一个普通 Harness Session，并用父分支当前文档初始化新的分支本地副本。

文章事件日志是权威数据源。`.dsh/article/<tree-id>/<branch-id>/` 下的 Markdown 文件只是当前分支的可编辑工作副本；导入外部修改会创建新的不可变文档版本，而不是修改旧版本。回退只会在同一分支内选择历史草稿，不会删除终稿版本，也不会改变父分支和兄弟分支。

控制面板保持工作流转换由人明确触发：创建根文章、进入下一阶段、同步文件修改、退回草稿、回退历史草稿、创建子分支。模型工具可以读写当前分支，但不能创建分支、合并分支，或绕过控制器推进阶段。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxarticlecontrol--articlecontrolservice"></a>

### `ctx.articleControl` — `ArticleControlService`

Article workflow controller (`ctx.articleControl`).

```ts cordis-catalog
/**
 * Create one root article and its branch-local working directory.
 * @param agent - live Agent whose Session log receives the article root.
 * @param request - title and optional root branch metadata.
 * @returns materialized branch-local workspace result.
 */
async create(agent: Agent, request: CreateArticleRequest): Promise<ArticleWorkspaceResult>

/**
 * Advance under explicit human control; model-writing stages wake one visible follow-up.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns current article state and whether the Agent was started.
 */
next(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult>

/**
 * Approve the reviewed branch and ask the Agent to generate the final document.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns current article state and whether the Agent was started.
 */
async approveFinal(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult>

/**
 * Return review/final to the branch's current draft after checking external files.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns materialized branch-local workspace result after returning to draft.
 */
async requestChanges(agent: Agent, ref: ArticleRef): Promise<ArticleWorkspaceResult>

/**
 * Select a historical branch-local draft without deleting any later revision.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param revisionId - branch-local draft revision to restore.
 * @returns materialized branch-local workspace result after rollback.
 */
async rollback(agent: Agent, ref: ArticleRef, revisionId: DocumentRevisionId): Promise<ArticleWorkspaceResult>

/**
 * Save an idea immediately; fork only when the source Agent is idle.
 * @param agent - live parent Agent whose Session log owns the source branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param branchName - branch display name and child Session title.
 * @param explorationIdea - first user message for the child Session.
 * @returns durable branch request and child Session id when creation reached a fork.
 */
async createBranch(agent: Agent, ref: ArticleRef, branchName: string, explorationIdea: string): Promise<ArticleBranchControlResult>

/**
 * Confirm a saved idea against the latest completed turn and latest article revision.
 * @param agent - live parent Agent whose saved request should become a child branch.
 * @param requestId - saved draft branch request id.
 * @returns durable branch request and child Session id when creation reached a fork.
 */
async confirmBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult>

/**
 * Retry initialization without deleting a Session already created by an earlier attempt.
 * @param agent - live parent Agent whose failed request should be retried.
 * @param requestId - failed branch request id.
 * @returns durable branch request and child Session id when creation reached a fork.
 */
async retryBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult>

/**
 * Cancel only the article association request; any created child Session remains intact.
 * @param agent - live parent Agent whose request should be cancelled.
 * @param requestId - saved or failed branch request id.
 * @returns cancelled durable branch request.
 */
cancelBranch(agent: Agent, requestId: ArticleBranchRequestId): ArticleBranchControlResult

/**
 * Remote root creation.
 * @param agent - live Agent inferred from the remote request.
 * @param request - title and optional root branch metadata.
 * @returns materialized branch-local workspace result.
 */
@Remote('create') async remoteExportCreate(agent: Agent, request: CreateArticleRequest): Promise<ArticleWorkspaceResult>

/**
 * Remote next-stage control.
 * @param agent - live Agent inferred from the remote request.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns current article state and whether the Agent was started.
 */
@Remote('next') async remoteExportNext(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult>

/**
 * Remote review approval.
 * @param agent - live Agent inferred from the remote request.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns current article state and whether the Agent was started.
 */
@Remote('approveFinal') async remoteExportApproveFinal(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult>

/**
 * Remote review/final return.
 * @param agent - live Agent inferred from the remote request.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns materialized branch-local workspace result after returning to draft.
 */
@Remote('requestChanges') async remoteExportRequestChanges(agent: Agent, ref: ArticleRef): Promise<ArticleWorkspaceResult>

/**
 * Remote historical rollback.
 * @param agent - live Agent inferred from the remote request.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param revisionId - branch-local draft revision to restore.
 * @returns materialized branch-local workspace result after rollback.
 */
@Remote('rollback') async remoteExportRollback(agent: Agent, ref: ArticleRef, revisionId: DocumentRevisionId): Promise<ArticleWorkspaceResult>

/**
 * Remote branch request/fork.
 * @param agent - live parent Agent inferred from the remote request.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param branchName - branch display name and child Session title.
 * @param explorationIdea - first user message for the child Session.
 * @returns durable branch request and child Session id when creation reached a fork.
 */
@Remote('createBranch') async remoteExportCreateBranch( agent: Agent, ref: ArticleRef, branchName: string, explorationIdea: string, ): Promise<ArticleBranchControlResult>

/**
 * Remote confirmation of a saved mid-turn idea.
 * @param agent - live parent Agent inferred from the remote request.
 * @param requestId - saved draft branch request id.
 * @returns durable branch request and child Session id when creation reached a fork.
 */
@Remote('confirmBranch') async remoteExportConfirmBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult>

/**
 * Remote failed initialization retry.
 * @param agent - live parent Agent inferred from the remote request.
 * @param requestId - failed branch request id.
 * @returns durable branch request and child Session id when creation reached a fork.
 */
@Remote('retryBranch') async remoteExportRetryBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult>

/**
 * Remote article-association cancellation.
 * @param agent - live parent Agent inferred from the remote request.
 * @param requestId - saved or failed branch request id.
 * @returns cancelled durable branch request.
 */
@Remote('cancelBranch') remoteExportCancelBranch(agent: Agent, requestId: ArticleBranchRequestId): ArticleBranchControlResult

/**
 * Remote working-copy synchronization routed through one control surface.
 * @param agent - live Agent inferred from the remote request.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param kind - branch-local Markdown file to import.
 * @returns current article snapshot plus whether a new durable revision was saved.
 */
@Remote('synchronize') async remoteExportSynchronize(agent: Agent, ref: ArticleRef, kind: ArticleDocumentKind): Promise<ArticleWorkspaceResult>
```

Types: [Agent](core.md)

Source: [`packages/article/article-control/src/index.ts:36`](../../packages/article/article-control/src/index.ts)

<a id="ctxarticles--articleservice"></a>

### `ctx.articles` — `ArticleService`

Event-sourced article service (`ctx.articles`).

```ts cordis-catalog
/**
 * Return the current article branch for one exact live Agent.
 * @param agent - live Agent whose Session log owns the branch.
 * @returns cloned current branch snapshot, or undefined before article creation.
 */
get(agent: Agent): ArticleSnapshot | undefined

/**
 * Return one immutable document only when it belongs to the active branch.
 * @param agent - live Agent whose Session log owns the branch.
 * @param revisionId - immutable document revision id to read.
 * @returns cloned document record for the current branch.
 */
readDocument(agent: Agent, revisionId: DocumentRevisionIdType): ArticleDocumentRecord

/**
 * Read the current document for one kind.
 * @param agent - live Agent whose Session log owns the branch.
 * @param kind - material, draft, review, or final slot to inspect.
 * @returns cloned current document record, or undefined when the slot is empty.
 */
readCurrentDocument(agent: Agent, kind: ArticleDocumentKind): ArticleDocumentRecord | undefined

/**
 * List immutable revisions owned by the current branch, newest first.
 * @param agent - live Agent whose Session log owns the branch.
 * @param kind - optional document kind filter.
 * @returns cloned branch-local revision summaries sorted by creation time descending.
 */
listRevisions(agent: Agent, kind?: ArticleDocumentKind): ArticleDocumentSummary[]

/**
 * Read one durable child-branch request owned by the current branch.
 * @param agent - live Agent whose Session log owns the branch.
 * @param requestId - durable branch request id to read.
 * @returns cloned branch request, or undefined when the request is absent or inherited from another branch.
 */
getBranchRequest(agent: Agent, requestId: ArticleBranchRequestIdType): ArticleBranchRequest | undefined

/**
 * Create the root article branch for the current Session.
 * @param agent - live Agent whose Session log receives the root article event.
 * @param request - root title and optional root branch metadata.
 * @returns cloned root branch snapshot at revision 1.
 */
create(agent: Agent, request: CreateArticleRequest): ArticleSnapshot

/**
 * Replace the inherited active branch with a branch-local revision-1 copy.
 * @param agent - live forked Agent whose Session inherited the parent branch events.
 * @param request - child branch id, display name, and starting idea.
 * @returns cloned child branch snapshot at revision 1.
 */
initializeBranch(agent: Agent, request: InitializeArticleBranchRequest): ArticleSnapshot

/**
 * Append one immutable document and select it as the current kind.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param request - Markdown, slot, and source metadata to save.
 * @returns cloned branch snapshot after selecting the new document revision.
 */
saveDocument(agent: Agent, ref: ArticleRef, request: SaveArticleDocumentRequest): ArticleSnapshot

/**
 * Move a draft into human review without changing document pointers.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns cloned branch snapshot in review stage.
 */
submitReview(agent: Agent, ref: ArticleRef): ArticleSnapshot

/**
 * Return review/final work to its current draft without deleting later revisions.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns cloned branch snapshot in draft stage with review/final pointers cleared.
 */
requestChanges(agent: Agent, ref: ArticleRef): ArticleSnapshot

/**
 * Select one historical draft as current while preserving every later revision.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param revisionId - branch-local draft revision to restore as current.
 * @returns cloned branch snapshot in draft stage with the selected draft revision.
 */
rollback(agent: Agent, ref: ArticleRef, revisionId: DocumentRevisionIdType): ArticleSnapshot

/**
 * Update branch-local working-copy metadata without changing content or stage.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param workspace - branch-local Markdown working-copy metadata to persist.
 * @returns cloned branch snapshot with updated workspace metadata.
 */
updateWorkspace(agent: Agent, ref: ArticleRef, workspace: ArticleWorkspaceSnapshot): ArticleSnapshot

/**
 * Create a durable parent-side branch request.
 * @param agent - live parent Agent whose Session log owns the source branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param input - child display name, starting idea, and initial request status.
 * @returns cloned branch request recorded in the parent Session.
 */
createBranchRequest(agent: Agent, ref: ArticleRef, input: { branchName: string; explorationIdea: string; status: 'draft' | 'creating' }): ArticleBranchRequest

/**
 * Move an existing branch request through its durable lifecycle.
 * @param agent - live parent Agent whose Session log owns the request.
 * @param requestId - durable branch request id to update.
 * @param update - next lifecycle status and optional child Session or failure detail.
 * @returns cloned updated branch request.
 */
updateBranchRequest( agent: Agent, requestId: ArticleBranchRequestIdType, update: { status: 'creating' | 'ready' | 'failed' | 'cancelled' childSessionId?: ArticleBranchRequest['childSessionId'] error?: string }, ): ArticleBranchRequest

/**
 * Append a workflow audit fact.
 * @param agent - live Agent whose Session log owns the branch.
 * @param action - workflow action being audited.
 * @param status - lifecycle state of the workflow action.
 * @param detail - optional human-readable detail such as a target revision or child Session id.
 */
recordAction(agent: Agent, action: ArticleActionMeta['action'], status: ArticleActionMeta['status'], detail?: string): void

/**
 * Remote current-state read.
 * @param agent - live Agent inferred from the remote request.
 * @returns wire-safe current branch state.
 */
@Remote('get') remoteExportGet(agent: Agent): ArticleReadResult

/**
 * Remote branch-local revision list.
 * @param agent - live Agent inferred from the remote request.
 * @param kind - optional document kind filter.
 * @returns wire-safe branch-local revision summaries.
 */
@Remote('listRevisions') remoteExportListRevisions(agent: Agent, kind?: ArticleDocumentKind): ArticleRevisionListResult
```

Types: [Agent](core.md)

Source: [`packages/article/article/src/index.ts:81`](../../packages/article/article/src/index.ts)

<a id="ctxarticleworkspace--articleworkspaceservice"></a>

### `ctx.articleWorkspace` — `ArticleWorkspaceService`

Branch-local Markdown service (`ctx.articleWorkspace`).

```ts cordis-catalog
/**
 * Materialize every current durable document without overwriting external edits.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @returns current article snapshot plus whether files or workspace metadata changed.
 */
async materialize(agent: Agent, ref: ArticleRef): Promise<ArticleWorkspaceResult>

/**
 * Import one externally edited file as a new immutable human revision.
 * @param agent - live Agent whose Session log owns the branch.
 * @param ref - compare-and-set branch revision expected by the caller.
 * @param kind - branch-local Markdown file to import.
 * @returns current article snapshot plus whether a new durable revision was saved.
 */
async synchronize(agent: Agent, ref: ArticleRef, kind: ArticleDocumentKind): Promise<ArticleWorkspaceResult>

/**
 * Reject a state-changing file export or rollback while a tracked file is dirty.
 * @param agent - live Agent whose branch workspace should be checked.
 * @returns void when no tracked file has unsynchronized external edits.
 */
async assertClean(agent: Agent): Promise<void>
```

Types: [Agent](core.md)

Source: [`packages/article/article-workspace/src/index.ts:45`](../../packages/article/article-workspace/src/index.ts)

<a id="article-events"></a>

### `article/*` events

<a id="articlechanged--emit"></a>

#### `article/changed` — emit

Article mutation accepted for one live Agent after its Session event committed.

```ts cordis-catalog
/**
 * Article mutation accepted for one live Agent after its Session event committed.
 * @param payload.agent - Agent whose Session owns the branch.
 * @param payload.change - committed current article value.
 * @mode emit
 */
'article/changed'(payload: { agent: Agent; change: ArticleChanged }): void
```

Types: [Agent](core.md)

Source: [`packages/article/article/src/domain.ts:102`](../../packages/article/article/src/domain.ts)
<!-- END GENERATED cordis-surface -->
