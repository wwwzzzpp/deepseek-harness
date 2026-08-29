import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ArticleBranchId,
  ArticleBranchRequestId,
  ArticleTreeId,
  DocumentRevisionId,
  foldArticle,
  type ArticleBranchRequest,
  type ArticleDocumentRecord,
  type ArticleOperation,
  type ArticleSnapshot,
} from '@deepseek-ai/dsh-article'

const TREE = ArticleTreeId('tree-1')
const ROOT_BRANCH = ArticleBranchId('branch-main')
const CHILD_BRANCH = ArticleBranchId('branch-child')
const ROOT_SESSION = SessionId('session-root')
const CHILD_SESSION = SessionId('session-child')
const DRAFT_1 = DocumentRevisionId('draft-1')
const DRAFT_2 = DocumentRevisionId('draft-2')
const FINAL_1 = DocumentRevisionId('final-1')
const CHILD_DRAFT_1 = DocumentRevisionId('child-draft-1')
const REQUEST = ArticleBranchRequestId('request-1')
const NOW = 1_000

describe('article fold', () => {
  it('replays one root branch through draft, review, final, and draft rollback', () => {
    const root = article({ revision: 1, stage: 'idea', currentDocuments: {} })
    const draftDoc = document({ id: DRAFT_1, branchId: ROOT_BRANCH, kind: 'draft', markdown: '# Draft' })
    const draft = article({ revision: 2, stage: 'draft', currentDocuments: { draft: DRAFT_1 } })
    const review = article({ revision: 3, stage: 'review', currentDocuments: { draft: DRAFT_1 } })
    const finalDoc = document({ id: FINAL_1, branchId: ROOT_BRANCH, kind: 'final', markdown: '# Final' })
    const final = article({ revision: 4, stage: 'final', currentDocuments: { draft: DRAFT_1, final: FINAL_1 } })
    const rollback = article({ revision: 5, stage: 'draft', currentDocuments: { draft: DRAFT_1 } })

    const state = foldArticle([
      change(1, 'create', root, 0),
      event(2, 'article/document', draftDoc),
      change(3, 'save-document', draft, 1),
      change(4, 'submit-review', review, 1),
      event(5, 'article/document', finalDoc),
      change(6, 'save-document', final, 2),
      change(7, 'rollback', rollback, 2),
    ])

    expect(state.article).toMatchObject({ branchId: ROOT_BRANCH, stage: 'draft', revision: 5 })
    expect(state.article?.currentDocuments).toEqual({ draft: DRAFT_1 })
    expect(state.documents.get(FINAL_1)?.markdown).toBe('# Final')
  })

  it('replays recoverable branch-request state without creating a merge path', () => {
    const root = article({ revision: 1, stage: 'idea', currentDocuments: {} })
    const draftDoc = document({ id: DRAFT_1, branchId: ROOT_BRANCH, kind: 'draft', markdown: '# Draft' })
    const draft = article({ revision: 2, stage: 'draft', currentDocuments: { draft: DRAFT_1 } })
    const request = branchRequest({ status: 'draft' })
    const creating = branchRequest({ status: 'creating' })
    const ready = branchRequest({ status: 'ready', childSessionId: CHILD_SESSION })

    const state = foldArticle([
      change(1, 'create', root, 0),
      event(2, 'article/document', draftDoc),
      change(3, 'save-document', draft, 1),
      branchChange(4, request),
      branchChange(5, creating),
      branchChange(6, ready),
    ])

    expect(state.branchRequests.get(REQUEST)?.status).toBe('ready')
    expect(state.article).toMatchObject({ branchId: ROOT_BRANCH, revision: 2 })
  })

  it('initializes a forked child branch from branch-seed documents only inside the child branch', () => {
    const root = article({ revision: 1, stage: 'idea', currentDocuments: {} })
    const draftDoc = document({ id: DRAFT_1, branchId: ROOT_BRANCH, kind: 'draft', markdown: '# Parent draft' })
    const parentDraft = article({ revision: 2, stage: 'draft', currentDocuments: { draft: DRAFT_1 } })
    const seedDoc = document({
      id: CHILD_DRAFT_1,
      branchId: CHILD_BRANCH,
      kind: 'draft',
      markdown: '# Parent draft',
      source: { kind: 'branch-seed', branchId: ROOT_BRANCH, revisionId: DRAFT_1 },
    })
    const child = article({
      branchId: CHILD_BRANCH,
      sessionId: CHILD_SESSION,
      parentBranchId: ROOT_BRANCH,
      parentSessionId: ROOT_SESSION,
      branchName: 'child',
      explorationIdea: 'go deeper',
      revision: 1,
      stage: 'draft',
      currentDocuments: { draft: CHILD_DRAFT_1 },
      forkedFromStage: 'draft',
      forkedFromArticleRevision: 2,
      forkedFromDocumentRevisionId: DRAFT_1,
    })

    const state = foldArticle([
      change(1, 'create', root, 0),
      event(2, 'article/document', draftDoc),
      change(3, 'save-document', parentDraft, 1),
      event(4, 'article/document', seedDoc),
      change(5, 'branch-initialize', child, 1),
    ])

    expect(state.article).toMatchObject({
      branchId: CHILD_BRANCH,
      parentBranchId: ROOT_BRANCH,
      revision: 1,
      currentDocuments: { draft: CHILD_DRAFT_1 },
    })
    expect(state.documents.get(DRAFT_1)?.branchId).toBe(ROOT_BRANCH)
    expect(state.documents.get(CHILD_DRAFT_1)?.branchId).toBe(CHILD_BRANCH)
  })

  it('replays request-changes and a second review round without losing any draft revision', () => {
    const root = article({ revision: 1, stage: 'idea', currentDocuments: {} })
    const draft1Doc = document({ id: DRAFT_1, branchId: ROOT_BRANCH, kind: 'draft', markdown: '# Draft v1' })
    const draft1 = article({ revision: 2, stage: 'draft', currentDocuments: { draft: DRAFT_1 } })
    const review1 = article({ revision: 3, stage: 'review', currentDocuments: { draft: DRAFT_1 } })
    const backToDraft = article({ revision: 4, stage: 'draft', currentDocuments: { draft: DRAFT_1 } })
    const draft2Doc = document({ id: DRAFT_2, branchId: ROOT_BRANCH, kind: 'draft', markdown: '# Draft v2' })
    const draft2 = article({ revision: 5, stage: 'draft', currentDocuments: { draft: DRAFT_2 } })
    const review2 = article({ revision: 6, stage: 'review', currentDocuments: { draft: DRAFT_2 } })

    const state = foldArticle([
      change(1, 'create', root, 0),
      event(2, 'article/document', draft1Doc),
      change(3, 'save-document', draft1, 1),
      change(4, 'submit-review', review1, 1),
      change(5, 'request-changes', backToDraft, 1),
      event(6, 'article/document', draft2Doc),
      change(7, 'save-document', draft2, 2),
      change(8, 'submit-review', review2, 2),
    ])

    expect(state.article).toMatchObject({ branchId: ROOT_BRANCH, stage: 'review', revision: 6 })
    expect(state.article?.currentDocuments).toEqual({ draft: DRAFT_2 })
    expect(state.documents.get(DRAFT_1)?.markdown).toBe('# Draft v1')
    expect(state.documents.get(DRAFT_2)?.markdown).toBe('# Draft v2')
  })

  it('rejects ready branch requests that lost their child Session id', () => {
    const root = article({ revision: 1, stage: 'idea', currentDocuments: {} })
    const request = branchRequest({ status: 'creating' })
    const ready = branchRequest({ status: 'ready' })

    expect(() => foldArticle([
      change(1, 'create', root, 0),
      branchChange(2, request),
      branchChange(3, ready),
    ])).toThrow('ready branch request requires childSessionId')
  })
})

