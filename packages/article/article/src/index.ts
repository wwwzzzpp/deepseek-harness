/** Event-sourced article-tree branch service with CAS mutations and Session projection. */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {
  ArticleActionMeta,
  ArticleBranchChangeMeta,
  ArticleChangeMeta,
  ArticleDocumentRecord,
  ArticleOperation,
} from './domain.ts'
import { applyArticleEvent, applyArticleProjection, emptyArticleFoldState } from './fold.ts'
import type { ArticleFoldState } from './fold.ts'
import {
  ArticleBranchId,
  ArticleBranchRequestId,
  ArticleError,
  ArticleTreeId,
  DocumentRevisionId,
} from './runtime.ts'
import type {
  ArticleBranchId as ArticleBranchIdType,
  ArticleBranchRequest,
  ArticleBranchRequestId as ArticleBranchRequestIdType,
  ArticleDocumentKind,
  ArticleDocumentSummary,
  ArticleProjection,
  ArticleReadResult,
  ArticleRef,
  ArticleRevisionListResult,
  ArticleSnapshot,
  ArticleWorkspaceSnapshot,
  CreateArticleRequest,
  DocumentRevisionId as DocumentRevisionIdType,
  SaveArticleDocumentRequest,
} from './types.ts'

export type * from './types.ts'
export type * from './domain.ts'
export {
  ArticleBranchId,
  ArticleBranchRequestId,
  ArticleError,
  ArticleTreeId,
  DocumentRevisionId,
  applyArticleProjection,
  foldArticle,
} from './runtime-exports.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { articles: ArticleService }
}

const articleProjectionSchema = zod.custom<ArticleProjection | null>((value) => {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.documentRevisionCount === 'number'
    && typeof candidate.article === 'object' && candidate.article !== null
}) as ZodType<ArticleProjection | null>

interface ArticleCache {
  state: ArticleFoldState
  observedSeq: number
}

/** Input used by the branch controller after a Session fork succeeds. */
export interface InitializeArticleBranchRequest {
  readonly branchId: ArticleBranchIdType
  readonly branchName: string
  readonly explorationIdea: string
}

/** Event-sourced article service (`ctx.articles`). */
export class ArticleService extends TypertRemoteService {
  static inject = ['agents']
  private readonly caches = new WeakMap<Session, ArticleCache>()

  /**
   * @param ctx - Cordis context that owns the article service and optional projection registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'articles')
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'article', ArticleProjection | null>({
        key: 'article',
        schema: articleProjectionSchema,
        init: () => null,
        apply: applyArticleProjection,
        view: state => state,
        stateVersion: 1,
      })
    })
  }

  /**
   * Return the current article branch for one exact live Agent.
   * @param agent - live Agent whose Session log owns the branch.
   * @returns cloned current branch snapshot, or undefined before article creation.
   */
  get(agent: Agent): ArticleSnapshot | undefined {
    const cache = this.prepare(agent)
    return cache.state.article === undefined ? undefined : structuredClone(cache.state.article)
  }

  /**
   * Return one immutable document only when it belongs to the active branch.
   * @param agent - live Agent whose Session log owns the branch.
   * @param revisionId - immutable document revision id to read.
   * @returns cloned document record for the current branch.
   */
  readDocument(agent: Agent, revisionId: DocumentRevisionIdType): ArticleDocumentRecord {
    const cache = this.prepare(agent)
    const article = this.requireArticle(cache)
    const document = cache.state.documents.get(revisionId)
    if (document === undefined || document.branchId !== article.branchId) {
      throw new ArticleError(`article document ${revisionId} was not found in the current branch`, 'ARTICLE_DOCUMENT_NOT_FOUND')
    }
    return structuredClone(document)
  }

  /**
   * Read the current document for one kind.
   * @param agent - live Agent whose Session log owns the branch.
   * @param kind - material, draft, review, or final slot to inspect.
   * @returns cloned current document record, or undefined when the slot is empty.
   */
  readCurrentDocument(agent: Agent, kind: ArticleDocumentKind): ArticleDocumentRecord | undefined {
    const article = this.get(agent)
    const id = article?.currentDocuments[kind]
    return id === undefined ? undefined : this.readDocument(agent, id)
  }

