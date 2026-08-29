/** Browser-safe article-tree identities, requests, snapshots, and projection value. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One related tree of independently editable article branches. */
export type ArticleTreeId = Branded<'ArticleTreeId'>
/** One independently editable article line backed by one Session. */
export type ArticleBranchId = Branded<'ArticleBranchId'>
/** One immutable Markdown document revision. */
export type DocumentRevisionId = Branded<'DocumentRevisionId'>
/** One durable request to create a child article branch. */
export type ArticleBranchRequestId = Branded<'ArticleBranchRequestId'>

/** Compare-and-set identity of an exact article-branch revision. */
export interface ArticleRef {
  readonly branchId: ArticleBranchId
  readonly revision: number
}

/** Ordered writing stages owned independently by every branch. */
export type ArticleStage = 'idea' | 'draft' | 'review' | 'final'
/** Markdown artifacts available to an article branch. */
export type ArticleDocumentKind = 'material' | 'draft' | 'review' | 'final'

/** Source facts displayed for one immutable document revision. */
export type ArticleDocumentSource =
  | { readonly kind: 'agent' }
  | { readonly kind: 'human-file' }
  | { readonly kind: 'plugin' }
  | { readonly kind: 'branch-seed'; readonly branchId: ArticleBranchId; readonly revisionId: DocumentRevisionId }

/** Metadata for one immutable document revision; Markdown stays host-side. */
export interface ArticleDocumentSummary {
  readonly id: DocumentRevisionId
  readonly branchId: ArticleBranchId
  readonly kind: ArticleDocumentKind
  readonly source: ArticleDocumentSource
  readonly createdAt: number
}

/** Last materialized state of one editable Markdown file. */
export interface ArticleWorkspaceFile {
  readonly kind: ArticleDocumentKind
  readonly path: string
  readonly baseRevisionId?: DocumentRevisionId
  readonly digest: string
}

/** Branch-local working-copy directory and files. */
export interface ArticleWorkspaceSnapshot {
  readonly directory: string
  readonly files: Partial<Record<ArticleDocumentKind, ArticleWorkspaceFile>>
  readonly updatedAt: number
}

/** Whole current state of one independently editable article line. */
export interface ArticleSnapshot extends ArticleRef {
  readonly treeId: ArticleTreeId
  readonly sessionId: SessionId
  readonly parentBranchId?: ArticleBranchId
  readonly parentSessionId?: SessionId
  readonly branchName: string
  readonly explorationIdea: string
  readonly title: string
  readonly stage: ArticleStage
  readonly forkedFromStage?: ArticleStage
  readonly forkedFromArticleRevision?: number
  readonly forkedFromDocumentRevisionId?: DocumentRevisionId
  readonly currentDocuments: Partial<Record<ArticleDocumentKind, DocumentRevisionId>>
  readonly workspace?: ArticleWorkspaceSnapshot
  readonly createdAt: number
  readonly updatedAt: number
}

/** Durable lifecycle of one requested child branch. */
export type ArticleBranchRequestStatus = 'draft' | 'creating' | 'ready' | 'failed' | 'cancelled'

/** Current whole value for one child-branch request owned by its parent branch. */
export interface ArticleBranchRequest {
  readonly id: ArticleBranchRequestId
  readonly treeId: ArticleTreeId
  readonly branchId: ArticleBranchId
  readonly parentBranchId: ArticleBranchId
  readonly parentSessionId: SessionId
  readonly branchName: string
  readonly explorationIdea: string
  readonly forkedFromStage: ArticleStage
  readonly forkedFromArticleRevision: number
  readonly forkedFromDocumentRevisionId?: DocumentRevisionId
  readonly status: ArticleBranchRequestStatus
  readonly childSessionId?: SessionId
  readonly error?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Client projection for the current branch and its latest branch request. */
export interface ArticleProjection {
  readonly article: ArticleSnapshot
  readonly documentRevisionCount: number
  readonly latestBranchRequest?: ArticleBranchRequest
}

/** Create the root branch in the current Session. */
export interface CreateArticleRequest {
  readonly title: string
  readonly branchName?: string
  readonly explorationIdea?: string
}

/** Input for a model, human, or plugin document save. */
export interface SaveArticleDocumentRequest {
  readonly kind: ArticleDocumentKind
  readonly markdown: string
  readonly source: Extract<ArticleDocumentSource, { kind: 'agent' | 'human-file' | 'plugin' }>
}

/** Wire-safe result of a successful article mutation. */
export interface ArticleMutationResult {
  readonly ref: ArticleRef
}

/** Wire-safe current article read. */
export interface ArticleReadResult {
  readonly article: ArticleSnapshot | null
}

/** Wire-safe list of immutable branch-local document revisions. */
export interface ArticleRevisionListResult {
  readonly revisions: ArticleDocumentSummary[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Current independent article branch, or null before article creation. */
    article: ArticleProjection | null
  }
}
