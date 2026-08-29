/**
 * Article dock injected face. Live state arrives through `useProjection('article')`;
 * injected callbacks perform human-controlled article actions.
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ArticleBranchRequestId,
  ArticleDocumentKind,
  ArticleRevisionListResult,
  DocumentRevisionId,
} from '@deepseek-ai/dsh-article/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Settled outcome of one article action. */
export type ArticleActionResult = RemoteResult<unknown>

/** Settled outcome of listing rollback candidates. */
export type ArticleRevisionListActionResult = RemoteResult<ArticleRevisionListResult>

/** Injected business face for the article dock entry. */
export interface ArticleDockActions {
  /**
   * Create a root article branch in the current Session.
   * @param title - article title.
   * @param branchName - root branch label.
   */
  onCreate: (title: string, branchName: string) => Promise<ArticleActionResult>
  /** Advance to the next human-controlled article stage. */
  onNext: () => Promise<ArticleActionResult>
  /** Approve the reviewed branch and request the final document. */
  onApproveFinal: () => Promise<ArticleActionResult>
  /**
   * Open one current Markdown working-copy file.
   * @param kind - document kind to open.
   */
  onOpenDocument: (kind: ArticleDocumentKind) => Promise<ArticleActionResult>
  /**
   * Import one externally edited Markdown file as a new branch-local revision.
   * @param kind - document kind to synchronize.
   */
  onSynchronize: (kind: ArticleDocumentKind) => Promise<ArticleActionResult>
  /** Return review/final to the current draft. */
  onRequestChanges: () => Promise<ArticleActionResult>
  /** List branch-local draft revisions. */
  onListDraftRevisions: () => Promise<ArticleRevisionListActionResult>
  /**
   * Select one historical branch-local draft revision.
   * @param revisionId - immutable draft revision id.
   */
  onRollback: (revisionId: DocumentRevisionId) => Promise<ArticleActionResult>
  /**
   * Save or create one independent child article branch.
   * @param branchName - child branch name.
   * @param explorationIdea - first branch message.
   */
  onCreateBranch: (branchName: string, explorationIdea: string) => Promise<ArticleActionResult>
  /**
   * Create one saved mid-turn branch request.
   * @param requestId - saved branch request id.
   */
  onConfirmBranch: (requestId: ArticleBranchRequestId) => Promise<ArticleActionResult>
  /**
   * Retry a failed branch initialization.
   * @param requestId - failed branch request id.
   */
  onRetryBranch: (requestId: ArticleBranchRequestId) => Promise<ArticleActionResult>
  /**
   * Cancel the article association request without deleting any child Session.
   * @param requestId - request to cancel.
   */
  onCancelBranch: (requestId: ArticleBranchRequestId) => Promise<ArticleActionResult>
  /**
   * Open another Harness Session in the same window.
   * @param sessionId - target Session id.
   */
  onOpenSession: (sessionId: SessionId) => Promise<ArticleActionResult>
}