  /**
   * List immutable revisions owned by the current branch, newest first.
   * @param agent - live Agent whose Session log owns the branch.
   * @param kind - optional document kind filter.
   * @returns cloned branch-local revision summaries sorted by creation time descending.
   */
  listRevisions(agent: Agent, kind?: ArticleDocumentKind): ArticleDocumentSummary[] {
    const cache = this.prepare(agent)
    const article = this.requireArticle(cache)
    return [...cache.state.documents.values()]
      .filter(document => document.branchId === article.branchId && (kind === undefined || document.kind === kind))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(document => structuredClone({
        id: document.id,
        branchId: document.branchId,
        kind: document.kind,
        source: document.source,
        createdAt: document.createdAt,
      }))
  }

  /**
   * Read one durable child-branch request owned by the current branch.
   * @param agent - live Agent whose Session log owns the branch.
   * @param requestId - durable branch request id to read.
   * @returns cloned branch request, or undefined when the request is absent or inherited from another branch.
   */
  getBranchRequest(agent: Agent, requestId: ArticleBranchRequestIdType): ArticleBranchRequest | undefined {
    const cache = this.prepare(agent)
    const article = this.requireArticle(cache)
    const request = cache.state.branchRequests.get(requestId)
    if (request !== undefined && !requestBelongsToArticle(request, article)) return undefined
    return request === undefined ? undefined : structuredClone(request)
  }

  /**
   * Create the root article branch for the current Session.
   * @param agent - live Agent whose Session log receives the root article event.
   * @param request - root title and optional root branch metadata.
   * @returns cloned root branch snapshot at revision 1.
   */
  create(agent: Agent, request: CreateArticleRequest): ArticleSnapshot {
    const cache = this.prepare(agent)
    if (cache.state.article !== undefined) throw new ArticleError('the current session already owns an article branch', 'ARTICLE_ALREADY_EXISTS')
    const title = requiredText(request.title, 'article title')
    const now = Date.now()
    const article: ArticleSnapshot = {
      treeId: ArticleTreeId(`article-tree-${randomUUID()}`),
      branchId: ArticleBranchId(`article-branch-${randomUUID()}`),
      sessionId: agent.session.id,
      branchName: optionalText(request.branchName) ?? '主线',
      explorationIdea: optionalText(request.explorationIdea) ?? '',
      title,
      stage: 'idea',
      revision: 1,
      currentDocuments: {},
      createdAt: now,
      updatedAt: now,
    }
    this.commit(agent, cache, 'create', article)
    return structuredClone(article)
  }

  /**
   * Replace the inherited active branch with a branch-local revision-1 copy.
   * @param agent - live forked Agent whose Session inherited the parent branch events.
   * @param request - child branch id, display name, and starting idea.
   * @returns cloned child branch snapshot at revision 1.
   */
  initializeBranch(agent: Agent, request: InitializeArticleBranchRequest): ArticleSnapshot {
    const cache = this.prepare(agent)
    const parent = this.requireArticle(cache)
    if (agent.session.header.parentSession !== parent.sessionId) {
      throw new ArticleError('the forked session parent does not match the inherited article branch', 'ARTICLE_INVALID_INPUT')
    }
    const branchName = requiredText(request.branchName, 'branch name')
    const explorationIdea = requiredText(request.explorationIdea, 'branch exploration idea')
    const copied: Partial<Record<ArticleDocumentKind, DocumentRevisionIdType>> = {}
    for (const kind of ['material', 'draft', 'review', 'final'] as const) {
      const sourceId = parent.currentDocuments[kind]
      if (sourceId === undefined) continue
      const source = cache.state.documents.get(sourceId)
      if (source === undefined) throw new ArticleError(`inherited document ${sourceId} is unavailable`, 'ARTICLE_DOCUMENT_NOT_FOUND')
      const document: ArticleDocumentRecord = {
        id: DocumentRevisionId(`article-document-${randomUUID()}`),
        treeId: parent.treeId,
        branchId: request.branchId,
        kind,
        markdown: source.markdown,
        source: { kind: 'branch-seed', branchId: parent.branchId, revisionId: source.id },
        createdAt: Date.now(),
      }
      agent.session.append('article/document', document)
      this.sync(agent.session, cache)
      copied[kind] = document.id
    }
    const now = Date.now()
    const originId = currentStageDocument(parent)
    const article: ArticleSnapshot = {
      treeId: parent.treeId,
      branchId: request.branchId,
      sessionId: agent.session.id,
      parentBranchId: parent.branchId,
      parentSessionId: parent.sessionId,
      branchName,
      explorationIdea,
      title: parent.title,
      stage: parent.stage,
      revision: 1,
      forkedFromStage: parent.stage,
      forkedFromArticleRevision: parent.revision,
      ...originId === undefined ? {} : { forkedFromDocumentRevisionId: originId },
      currentDocuments: copied,
      createdAt: now,
      updatedAt: now,
    }
    this.commit(agent, cache, 'branch-initialize', article)
    return structuredClone(article)
  }

