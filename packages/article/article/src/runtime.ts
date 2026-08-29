/** Runtime brands and typed article-domain failures. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ArticleErrorCode } from './domain.ts'
import type {
  ArticleBranchId as ArticleBranchIdType,
  ArticleBranchRequestId as ArticleBranchRequestIdType,
  ArticleTreeId as ArticleTreeIdType,
  DocumentRevisionId as DocumentRevisionIdType,
} from './types.ts'

/**
 * Brand a generated tree id.
 * @param value - raw tree identifier.
 * @returns the same string with the article-tree brand.
 */
export const ArticleTreeId = (value: string): ArticleTreeIdType => value as ArticleTreeIdType
/**
 * Brand a generated branch id.
 * @param value - raw branch identifier.
 * @returns the same string with the article-branch brand.
 */
export const ArticleBranchId = (value: string): ArticleBranchIdType => value as ArticleBranchIdType
/**
 * Brand a generated branch-request id.
 * @param value - raw branch-request identifier.
 * @returns the same string with the article-branch-request brand.
 */
export const ArticleBranchRequestId = (value: string): ArticleBranchRequestIdType => value as ArticleBranchRequestIdType
/**
 * Brand a generated document revision id.
 * @param value - raw document revision identifier.
 * @returns the same string with the document-revision brand.
 */
export const DocumentRevisionId = (value: string): DocumentRevisionIdType => value as DocumentRevisionIdType

/** Typed article-domain rejection. */
export class ArticleError extends HarnessError {
  override readonly code: ArticleErrorCode

  /**
   * @param message - human-readable rejection reason.
   * @param code - stable article-domain failure code.
   * @param options - optional cause metadata.
   */
  constructor(message: string, code: ArticleErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
