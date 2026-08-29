import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type CreateSessionOptions } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import ArticleService from '@deepseek-ai/dsh-article'
import ArticleWorkspaceService from '@deepseek-ai/dsh-article-workspace'
import * as tool from '../src/index.ts'

const signal = new AbortController().signal

describe('tool-article', () => {
  it('reports no article branch before creation', async () => {
    const ctx = await harness()
    const agent = makeAgent(ctx, SessionId('session-root'))

    const result = await execute(ctx, 'article_read_current', {}, agent)

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected read success')
    expect(result.value).toEqual({ article: null })
  })

  it('saves an immutable draft revision through article_write', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-tool-article-'))
    try {
      const ctx = await harness()
      const agent = makeAgent(ctx, SessionId('session-root'), { meta: { cwd } })
      ctx.articles.create(agent, { title: 'Title', branchName: 'main' })

      const before = await execute(ctx, 'article_read_current', {}, agent)
      expect(before.isError).toBe(false)
      if (before.isError) throw new Error('expected read success')
      const beforeValue = before.value as {
        article: { branch_id: string; revision: number } | null
      }
      const branchId = beforeValue.article!.branch_id
      const revision = beforeValue.article!.revision

      const result = await execute(ctx, 'article_write', {
        branch_id: branchId,
        revision,
        kind: 'draft',
        markdown: '# Draft',
      }, agent)

      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected write success')
      const value = result.value as {
        article: {
          revision: number
          stage: string
          current_document_revision_id: string
          workspace_directory?: string
        }
      }
      // The write saves one immutable document revision, then the workspace
      // materialization commits its own tracking revision.
      expect(value.article.revision).toBeGreaterThan(revision)
      expect(value.article.stage).toBe('draft')
      expect(value.article.current_document_revision_id).toBeDefined()
      expect(value.article.workspace_directory).toBeDefined()
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
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ArticleService)
  await ctx.plugin(ArticleWorkspaceService)
  await ctx.plugin(tool, {})
  return ctx
}

let callCounter = 0
function execute(ctx: Context, name: string, args: unknown, agent: Agent) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
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
