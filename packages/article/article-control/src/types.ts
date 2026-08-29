/** Public Remote result types for article workflow control. */

import type { ArticleBranchRequest, ArticleSnapshot } from '@deepseek-ai/dsh-article/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Result of a next-stage request. */
export interface ArticleNextResult {
  readonly article: ArticleSnapshot
  readonly agentStarted: boolean
}

/** Result of creating or saving one child branch request. */
export interface ArticleBranchControlResult {
  readonly request: ArticleBranchRequest
  readonly childSessionId?: SessionId
}