  /**
   * Append one immutable document and select it as the current kind.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param request - Markdown, slot, and source metadata to save.
   * @returns cloned branch snapshot after selecting the new document revision.
   */
  saveDocument(agent: Agent, ref: ArticleRef, request: SaveArticleDocumentRequest): ArticleSnapshot {
    const cache = this.prepareMutation(agent, ref)
    const current = this.requireArticle(cache)
    const markdown = requiredMarkdown(request.markdown)
    const now = Date.now()
    const document: ArticleDocumentRecord = {
      id: DocumentRevisionId(`article-document-${randomUUID()}`),
      treeId: current.treeId,
      branchId: current.branchId,
      kind: request.kind,
      markdown,
      source: request.source,
      createdAt: now,
    }
    agent.session.append('article/document', document)
    this.sync(agent.session, cache)
    const currentDocuments = { ...current.currentDocuments, [request.kind]: document.id }
    if (request.kind === 'draft') {
      delete currentDocuments.review
      delete currentDocuments.final
    }
    const article: ArticleSnapshot = {
      ...current,
      stage: request.kind === 'material' ? current.stage : request.kind,
      revision: current.revision + 1,
      currentDocuments,
      updatedAt: now,
    }
    this.commit(agent, cache, 'save-document', article)
    return structuredClone(article)
  }

  /**
   * Move a draft into human review without changing document pointers.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns cloned branch snapshot in review stage.
   */
  submitReview(agent: Agent, ref: ArticleRef): ArticleSnapshot {
    const cache = this.prepareMutation(agent, ref)
    const current = this.requireArticle(cache)
    if (current.stage !== 'draft') throw new ArticleError('only a draft can be submitted for review', 'ARTICLE_INVALID_TRANSITION')
    const article = { ...current, stage: 'review' as const, revision: current.revision + 1, updatedAt: Date.now() }
    this.commit(agent, cache, 'submit-review', article)
    return structuredClone(article)
  }

  /**
   * Return review/final work to its current draft without deleting later revisions.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns cloned branch snapshot in draft stage with review/final pointers cleared.
   */
  requestChanges(agent: Agent, ref: ArticleRef): ArticleSnapshot {
    const cache = this.prepareMutation(agent, ref)
    const current = this.requireArticle(cache)
    if (current.stage !== 'review' && current.stage !== 'final') {
      throw new ArticleError('request changes is available only during review or after a final', 'ARTICLE_INVALID_TRANSITION')
    }
    const draft = current.currentDocuments.draft
    if (draft === undefined) throw new ArticleError('the current branch has no draft to return to', 'ARTICLE_DOCUMENT_NOT_FOUND')
    const article = toDraft(current, draft)
    this.commit(agent, cache, 'request-changes', article)
    return structuredClone(article)
  }

  /**
   * Select one historical draft as current while preserving every later revision.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param revisionId - branch-local draft revision to restore as current.
   * @returns cloned branch snapshot in draft stage with the selected draft revision.
   */
  rollback(agent: Agent, ref: ArticleRef, revisionId: DocumentRevisionIdType): ArticleSnapshot {
    const cache = this.prepareMutation(agent, ref)
    const current = this.requireArticle(cache)
    const target = cache.state.documents.get(revisionId)
    if (target === undefined || target.branchId !== current.branchId || target.kind !== 'draft') {
      throw new ArticleError(`draft revision ${revisionId} was not found in the current branch`, 'ARTICLE_DOCUMENT_NOT_FOUND')
    }
    const article = toDraft(current, revisionId)
    this.commit(agent, cache, 'rollback', article)
    return structuredClone(article)
  }

