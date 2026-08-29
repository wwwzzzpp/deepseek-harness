/** Strict replay and lightweight projection folds for durable article events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ArticleActionMeta,
  ArticleBranchChangeMeta,
  ArticleChangeMeta,
  ArticleDocumentRecord,
  ArticleOperation,
} from './domain.ts'
import type {
  ArticleBranchRequest,
  ArticleDocumentKind,
  ArticleProjection,
  ArticleSnapshot,
  DocumentRevisionId,
} from './types.ts'

/** Mutable state used only while strictly replaying one Session log. */
export interface ArticleFoldState {
  article: ArticleSnapshot | undefined
  readonly documents: Map<DocumentRevisionId, ArticleDocumentRecord>
  readonly branchRequests: Map<string, ArticleBranchRequest>
  lastDocument: ArticleDocumentRecord | undefined
  documentRevisionCount: number
}

/**
 * Construct an empty article fold.
 * @returns mutable replay state with no article branch and no document revisions.
 */
export function emptyArticleFoldState(): ArticleFoldState {
  return {
    article: undefined,
    documents: new Map(),
    branchRequests: new Map(),
    lastDocument: undefined,
    documentRevisionCount: 0,
  }
}

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${subject} must be a non-empty string`)
  return value
}

function integer(value: unknown, subject: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${subject} must be a safe integer >= ${String(minimum)}`)
  }
  return value as number
}

const STAGES = new Set(['idea', 'draft', 'review', 'final'])
const KINDS = new Set(['material', 'draft', 'review', 'final'])
const REQUEST_STATUSES = new Set(['draft', 'creating', 'ready', 'failed', 'cancelled'])

/**
 * Decode and validate one immutable document event.
 * @param value - durable event data to decode.
 * @returns validated document revision payload.
 */
export function decodeArticleDocument(value: unknown): ArticleDocumentRecord {
  const candidate = record(value, 'article document')
  text(candidate['id'], 'article document id')
  text(candidate['treeId'], 'article document treeId')
  text(candidate['branchId'], 'article document branchId')
  if (!KINDS.has(String(candidate['kind']))) throw new Error('article document kind is invalid')
  if (typeof candidate['markdown'] !== 'string') throw new Error('article document markdown must be a string')
  integer(candidate['createdAt'], 'article document createdAt')
  const source = record(candidate['source'], 'article document source')
  if (!['agent', 'human-file', 'plugin', 'branch-seed'].includes(String(source['kind']))) {
    throw new Error('article document source is invalid')
  }
  if (source['kind'] === 'branch-seed') {
    text(source['branchId'], 'branch-seed branchId')
    text(source['revisionId'], 'branch-seed revisionId')
  }
  return candidate as unknown as ArticleDocumentRecord
}

function decodeWorkspace(value: unknown): void {
  if (value === undefined) return
  const workspace = record(value, 'article workspace')
  text(workspace['directory'], 'article workspace directory')
  integer(workspace['updatedAt'], 'article workspace updatedAt')
  const files = record(workspace['files'], 'article workspace files')
  for (const [kind, raw] of Object.entries(files)) {
    if (!KINDS.has(kind)) throw new Error(`article workspace file kind ${JSON.stringify(kind)} is invalid`)
    const file = record(raw, 'article workspace file')
    if (file['kind'] !== kind) throw new Error(`article workspace file ${kind} carries a different kind`)
    text(file['path'], 'article workspace file path')
    if (file['baseRevisionId'] !== undefined) text(file['baseRevisionId'], 'article workspace baseRevisionId')
    if (typeof file['digest'] !== 'string') throw new Error('article workspace digest must be a string')
  }
}

/**
 * Decode and validate the complete current-article change payload.
 * @param value - durable event data to decode.
 * @returns validated current-branch change payload.
 */