function article(input: Partial<ArticleSnapshot> & Pick<ArticleSnapshot, 'revision' | 'stage' | 'currentDocuments'>): ArticleSnapshot {
  return {
    treeId: TREE,
    branchId: ROOT_BRANCH,
    sessionId: ROOT_SESSION,
    branchName: 'main',
    explorationIdea: '',
    title: 'Title',
    createdAt: NOW,
    updatedAt: NOW + input.revision,
    ...input,
  }
}

function document(input: Omit<ArticleDocumentRecord, 'treeId' | 'source' | 'createdAt'> & Partial<Pick<ArticleDocumentRecord, 'source'>>): ArticleDocumentRecord {
  return {
    treeId: TREE,
    source: { kind: 'agent' },
    createdAt: NOW,
    ...input,
  }
}

function branchRequest(input: Pick<ArticleBranchRequest, 'status'> & Partial<ArticleBranchRequest>): ArticleBranchRequest {
  return {
    id: REQUEST,
    treeId: TREE,
    branchId: CHILD_BRANCH,
    parentBranchId: ROOT_BRANCH,
    parentSessionId: ROOT_SESSION,
    branchName: 'child',
    explorationIdea: 'go deeper',
    forkedFromStage: 'draft',
    forkedFromArticleRevision: 2,
    forkedFromDocumentRevisionId: DRAFT_1,
    createdAt: NOW,
    updatedAt: NOW + 1,
    ...input,
  }
}

function change(seq: number, operation: ArticleOperation, snapshot: ArticleSnapshot, documentRevisionCount: number): SessionEvent<'article/change'> {
  return event(seq, 'article/change', {
    kind: 'article/change',
    version: 1,
    operation,
    article: snapshot,
    documentRevisionCount,
  })
}

function branchChange(seq: number, request: ArticleBranchRequest): SessionEvent<'article/branch-change'> {
  return event(seq, 'article/branch-change', {
    kind: 'article/branch-change',
    version: 1,
    request,
  })
}

function event<T extends SessionEventType>(seq: number, type: T, data: SessionEvent<T>['data']): SessionEvent<T> {
  return { seq, time: NOW + seq, type, data } as SessionEvent<T>
}