  /**
   * Update branch-local working-copy metadata without changing content or stage.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param workspace - branch-local Markdown working-copy metadata to persist.
   * @returns cloned branch snapshot with updated workspace metadata.
   */
  updateWorkspace(agent: Agent, ref: ArticleRef, workspace: ArticleWorkspaceSnapshot): ArticleSnapshot {
    const cache = this.prepareMutation(agent, ref)
    const current = this.requireArticle(cache)
    const article = { ...current, revision: current.revision + 1, workspace: structuredClone(workspace), updatedAt: Date.now() }
    this.commit(agent, cache, 'workspace-update', article)
    return structuredClone(article)
  }

  /**
   * Create a durable parent-side branch request.
   * @param agent - live parent Agent whose Session log owns the source branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param input - child display name, starting idea, and initial request status.
   * @returns cloned branch request recorded in the parent Session.
   */
  createBranchRequest(agent: Agent, ref: ArticleRef, input: { branchName: string; explorationIdea: string; status: 'draft' | 'creating' }): ArticleBranchRequest {
    const cache = this.prepareMutation(agent, ref)
    const article = this.requireArticle(cache)
    const now = Date.now()
    const forkedFromDocumentRevisionId = currentStageDocument(article)
    const request: ArticleBranchRequest = {
      id: ArticleBranchRequestId(`article-branch-request-${randomUUID()}`),
      treeId: article.treeId,
      branchId: ArticleBranchId(`article-branch-${randomUUID()}`),
      parentBranchId: article.branchId,
      parentSessionId: article.sessionId,
      branchName: requiredText(input.branchName, 'branch name'),
      explorationIdea: requiredText(input.explorationIdea, 'branch exploration idea'),
      forkedFromStage: article.stage,
      forkedFromArticleRevision: article.revision,
      ...forkedFromDocumentRevisionId === undefined ? {} : { forkedFromDocumentRevisionId },
      status: input.status,
      createdAt: now,
      updatedAt: now,
    }
    this.commitBranchRequest(agent, cache, request)
    return structuredClone(request)
  }

  /**
   * Move an existing branch request through its durable lifecycle.
   * @param agent - live parent Agent whose Session log owns the request.
   * @param requestId - durable branch request id to update.
   * @param update - next lifecycle status and optional child Session or failure detail.
   * @returns cloned updated branch request.
   */
  updateBranchRequest(
    agent: Agent,
    requestId: ArticleBranchRequestIdType,
    update: {
      status: 'creating' | 'ready' | 'failed' | 'cancelled'
      childSessionId?: ArticleBranchRequest['childSessionId']
      error?: string
    },
  ): ArticleBranchRequest {
    const cache = this.prepare(agent)
    const article = this.requireArticle(cache)
    const current = cache.state.branchRequests.get(requestId)
    if (current === undefined || !requestBelongsToArticle(current, article)) {
      throw new ArticleError(`branch request ${requestId} was not found in the current branch`, 'ARTICLE_BRANCH_REQUEST_NOT_FOUND')
    }
    const request: ArticleBranchRequest = {
      id: current.id,
      treeId: current.treeId,
      branchId: current.branchId,
      parentBranchId: current.parentBranchId,
      parentSessionId: current.parentSessionId,
      branchName: current.branchName,
      explorationIdea: current.explorationIdea,
      forkedFromStage: current.forkedFromStage,
      forkedFromArticleRevision: current.forkedFromArticleRevision,
      ...current.forkedFromDocumentRevisionId === undefined ? {} : {
        forkedFromDocumentRevisionId: current.forkedFromDocumentRevisionId,
      },
      status: update.status,
      ...update.childSessionId === undefined
        ? current.childSessionId === undefined ? {} : { childSessionId: current.childSessionId }
        : { childSessionId: update.childSessionId },
      ...update.error === undefined ? {} : { error: update.error },
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    }
    this.commitBranchRequest(agent, cache, request)
    return structuredClone(request)
  }

  /**
   * Append a workflow audit fact.
   * @param agent - live Agent whose Session log owns the branch.
   * @param action - workflow action being audited.
   * @param status - lifecycle state of the workflow action.
   * @param detail - optional human-readable detail such as a target revision or child Session id.
   */
  recordAction(agent: Agent, action: ArticleActionMeta['action'], status: ArticleActionMeta['status'], detail?: string): void {
    const article = this.get(agent)
    if (article === undefined) throw new ArticleError('the current session has no article branch', 'ARTICLE_NOT_FOUND')
    agent.session.append('article/action', {
      kind: 'article/action', version: 1, branchId: article.branchId, action, status,
      ...detail === undefined ? {} : { detail }, time: Date.now(),
    })
  }