export function decodeArticleChange(value: unknown): ArticleChangeMeta {
  const candidate = record(value, 'article change')
  if (candidate['kind'] !== 'article/change' || candidate['version'] !== 1) {
    throw new Error('article change kind/version is unsupported')
  }
  const operations = new Set<ArticleOperation>([
    'create', 'branch-initialize', 'save-document', 'submit-review',
    'request-changes', 'rollback', 'workspace-update',
  ])
  if (!operations.has(candidate['operation'] as ArticleOperation)) throw new Error('article change operation is invalid')
  integer(candidate['documentRevisionCount'], 'article documentRevisionCount')
  const article = record(candidate['article'], 'article snapshot')
  text(article['treeId'], 'article treeId')
  text(article['branchId'], 'article branchId')
  text(article['sessionId'], 'article sessionId')
  text(article['branchName'], 'article branchName')
  if (typeof article['explorationIdea'] !== 'string') throw new Error('article explorationIdea must be a string')
  text(article['title'], 'article title')
  if (!STAGES.has(String(article['stage']))) throw new Error('article stage is invalid')
  integer(article['revision'], 'article revision', 1)
  integer(article['createdAt'], 'article createdAt')
  integer(article['updatedAt'], 'article updatedAt')
  if (article['parentBranchId'] !== undefined) text(article['parentBranchId'], 'article parentBranchId')
  if (article['parentSessionId'] !== undefined) text(article['parentSessionId'], 'article parentSessionId')
  const forkedFromStage = article['forkedFromStage']
  if (forkedFromStage !== undefined && (typeof forkedFromStage !== 'string' || !STAGES.has(forkedFromStage))) {
    throw new Error('article forkedFromStage is invalid')
  }
  if (article['forkedFromArticleRevision'] !== undefined) {
    integer(article['forkedFromArticleRevision'], 'article forkedFromArticleRevision', 1)
  }
  if (article['forkedFromDocumentRevisionId'] !== undefined) {
    text(article['forkedFromDocumentRevisionId'], 'article forkedFromDocumentRevisionId')
  }
  const current = record(article['currentDocuments'], 'article currentDocuments')
  for (const [kind, id] of Object.entries(current)) {
    if (!KINDS.has(kind)) throw new Error(`article current document kind ${JSON.stringify(kind)} is invalid`)
    text(id, `article current ${kind} revision`)
  }
  decodeWorkspace(article['workspace'])
  return candidate as unknown as ArticleChangeMeta
}

/**
 * Decode and validate a whole branch-request change.
 * @param value - durable event data to decode.
 * @returns validated child-branch request payload.
 */
export function decodeArticleBranchChange(value: unknown): ArticleBranchChangeMeta {
  const candidate = record(value, 'article branch change')
  if (candidate['kind'] !== 'article/branch-change' || candidate['version'] !== 1) {
    throw new Error('article branch change kind/version is unsupported')
  }
  const request = record(candidate['request'], 'article branch request')
  for (const key of ['id', 'treeId', 'branchId', 'parentBranchId', 'parentSessionId', 'branchName', 'explorationIdea']) {
    text(request[key], `article branch request ${key}`)
  }
  if (!STAGES.has(String(request['forkedFromStage']))) throw new Error('article branch request stage is invalid')
  integer(request['forkedFromArticleRevision'], 'article branch request revision', 1)
  if (request['forkedFromDocumentRevisionId'] !== undefined) {
    text(request['forkedFromDocumentRevisionId'], 'article branch request document revision')
  }
  if (!REQUEST_STATUSES.has(String(request['status']))) throw new Error('article branch request status is invalid')
  if (request['childSessionId'] !== undefined) text(request['childSessionId'], 'article branch request childSessionId')
  if (request['error'] !== undefined && typeof request['error'] !== 'string') throw new Error('article branch request error must be a string')
  integer(request['createdAt'], 'article branch request createdAt')
  integer(request['updatedAt'], 'article branch request updatedAt')
  return candidate as unknown as ArticleBranchChangeMeta
}

/**
 * Decode and validate an action audit event.
 * @param value - durable event data to decode.
 * @returns validated workflow action payload.
 */
export function decodeArticleAction(value: unknown): ArticleActionMeta {
  const candidate = record(value, 'article action')
  if (candidate['kind'] !== 'article/action' || candidate['version'] !== 1) throw new Error('article action kind/version is unsupported')
  text(candidate['branchId'], 'article action branchId')
  if (!['next', 'approve', 'request-changes', 'rollback', 'create-branch'].includes(String(candidate['action']))) {
    throw new Error('article action is invalid')
  }
  if (!['requested', 'completed', 'failed'].includes(String(candidate['status']))) throw new Error('article action status is invalid')
  if (candidate['detail'] !== undefined && typeof candidate['detail'] !== 'string') throw new Error('article action detail must be a string')
  integer(candidate['time'], 'article action time')
  return candidate as unknown as ArticleActionMeta
}

