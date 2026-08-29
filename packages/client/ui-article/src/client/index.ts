/** Browser entry for the article control dock. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `article` SessionProjectionMap key merge.
import type {
  ArticleDocumentKind,
  ArticleProjection,
  ArticleRef,
  CreateArticleRequest,
} from '@deepseek-ai/dsh-article/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ArticleDock } from './ArticleDock.tsx'
import type { ArticleDockActions } from './slots.ts'
import { en, zh, type ArticleKey } from './locales.ts'

export { ArticleDock } from './ArticleDock.tsx'
export type { ArticleDockActions } from './slots.ts'
export type { ArticleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Article workbench dock copy. */
    article: ArticleKey
  }
}

const NS = 'article'

/** Required services for projection reading, Remote control, file opening, Session navigation, and copy. */
export const inject = [
  'slots',
  'sessions',
  'remote',
  'remote.articles',
  'remote.articleControl',
  'workspaces',
  'locale',
]

/** Register the article control panel in the conversation input dock. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-article: dictionaries')

  const refOf = (sessionId: SessionId): ArticleRef | undefined => {
    const projection = currentArticleProjection(ctx, sessionId)
    if (projection === undefined) return undefined
    return { branchId: projection.article.branchId, revision: projection.article.revision }
  }

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'article',
    order: 15,
    locale: NS,
    inject: (sessionId): ArticleDockActions => ({
      onCreate: async (title, branchName) =>
        await ctx.remote.articleControl.create(sessionId, { title, branchName } satisfies CreateArticleRequest),
      onNext: async () => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentArticle()
        return await ctx.remote.articleControl.next(sessionId, ref)
      },
      onApproveFinal: async () => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentArticle()
        return await ctx.remote.articleControl.approveFinal(sessionId, ref)
      },
      onOpenDocument: async kind => await openCurrentDocument(ctx, sessionId, kind),
      onSynchronize: async (kind) => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentArticle()
        return await ctx.remote.articleControl.synchronize(sessionId, ref, kind)
      },
      onRequestChanges: async () => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentArticle()
        return await ctx.remote.articleControl.requestChanges(sessionId, ref)
      },
      onListDraftRevisions: async () => await ctx.remote.articles.listRevisions(sessionId, 'draft'),
      onRollback: async (revisionId) => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentArticle()
        return await ctx.remote.articleControl.rollback(sessionId, ref, revisionId)
      },
      onCreateBranch: async (branchName, explorationIdea) => openReturnedChildSession(
        ctx,
        await createBranch(ctx, sessionId, refOf(sessionId), branchName, explorationIdea),
      ),
      onConfirmBranch: async requestId => openReturnedChildSession(
        ctx,
        await ctx.remote.articleControl.confirmBranch(sessionId, requestId),
      ),
      onRetryBranch: async requestId => openReturnedChildSession(
        ctx,
        await ctx.remote.articleControl.retryBranch(sessionId, requestId),
      ),
      onCancelBranch: async requestId => await ctx.remote.articleControl.cancelBranch(sessionId, requestId),
      onOpenSession: (target) => {
        ctx.sessions.open(target)
        return Promise.resolve({ ok: true, value: { opened: target } })
      },
    }),
  }, ArticleDock))
}

async function createBranch(
  ctx: ClientContext,
  sessionId: SessionId,
  ref: ArticleRef | undefined,
  branchName: string,
  explorationIdea: string,
): Promise<RemoteResult<unknown>> {
  if (ref === undefined) return noCurrentArticle()
  return await ctx.remote.articleControl.createBranch(sessionId, ref, branchName, explorationIdea)
}

function currentArticleProjection(ctx: ClientContext, sessionId: SessionId): ArticleProjection | undefined {
  const face = ctx.sessions.binding(sessionId)?.session.projections.faceOf('article')
  const projection = face?.getSnapshot() as ArticleProjection | null | undefined
  return projection === null ? undefined : projection
}

async function openCurrentDocument(
  ctx: ClientContext,
  sessionId: SessionId,
  kind: ArticleDocumentKind,
): Promise<RemoteResult<unknown>> {
  const projection = currentArticleProjection(ctx, sessionId)
  const file = projection?.article.workspace?.files[kind]
  if (file === undefined) {
    return {
      ok: false,
      error: { code: 'article-document-file-missing', message: `no ${kind} Markdown file is available`, details: {} },
    }
  }
  try {
    await ctx.workspaces.openPath(file.path)
    return { ok: true, value: { opened: file.path } }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'article-document-open-failed', message: error instanceof Error ? error.message : String(error), details: {} },
    }
  }
}

function openReturnedChildSession(ctx: ClientContext, result: RemoteResult<unknown>): RemoteResult<unknown> {
  if (result.ok) {
    const child = childSessionIdOf(result.value)
    if (child !== undefined) ctx.sessions.open(child)
  }
  return result
}

function childSessionIdOf(value: unknown): SessionId | undefined {
  if (typeof value !== 'object' || value === null || !('childSessionId' in value)) return undefined
  const child = (value as { childSessionId?: unknown }).childSessionId
  return typeof child === 'string' ? child as SessionId : undefined
}

function noCurrentArticle(): RemoteResult<unknown> {
  return {
    ok: false,
    error: { code: 'no-current-article', message: 'no current article branch to mutate', details: {} },
  }
}
