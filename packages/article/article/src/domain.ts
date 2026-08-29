/** Host-side durable article event and error vocabulary. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ArticleBranchId,
  ArticleBranchRequest,
  ArticleDocumentKind,
  ArticleDocumentSource,
  ArticleRef,
  ArticleSnapshot,
  ArticleTreeId,
  DocumentRevisionId,
} from './types.ts'

/** Immutable Markdown content written once to one Session log. */
export interface ArticleDocumentRecord {
  readonly id: DocumentRevisionId
  readonly treeId: ArticleTreeId
  readonly branchId: ArticleBranchId
  readonly kind: ArticleDocumentKind
  readonly markdown: string
  readonly source: ArticleDocumentSource
  readonly createdAt: number
}

/** State-changing article operations. */
export type ArticleOperation =
  | 'create'
  | 'branch-initialize'
  | 'save-document'
  | 'submit-review'
  | 'request-changes'
  | 'rollback'
  | 'workspace-update'

/** Complete post-mutation current article branch. */
export interface ArticleChangeMeta {
  readonly kind: 'article/change'
  readonly version: 1
  readonly operation: ArticleOperation
  readonly article: ArticleSnapshot
  readonly documentRevisionCount: number
}

/** Complete current value for one child-branch request. */
export interface ArticleBranchChangeMeta {
  readonly kind: 'article/branch-change'
  readonly version: 1
  readonly request: ArticleBranchRequest
}

/** Audit fact for a user- or controller-initiated workflow action. */
export interface ArticleActionMeta {
  readonly kind: 'article/action'
  readonly version: 1
  readonly branchId: ArticleBranchId
  readonly action: 'next' | 'approve' | 'request-changes' | 'rollback' | 'create-branch'
  readonly status: 'requested' | 'completed' | 'failed'
  readonly detail?: string
  readonly time: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One immutable Markdown revision. */
    'article/document': ArticleDocumentRecord
    /** Complete current article state after one accepted mutation. */
    'article/change': ArticleChangeMeta
    /** Complete current state of one branch-creation request. */
    'article/branch-change': ArticleBranchChangeMeta
    /** Workflow action audit fact. */
    'article/action': ArticleActionMeta
  }
}

/** Stable rejection codes for article-domain operations. */
export type ArticleErrorCode =
  | 'ARTICLE_AGENT_NOT_LIVE'
  | 'ARTICLE_NOT_FOUND'
  | 'ARTICLE_ALREADY_EXISTS'
  | 'ARTICLE_STALE_REVISION'
  | 'ARTICLE_INVALID_INPUT'
  | 'ARTICLE_INVALID_TRANSITION'
  | 'ARTICLE_DOCUMENT_NOT_FOUND'
  | 'ARTICLE_BRANCH_REQUEST_NOT_FOUND'

/** Live notification after one durable article mutation commits. */
export interface ArticleChanged {
  readonly operation: ArticleOperation
  readonly ref: ArticleRef
  readonly article: ArticleSnapshot
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Article mutation accepted for one live Agent after its Session event committed.
     * @param payload.agent - Agent whose Session owns the branch.
     * @param payload.change - committed current article value.
     * @mode emit
     */
    'article/changed'(payload: { agent: Agent; change: ArticleChanged }): void
  }
}
