import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type CreateSessionOptions } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ArticleService, {
  ArticleError,
  type ArticleRef,
} from '@deepseek-ai/dsh-article'

describe('article service', () => {
  it('does not expose inherited parent branch requests after child branch initialization', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(ArticleService)

    const parent = makeAgent(ctx, SessionId('session-parent'))
    const root = ctx.articles.create(parent, { title: 'Title', branchName: 'main' })
    const request = ctx.articles.createBranchRequest(parent, refOf(root), {
      branchName: 'child',
      explorationIdea: 'look from another angle',
      status: 'draft',
    })

    const child = makeAgent(ctx, SessionId('session-child'), {
      seed: parent.session.events,
      meta: {
        parentSession: parent.session.id,
        seedLength: parent.session.events.length,
      },
    })
    ctx.articles.initializeBranch(child, {
      branchId: request.branchId,
      branchName: request.branchName,
      explorationIdea: request.explorationIdea,
    })

    expect(ctx.articles.getBranchRequest(parent, request.id)).toMatchObject({ id: request.id })
    expect(ctx.articles.getBranchRequest(child, request.id)).toBeUndefined()
    expect(() => {
      ctx.articles.updateBranchRequest(child, request.id, { status: 'cancelled' })
    }).toThrow(ArticleError)
  })
})

function refOf(article: ArticleRef): ArticleRef {
  return { branchId: article.branchId, revision: article.revision }
}

function makeAgent(
  ctx: Context,
  sessionId: SessionId,
  options?: CreateSessionOptions,
): Agent {
  const session = ctx.sessions.create(sessionId, options)
  const agent = {} as Agent
  const agentCtx = ctx.extend({ agent })
  const runMaintenance: Agent['runMaintenance'] = task => task(new AbortController().signal)
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: agentCtx,
    cancel: () => {},
    whenIdle: () => Promise.resolve(),
    runMaintenance,
    send: () => {},
    followup: (message) => { agent.inbox.append('next-turn', message) },
    steer: () => {},
    inject: () => {},
  } satisfies Partial<Agent>)
  ctx.agents.register(agent)
  return agent
}
