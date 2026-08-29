/** Public types for branch-local article Markdown workspaces. */

import type { ArticleSnapshot } from '@deepseek-ai/dsh-article/types'

/** Stable working-copy failure codes exposed to controllers and tests. */
export type ArticleWorkspaceErrorCode =
  | 'ARTICLE_WORKSPACE_UNAVAILABLE'
  | 'ARTICLE_WORKSPACE_INVALID_PATH'
  | 'ARTICLE_WORKSPACE_CONFLICT'

/** Result returned after working-copy materialization or synchronization. */
export interface ArticleWorkspaceResult {
  readonly article: ArticleSnapshot
  readonly changed: boolean
}
