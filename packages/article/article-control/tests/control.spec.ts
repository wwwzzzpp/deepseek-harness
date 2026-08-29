import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type CreateSessionOptions } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import ArticleService, { ArticleError, type ArticleActionMeta, type ArticleRef } from '@deepseek-ai/dsh-article'
import ArticleWorkspaceService from '@deepseek-ai/dsh-article-workspace'
import ArticleControlService from '@deepseek-ai/dsh-article-control'

describe('article control', () => {
  it('cancels a saved draft branch request without touching its session', async () => {
    const ctx = await harness()
    const agent = makeAgent(ctx, SessionId('session-root'))
    const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
    const request = ctx.articles.createBranchRequest(agent, refOf(created), {
      branchName: 'child',
      explorationIdea: 'explore another angle',
      status: 'draft',
    })

    const result = ctx.articleControl.cancelBranch(agent, request.id)

    expect(result.request.status).toBe('cancelled')
    expect(ctx.articles.getBranchRequest(agent, request.id)?.status).toBe('cancelled')
  })

  it('asks the agent to write a draft when advancing from the idea stage', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-article-control-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })

      const result = await ctx.articleControl.next(agent, refOf(created))

      expect(result.agentStarted).toBe(true)
      expect(result.article.stage).toBe('idea')
      expect(agent.inbox.nextTurn.length).toBe(1)
      expect(agent.inbox.nextTurn[0]?.content[0]?.type).toBe('text')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('creates a review template and submits it when advancing from draft', async () => {
    const ctx = await harness()
    const agent = makeAgent(ctx, SessionId('session-root'))
    const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
    ctx.articles.saveDocument(agent, refOf(created), {
      kind: 'draft',
      markdown: '# Draft',
      source: { kind: 'agent' },
    })

    const result = await ctx.articleControl.next(agent, refOf(ctx.articles.get(agent)!))

    expect(result.article.stage).toBe('review')
    expect(result.article.currentDocuments.review).toBeDefined()
    expect(result.agentStarted).toBe(false)
    const last = lastArticleAction(agent)
    expect(last?.action).toBe('next')
    expect(last?.status).toBe('completed')
  })

  it('refuses to advance from review without an explicit decision', async () => {
    const ctx = await harness()
    const agent = makeAgent(ctx, SessionId('session-root'))
    const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
    ctx.articles.saveDocument(agent, refOf(created), {
      kind: 'draft',
      markdown: '# Draft',
      source: { kind: 'agent' },
    })
    await ctx.articleControl.next(agent, refOf(ctx.articles.get(agent)!))
    const review = ctx.articles.get(agent)!

    expect(() => ctx.articleControl.next(agent, refOf(review))).toThrow(ArticleError)
    expect(agent.inbox.nextTurn.length).toBe(0)
  })

  it('loops review comments, rewrites, and re-review without producing a final until approval', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-article-control-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
      ctx.articles.saveDocument(agent, refOf(created), {
        kind: 'draft',
        markdown: '# Draft v1',
        source: { kind: 'agent' },
      })

      // Round 1: draft -> review with a fresh review template.
      await ctx.articleControl.next(agent, refOf(ctx.articles.get(agent)!))
      let current = ctx.articles.get(agent)!
      expect(current.stage).toBe('review')
      expect(current.currentDocuments.review).toBeDefined()

      // Reviewer asks for changes: back to draft with review/final pointers cleared.
      await ctx.articleControl.requestChanges(agent, refOf(current))
      current = ctx.articles.get(agent)!
      expect(current.stage).toBe('draft')
      expect(current.currentDocuments.review).toBeUndefined()
      expect(current.currentDocuments.final).toBeUndefined()

      // Model rewrites the draft.
      ctx.articles.saveDocument(agent, refOf(current), {
        kind: 'draft',
        markdown: '# Draft v2',
        source: { kind: 'agent' },
      })

      // Round 2: draft -> review again with a new review template.
      await ctx.articleControl.next(agent, refOf(ctx.articles.get(agent)!))
      current = ctx.articles.get(agent)!
      expect(current.stage).toBe('review')
      expect(current.currentDocuments.review).toBeDefined()

      // Without approval the loop can never reach final.
      expect(() => ctx.articleControl.next(agent, refOf(current))).toThrow(ArticleError)

      // Explicit approval finally requests the final document.
      const approved = await ctx.articleControl.approveFinal(agent, refOf(current))
      expect(approved.agentStarted).toBe(true)
      ctx.articles.saveDocument(agent, refOf(ctx.articles.get(agent)!), {
        kind: 'final',
        markdown: '# Final',
        source: { kind: 'agent' },
      })
      expect(ctx.articles.get(agent)!.stage).toBe('final')
      const last = lastArticleAction(agent)
      expect(last?.action).toBe('approve')
      expect(last?.status).toBe('completed')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('approveFinal records the approval fact, syncs review.md, and asks for the final', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-article-control-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
      ctx.articles.saveDocument(agent, refOf(created), {
        kind: 'draft',
        markdown: '# Draft',
        source: { kind: 'agent' },
      })
      await ctx.articleControl.next(agent, refOf(ctx.articles.get(agent)!))
      const review = ctx.articles.get(agent)!

      const result = await ctx.articleControl.approveFinal(agent, refOf(review))

      expect(result.agentStarted).toBe(true)
      expect(agent.inbox.nextTurn.length).toBe(1)
      const last = lastArticleAction(agent)
      expect(last?.action).toBe('approve')
      expect(last?.status).toBe('requested')
      const reviewFile = result.article.workspace?.files.review
      expect(reviewFile).toBeDefined()
      expect(await readFile(reviewFile!.path, 'utf8')).toContain('# 审核记录')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('closes the pending approve audit once the final document is saved', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-article-control-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
      ctx.articles.saveDocument(agent, refOf(created), {
        kind: 'draft',
        markdown: '# Draft',
        source: { kind: 'agent' },
      })
      await ctx.articleControl.next(agent, refOf(ctx.articles.get(agent)!))
      await ctx.articleControl.approveFinal(agent, refOf(ctx.articles.get(agent)!))

      ctx.articles.saveDocument(agent, refOf(ctx.articles.get(agent)!), {
        kind: 'final',
        markdown: '# Final',
        source: { kind: 'agent' },
      })

      const last = lastArticleAction(agent)
      expect(last?.action).toBe('approve')
      expect(last?.status).toBe('completed')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('closes the pending next audit once a draft document is saved', async () => {
    const ctx = await harness()
    const agent = makeAgent(ctx, SessionId('session-root'))
    const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
    await ctx.articleControl.next(agent, refOf(created))

    ctx.articles.saveDocument(agent, refOf(ctx.articles.get(agent)!), {
      kind: 'draft',
      markdown: '# Draft',
      source: { kind: 'agent' },
    })

    const last = lastArticleAction(agent)
    expect(last?.action).toBe('next')
    expect(last?.status).toBe('completed')
  })
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 20, fallbackMaxBytes: 40, maxTitleBytes: 100 })
  await ctx.plugin(ArticleService)
  await ctx.plugin(ArticleWorkspaceService)
  await ctx.plugin(ArticleControlService)
  return ctx
}

function refOf(article: ArticleRef): ArticleRef {
  return { branchId: article.branchId, revision: article.revision }
}

function lastArticleAction(agent: Agent): ArticleActionMeta | undefined {
  const events = agent.session.events
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type === 'article/action') return event.data
  }
  return undefined
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