  /**
   * Remote current-state read.
   * @param agent - live Agent inferred from the remote request.
   * @returns wire-safe current branch state.
   */
  @Remote('get')
  remoteExportGet(agent: Agent): ArticleReadResult {
    return { article: this.get(agent) ?? null }
  }

  /**
   * Remote branch-local revision list.
   * @param agent - live Agent inferred from the remote request.
   * @param kind - optional document kind filter.
   * @returns wire-safe branch-local revision summaries.
   */
  @Remote('listRevisions')
  remoteExportListRevisions(agent: Agent, kind?: ArticleDocumentKind): ArticleRevisionListResult {
    return { revisions: this.listRevisions(agent, kind) }
  }

  private prepare(agent: Agent): ArticleCache {
    if (this.ctx.agents.get(agent.id) !== agent) throw new ArticleError(`agent ${agent.id} is not live`, 'ARTICLE_AGENT_NOT_LIVE')
    let cache = this.caches.get(agent.session)
    if (cache === undefined) {
      cache = { state: emptyArticleFoldState(), observedSeq: 0 }
      this.caches.set(agent.session, cache)
    }
    this.sync(agent.session, cache)
    return cache
  }

  private prepareMutation(agent: Agent, ref: ArticleRef): ArticleCache {
    const cache = this.prepare(agent)
    const article = this.requireArticle(cache)
    if (article.branchId !== ref.branchId || article.revision !== ref.revision) {
      throw new ArticleError(`stale article revision: expected ${article.branchId}@${String(article.revision)}`, 'ARTICLE_STALE_REVISION')
    }
    return cache
  }

  private requireArticle(cache: ArticleCache): ArticleSnapshot {
    const article = cache.state.article
    if (article === undefined) throw new ArticleError('the current session has no article branch', 'ARTICLE_NOT_FOUND')
    return article
  }

  private sync(session: Session, cache: ArticleCache): void {
    while (cache.observedSeq < session.events.length) {
      const event = session.events[cache.observedSeq]
      if (event === undefined) break
      applyArticleEvent(cache.state, event)
      cache.observedSeq++
    }
  }

  private commit(agent: Agent, cache: ArticleCache, operation: ArticleOperation, article: ArticleSnapshot): void {
    const documentRevisionCount = [...cache.state.documents.values()].filter(document => document.branchId === article.branchId).length
    const change: ArticleChangeMeta = { kind: 'article/change', version: 1, operation, article, documentRevisionCount }
    agent.session.append('article/change', change)
    this.sync(agent.session, cache)
    this.ctx.emit('article/changed', { agent, change: { operation, ref: { branchId: article.branchId, revision: article.revision }, article } })
  }

  private commitBranchRequest(agent: Agent, cache: ArticleCache, request: ArticleBranchRequest): void {
    const change: ArticleBranchChangeMeta = { kind: 'article/branch-change', version: 1, request }
    agent.session.append('article/branch-change', change)
    this.sync(agent.session, cache)
  }
}

function requiredText(value: string, subject: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ArticleError(`${subject} must be non-empty`, 'ARTICLE_INVALID_INPUT')
  return value.trim()
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized === '' ? undefined : normalized
}

function requiredMarkdown(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ArticleError('article markdown must be non-empty', 'ARTICLE_INVALID_INPUT')
  return value.replace(/\r\n?/g, '\n')
}

function currentStageDocument(article: ArticleSnapshot): DocumentRevisionIdType | undefined {
  if (article.stage === 'idea') return article.currentDocuments.material
  return article.currentDocuments[article.stage]
}

function requestBelongsToArticle(request: ArticleBranchRequest, article: ArticleSnapshot): boolean {
  return request.parentBranchId === article.branchId && request.parentSessionId === article.sessionId
}

function toDraft(article: ArticleSnapshot, draft: DocumentRevisionIdType): ArticleSnapshot {
  const currentDocuments = { ...article.currentDocuments, draft }
  delete currentDocuments.review
  delete currentDocuments.final
  return { ...article, stage: 'draft', revision: article.revision + 1, currentDocuments, updatedAt: Date.now() }
}

export default ArticleService
