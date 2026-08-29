/** Package-owned durable article-stream invariant. @module @deepseek-ai/dsh-article/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyArticleEvent, emptyArticleFoldState } from './fold.ts'
import type { ArticleFoldState } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-article'

/** Cordis companion plugin name. */
export const name = 'article-invariant'
/** Services required by the invariant companion. */
export const inject = ['invariants']

function cloneState(state: ArticleFoldState): ArticleFoldState {
  return {
    article: state.article,
    documents: new Map(state.documents),
    branchRequests: new Map(state.branchRequests),
    lastDocument: state.lastDocument,
    documentRevisionCount: state.documentRevisionCount,
  }
}

function applyChecked(state: ArticleFoldState, event: SessionEvent, fail: InvariantFailure): void {
  try {
    applyArticleEvent(state, event)
  } catch (error) {
    /* v8 ignore next -- strict decoders throw Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable article stream: ${message}`)
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, ArticleFoldState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: ArticleFoldState }>()
  const seed = (session: Session): ArticleFoldState => {
    const state = emptyArticleFoldState()
    for (const event of session.events) applyChecked(state, event, fail)
    states.set(session, state)
    return state
  }
  const stateFor = (session: Session): ArticleFoldState => states.get(session) ?? seed(session)
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = cloneState(stateFor(session))
    applyChecked(state, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching article-fold validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the article-stream invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