function sameDocuments(a: ArticleSnapshot, b: ArticleSnapshot): boolean {
  return JSON.stringify(a.currentDocuments) === JSON.stringify(b.currentDocuments)
}

function expectedStage(kind: ArticleDocumentKind, previous: ArticleSnapshot['stage']): ArticleSnapshot['stage'] {
  if (kind === 'material') return previous
  return kind
}

function validateTransition(
  previous: ArticleSnapshot,
  next: ArticleSnapshot,
  operation: ArticleOperation,
  lastDocument: ArticleDocumentRecord | undefined,
): void {
  if (next.treeId !== previous.treeId) throw new Error('article treeId cannot change within one branch')
  if (next.branchId !== previous.branchId) throw new Error('article branchId may change only through branch-initialize')
  if (next.revision !== previous.revision + 1) throw new Error('article revision must increment by one')
  if (next.createdAt !== previous.createdAt) throw new Error('article createdAt cannot change')
  if (next.updatedAt < previous.updatedAt) throw new Error('article updatedAt cannot move backward')
  if (operation === 'save-document') {
    if (lastDocument === undefined || lastDocument.branchId !== next.branchId) throw new Error('save-document must follow a document for the current branch')
    if (next.currentDocuments[lastDocument.kind] !== lastDocument.id) throw new Error('save-document must select the newly appended revision')
    if (next.stage !== expectedStage(lastDocument.kind, previous.stage)) throw new Error('save-document selected an invalid stage')
    if (lastDocument.kind === 'draft' && (next.currentDocuments.review !== undefined || next.currentDocuments.final !== undefined)) {
      throw new Error('saving a draft must clear review and final pointers')
    }
    return
  }
  if (operation === 'submit-review') {
    if (previous.stage !== 'draft' || next.stage !== 'review' || !sameDocuments(previous, next)) {
      throw new Error('submit-review requires draft -> review without changing documents')
    }
    return
  }
  if (operation === 'request-changes' || operation === 'rollback') {
    if (previous.stage === 'idea' || next.stage !== 'draft' || next.currentDocuments.draft === undefined
      || next.currentDocuments.review !== undefined || next.currentDocuments.final !== undefined) {
      throw new Error(`${operation} requires a selected draft and clears later-stage pointers`)
    }
    return
  }
  if (operation === 'workspace-update') {
    if (next.stage !== previous.stage || !sameDocuments(previous, next)) throw new Error('workspace-update cannot change article content or stage')
    return
  }
  throw new Error(`operation ${operation} is invalid for an existing branch`)
}

function validateCurrentDocuments(state: ArticleFoldState, article: ArticleSnapshot): void {
  for (const [kind, id] of Object.entries(article.currentDocuments) as [ArticleDocumentKind, DocumentRevisionId][]) {
    const document = state.documents.get(id)
    if (document === undefined) throw new Error(`article references unknown document ${id}`)
    if (document.branchId !== article.branchId || document.treeId !== article.treeId || document.kind !== kind) {
      throw new Error(`article document ${id} does not belong to the current ${kind} slot`)
    }
  }
}

function applyArticleChange(state: ArticleFoldState, change: ArticleChangeMeta): void {
  const next = change.article
  validateCurrentDocuments(state, next)
  const actualCount = [...state.documents.values()].filter(document => document.branchId === next.branchId).length
  if (change.documentRevisionCount !== actualCount) throw new Error('article documentRevisionCount does not match the durable documents')
  const previous = state.article
  if (change.operation === 'create') {
    if (previous !== undefined || next.revision !== 1 || next.parentBranchId !== undefined || next.parentSessionId !== undefined) {
      throw new Error('article create requires a root revision 1 without existing state or parent lineage')
    }
  } else if (change.operation === 'branch-initialize') {
    if (previous === undefined || next.revision !== 1 || next.treeId !== previous.treeId
      || next.parentBranchId !== previous.branchId || next.parentSessionId !== previous.sessionId
      || next.branchId === previous.branchId) {
      throw new Error('branch-initialize requires a new revision 1 child of the inherited current branch')
    }
  } else {
    if (previous === undefined) throw new Error(`${change.operation} requires an existing article`)
    validateTransition(previous, next, change.operation, state.lastDocument)
  }
  state.article = next
  state.documentRevisionCount = actualCount
  state.lastDocument = undefined
}

