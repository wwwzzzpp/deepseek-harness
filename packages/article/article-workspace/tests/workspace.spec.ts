import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type CreateSessionOptions } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ArticleService, { type ArticleRef } from '@deepseek-ai/dsh-article'
import ArticleWorkspaceService, { ArticleWorkspaceError } from '@deepseek-ai/dsh-article-workspace'

describe('article workspace', () => {
  it('materializes durable documents into the branch directory and tracks them', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-article-workspace-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
      ctx.articles.saveDocument(agent, refOf(created), {
        kind: 'draft',
        markdown: '# Draft',
        source: { kind: 'agent' },
      })

      const article = ctx.articles.get(agent)!
      const result = await ctx.articleWorkspace.materialize(agent, refOf(article))

      expect(result.changed).toBe(true)
      const workspace = result.article.workspace
      expect(workspace).toBeDefined()
      const tracked = workspace!.files.draft
      expect(tracked).toBeDefined()
      expect(tracked!.kind).toBe('draft')
      expect(await readFile(tracked!.path, 'utf8')).toBe('# Draft')
      expect(tracked!.baseRevisionId).toBe(article.currentDocuments.draft)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects a pre-existing unrelated file at materialization', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-article-workspace-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      const created = ctx.articles.create(agent, { title: 'Title', branchName: 'main' })
      const directory = join(cwd, '.dsh', 'article', created.treeId, created.branchId)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'material.md'), 'unrelated external content')
      ctx.articles.saveDocument(agent, refOf(created), {
        kind: 'material',
        markdown: '# Material',
        source: { kind: 'agent' },
      })

      const article = ctx.articles.get(agent)!
      await expect(ctx.articleWorkspace.materialize(agent, refOf(article)))
        .rejects.toThrow(ArticleWorkspaceError)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ArticleService)
  await ctx.plugin(ArticleWorkspaceService)
  return ctx
}

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