function sameRequestIdentity(a: ArticleBranchRequest, b: ArticleBranchRequest): boolean {
  return a.id === b.id && a.treeId === b.treeId && a.branchId === b.branchId
    && a.parentBranchId === b.parentBranchId && a.parentSessionId === b.parentSessionId
    && a.branchName === b.branchName && a.explorationIdea === b.explorationIdea
    && a.forkedFromStage === b.forkedFromStage
    && a.forkedFromArticleRevision === b.forkedFromArticleRevision
    && a.forkedFromDocumentRevisionId === b.forkedFromDocumentRevisionId
    && a.createdAt === b.createdAt
}

function applyBranchChange(state: ArticleFoldState, change: ArticleBranchChangeMeta): void {
  const request = change.request
  const article = state.article
  if (article === undefined || article.treeId !== request.treeId || article.branchId !== request.parentBranchId
    || article.sessionId !== request.parentSessionId) {
    throw new Error('article branch request does not belong to the current parent branch')
  }
  const previous = state.branchRequests.get(request.id)
  if (previous === undefined) {
    if (request.status !== 'draft' && request.status !== 'creating') throw new Error('new branch request must start as draft or creating')
  } else {
    if (!sameRequestIdentity(previous, request)) throw new Error('branch request identity fields are immutable')
    const allowed: Record<ArticleBranchRequest['status'], readonly ArticleBranchRequest['status'][]> = {
      draft: ['creating', 'cancelled'],
      creating: ['ready', 'failed'],
      failed: ['creating', 'cancelled'],
      ready: [],
      cancelled: [],
    }
    if (!allowed[previous.status].includes(request.status)) {
      throw new Error(`branch request cannot move from ${previous.status} to ${request.status}`)
    }
    if (request.updatedAt < previous.updatedAt) throw new Error('branch request updatedAt cannot move backward')
  }
  if (request.status === 'ready' && request.childSessionId === undefined) throw new Error('ready branch request requires childSessionId')
  if (request.status === 'failed' && (request.error === undefined || request.error.length === 0)) throw new Error('failed branch request requires error')
  state.branchRequests.set(request.id, request)
}

/**
 * Apply one event to the strict article replay state.
 * @param state - mutable replay state for one Session log.
 * @param event - next event from the Session log.
 */
export function applyArticleEvent(state: ArticleFoldState, event: SessionEvent): void {
  if (event.type === 'article/document') {
    const document = decodeArticleDocument(event.data)
    if (state.documents.has(document.id)) throw new Error(`duplicate article document id ${document.id}`)
    state.documents.set(document.id, document)
    state.lastDocument = document
    return
  }
  if (event.type === 'article/change') {
    applyArticleChange(state, decodeArticleChange(event.data))
    return
  }
  if (event.type === 'article/branch-change') {
    applyBranchChange(state, decodeArticleBranchChange(event.data))
    return
  }
  if (event.type === 'article/action') decodeArticleAction(event.data)
}

/**
 * Replay one complete Session log into article state.
 * @param events - ordered Session events to replay.
 * @returns strict replay state after all article events have been applied.
 */
export function foldArticle(events: readonly SessionEvent[]): ArticleFoldState {
  const state = emptyArticleFoldState()
  for (const event of events) applyArticleEvent(state, event)
  return state
}

/**
 * Fold one Session event into the lightweight browser projection.
 * @param state - previous projection value, or null before article creation.
 * @param event - next Session event to consider.
 * @returns updated projection value, or the previous value when the event is not accepted.
 */
export function applyArticleProjection(state: ArticleProjection | null, event: SessionEvent): ArticleProjection | null {
  if (event.type === 'article/change') {
    let change: ArticleChangeMeta
    try { change = decodeArticleChange(event.data) } catch { return state }
    const retainedRequest = state?.latestBranchRequest?.parentBranchId === change.article.branchId
      ? state.latestBranchRequest
      : undefined
    return {
      article: change.article,
      documentRevisionCount: change.documentRevisionCount,
      ...retainedRequest === undefined ? {} : { latestBranchRequest: retainedRequest },
    }
  }
  if (event.type === 'article/branch-change' && state !== null) {
    let change: ArticleBranchChangeMeta
    try { change = decodeArticleBranchChange(event.data) } catch { return state }
    if (change.request.parentBranchId !== state.article.branchId) return state
    return { ...state, latestBranchRequest: change.request }
  }
  return state
}
