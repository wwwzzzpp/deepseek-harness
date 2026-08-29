/** Human workflow controls and recoverable article Session branching. @module @deepseek-ai/dsh-article-control */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  ArticleError,
} from '@deepseek-ai/dsh-article'
import type {
  ArticleBranchRequest,
  ArticleBranchRequestId,
  ArticleDocumentKind,
  ArticleRef,
  ArticleSnapshot,
  CreateArticleRequest,
  DocumentRevisionId,
} from '@deepseek-ai/dsh-article/types'
import type {} from '@deepseek-ai/dsh-article-workspace'
import type { ArticleWorkspaceResult } from '@deepseek-ai/dsh-article-workspace/types'
import type { ArticleBranchControlResult, ArticleNextResult } from './types.ts'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { articleControl: ArticleControlService }
}

/** Article workflow controller (`ctx.articleControl`). */
export class ArticleControlService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionTitle', 'articles', 'articleWorkspace']

  /**
   * @param ctx - Cordis context that owns article, Session, title, and workspace services.
   */
  constructor(ctx: Context) {
    super(ctx, 'articleControl')
    ctx.on('article/changed', ({ agent, change }) => {
      if (change.operation !== 'save-document') return
      if (change.article.stage === 'draft') this.auditWorkflowAction(agent, 'next', 'generate draft')
      if (change.article.stage === 'final') this.auditWorkflowAction(agent, 'approve', 'generate final')
    })
  }

  /**
   * Create one root article and its branch-local working directory.
   * @param agent - live Agent whose Session log receives the article root.
   * @param request - title and optional root branch metadata.
   * @returns materialized branch-local workspace result.
   */
  async create(agent: Agent, request: CreateArticleRequest): Promise<ArticleWorkspaceResult> {
    const created = this.ctx.articles.create(agent, request)
    return await this.ctx.articleWorkspace.materialize(agent, refOf(created))
  }

  /**
   * Advance under explicit human control; model-writing stages wake one visible follow-up.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns current article state and whether the Agent was started.
   */
  next(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult> {
    const current = requireRef(this.ctx.articles.get(agent), ref)
    assertIdle(agent)
    if (current.stage === 'idea') {
      this.ctx.articles.recordAction(agent, 'next', 'requested', 'generate draft')
      agent.followup(workflowMessage(
        'Write the first complete draft for the current article. Read the current article state and material, '
        + 'then use article_write with kind "draft". Do not advance to review or final.',
      ))
      return Promise.resolve({ article: current, agentStarted: true })
    }
    if (current.stage === 'draft') {
      // Saving a review document advances the branch to review stage.
      const article = this.ctx.articles.saveDocument(agent, ref, {
        kind: 'review',
        markdown: reviewTemplate(current),
        source: { kind: 'plugin' },
      })
      this.ctx.articles.recordAction(agent, 'next', 'completed', 'submitted draft for review')
      return Promise.resolve({ article, agentStarted: false })
    }
    if (current.stage === 'review') {
      throw new ArticleError(
        'review requires an explicit approveFinal or requestChanges action and never advances on its own',
        'ARTICLE_INVALID_TRANSITION',
      )
    }
    throw new ArticleError('the final stage has no next workflow stage', 'ARTICLE_INVALID_TRANSITION')
  }

  /**
   * Approve the reviewed branch and ask the Agent to generate the final document.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns current article state and whether the Agent was started.
   */
  async approveFinal(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult> {
    const current = requireRef(this.ctx.articles.get(agent), ref)
    assertIdle(agent)
    if (current.stage !== 'review') {
      throw new ArticleError('a final can be approved only from review stage', 'ARTICLE_INVALID_TRANSITION')
    }
    await this.ctx.articleWorkspace.assertClean(agent)
    const materialized = await this.ctx.articleWorkspace.materialize(agent, refOf(current))
    this.ctx.articles.recordAction(agent, 'approve', 'requested', 'generate final')
    agent.followup(workflowMessage(
      'Finalize the reviewed article now. Read the current draft and the review notes in review.md, apply every '
      + 'human edit and requirement exactly, then use article_write with kind "final". Preserve the draft history '
      + 'and do not modify any parent or sibling branch.',
    ))
    return Promise.resolve({ article: materialized.article, agentStarted: true })
  }

  /**
   * Return review/final to the branch's current draft after checking external files.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns materialized branch-local workspace result after returning to draft.
   */
  async requestChanges(agent: Agent, ref: ArticleRef): Promise<ArticleWorkspaceResult> {
    assertIdle(agent)
    await this.ctx.articleWorkspace.assertClean(agent)
    let article = this.ctx.articles.requestChanges(agent, ref)
    this.ctx.articles.recordAction(agent, 'request-changes', 'completed')
    article = (await this.ctx.articleWorkspace.materialize(agent, refOf(article))).article
    return { article, changed: true }
  }

  /**
   * Select a historical branch-local draft without deleting any later revision.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param revisionId - branch-local draft revision to restore.
   * @returns materialized branch-local workspace result after rollback.
   */
  async rollback(agent: Agent, ref: ArticleRef, revisionId: DocumentRevisionId): Promise<ArticleWorkspaceResult> {
    assertIdle(agent)
    await this.ctx.articleWorkspace.assertClean(agent)
    let article = this.ctx.articles.rollback(agent, ref, revisionId)
    this.ctx.articles.recordAction(agent, 'rollback', 'completed', revisionId)
    article = (await this.ctx.articleWorkspace.materialize(agent, refOf(article))).article
    return { article, changed: true }
  }

  /**
   * Save an idea immediately; fork only when the source Agent is idle.
   * @param agent - live parent Agent whose Session log owns the source branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param branchName - branch display name and child Session title.
   * @param explorationIdea - first user message for the child Session.
   * @returns durable branch request and child Session id when creation reached a fork.
   */
  async createBranch(agent: Agent, ref: ArticleRef, branchName: string, explorationIdea: string): Promise<ArticleBranchControlResult> {
    const status = agent.status === 'idle' ? 'creating' : 'draft'
    const request = this.ctx.articles.createBranchRequest(agent, ref, { branchName, explorationIdea, status })
    this.ctx.articles.recordAction(agent, 'create-branch', 'requested', status === 'draft' ? 'saved until the current turn ends' : undefined)
    if (status === 'draft') return { request }
    return await this.finishBranch(agent, request)
  }

  /**
   * Confirm a saved idea against the latest completed turn and latest article revision.
   * @param agent - live parent Agent whose saved request should become a child branch.
   * @param requestId - saved draft branch request id.
   * @returns durable branch request and child Session id when creation reached a fork.
   */
  async confirmBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult> {
    assertIdle(agent)
    const saved = this.requireRequest(agent, requestId)
    if (saved.status !== 'draft') throw new ArticleError('only a saved draft branch request can be confirmed', 'ARTICLE_INVALID_TRANSITION')
    const current = this.ctx.articles.get(agent)
    if (current === undefined) throw new ArticleError('the current session has no article branch', 'ARTICLE_NOT_FOUND')
    this.ctx.articles.updateBranchRequest(agent, saved.id, { status: 'cancelled' })
    const refreshed = this.ctx.articles.createBranchRequest(agent, refOf(current), {
      branchName: saved.branchName,
      explorationIdea: saved.explorationIdea,
      status: 'creating',
    })
    return await this.finishBranch(agent, refreshed)
  }

  /**
   * Retry initialization without deleting a Session already created by an earlier attempt.
   * @param agent - live parent Agent whose failed request should be retried.
   * @param requestId - failed branch request id.
   * @returns durable branch request and child Session id when creation reached a fork.
   */
  async retryBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult> {
    assertIdle(agent)
    const failed = this.requireRequest(agent, requestId)
    if (failed.status !== 'failed') throw new ArticleError('only a failed branch request can be retried', 'ARTICLE_INVALID_TRANSITION')
    const creating = this.ctx.articles.updateBranchRequest(agent, failed.id, { status: 'creating' })
    return await this.finishBranch(agent, creating)
  }

  /**
   * Cancel only the article association request; any created child Session remains intact.
   * @param agent - live parent Agent whose request should be cancelled.
   * @param requestId - saved or failed branch request id.
   * @returns cancelled durable branch request.
   */
  cancelBranch(agent: Agent, requestId: ArticleBranchRequestId): ArticleBranchControlResult {
    const request = this.requireRequest(agent, requestId)
    if (request.status !== 'draft' && request.status !== 'failed') {
      throw new ArticleError('only saved or failed branch requests can be cancelled', 'ARTICLE_INVALID_TRANSITION')
    }
    return { request: this.ctx.articles.updateBranchRequest(agent, requestId, { status: 'cancelled' }) }
  }

  /**
   * Remote root creation.
   * @param agent - live Agent inferred from the remote request.
   * @param request - title and optional root branch metadata.
   * @returns materialized branch-local workspace result.
   */
  @Remote('create')
  async remoteExportCreate(agent: Agent, request: CreateArticleRequest): Promise<ArticleWorkspaceResult> {
    return await this.create(agent, request)
  }

  /**
   * Remote next-stage control.
   * @param agent - live Agent inferred from the remote request.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns current article state and whether the Agent was started.
   */
  @Remote('next')
  async remoteExportNext(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult> {
    return await this.next(agent, ref)
  }

  /**
   * Remote review approval.
   * @param agent - live Agent inferred from the remote request.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns current article state and whether the Agent was started.
   */
  @Remote('approveFinal')
  async remoteExportApproveFinal(agent: Agent, ref: ArticleRef): Promise<ArticleNextResult> {
    return await this.approveFinal(agent, ref)
  }

  /**
   * Remote review/final return.
   * @param agent - live Agent inferred from the remote request.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns materialized branch-local workspace result after returning to draft.
   */
  @Remote('requestChanges')
  async remoteExportRequestChanges(agent: Agent, ref: ArticleRef): Promise<ArticleWorkspaceResult> {
    return await this.requestChanges(agent, ref)
  }

  /**
   * Remote historical rollback.
   * @param agent - live Agent inferred from the remote request.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param revisionId - branch-local draft revision to restore.
   * @returns materialized branch-local workspace result after rollback.
   */
  @Remote('rollback')
  async remoteExportRollback(agent: Agent, ref: ArticleRef, revisionId: DocumentRevisionId): Promise<ArticleWorkspaceResult> {
    return await this.rollback(agent, ref, revisionId)
  }

  /**
   * Remote branch request/fork.
   * @param agent - live parent Agent inferred from the remote request.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param branchName - branch display name and child Session title.
   * @param explorationIdea - first user message for the child Session.
   * @returns durable branch request and child Session id when creation reached a fork.
   */
  @Remote('createBranch')
  async remoteExportCreateBranch(
    agent: Agent,
    ref: ArticleRef,
    branchName: string,
    explorationIdea: string,
  ): Promise<ArticleBranchControlResult> {
    return await this.createBranch(agent, ref, branchName, explorationIdea)
  }

  /**
   * Remote confirmation of a saved mid-turn idea.
   * @param agent - live parent Agent inferred from the remote request.
   * @param requestId - saved draft branch request id.
   * @returns durable branch request and child Session id when creation reached a fork.
   */
  @Remote('confirmBranch')
  async remoteExportConfirmBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult> {
    return await this.confirmBranch(agent, requestId)
  }

  /**
   * Remote failed initialization retry.
   * @param agent - live parent Agent inferred from the remote request.
   * @param requestId - failed branch request id.
   * @returns durable branch request and child Session id when creation reached a fork.
   */
  @Remote('retryBranch')
  async remoteExportRetryBranch(agent: Agent, requestId: ArticleBranchRequestId): Promise<ArticleBranchControlResult> {
    return await this.retryBranch(agent, requestId)
  }

  /**
   * Remote article-association cancellation.
   * @param agent - live parent Agent inferred from the remote request.
   * @param requestId - saved or failed branch request id.
   * @returns cancelled durable branch request.
   */
  @Remote('cancelBranch')
  remoteExportCancelBranch(agent: Agent, requestId: ArticleBranchRequestId): ArticleBranchControlResult {
    return this.cancelBranch(agent, requestId)
  }

  /**
   * Remote working-copy synchronization routed through one control surface.
   * @param agent - live Agent inferred from the remote request.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param kind - branch-local Markdown file to import.
   * @returns current article snapshot plus whether a new durable revision was saved.
   */
  @Remote('synchronize')
  async remoteExportSynchronize(agent: Agent, ref: ArticleRef, kind: ArticleDocumentKind): Promise<ArticleWorkspaceResult> {
    assertIdle(agent)
    return await this.ctx.articleWorkspace.synchronize(agent, ref, kind)
  }

  private auditWorkflowAction(agent: Agent, action: 'next' | 'approve', detail: string): void {
    const events = agent.session.events
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event?.type !== 'article/action') continue
      const meta = event.data
      if (meta.action !== action) continue
      if (meta.status === 'requested' && meta.detail === detail) {
        this.ctx.articles.recordAction(agent, action, 'completed', detail)
      }
      return
    }
  }

  private requireRequest(agent: Agent, requestId: ArticleBranchRequestId): ArticleBranchRequest {
    const cache = this.ctx.articles.getBranchRequest(agent, requestId)
    if (cache === undefined) throw new ArticleError(`branch request ${requestId} was not found`, 'ARTICLE_BRANCH_REQUEST_NOT_FOUND')
    return cache
  }

  private async finishBranch(parentAgent: Agent, creating: ArticleBranchRequest): Promise<ArticleBranchControlResult> {
    let childSessionId = creating.childSessionId
    try {
      let childAgent: Agent
      if (childSessionId === undefined) {
        childAgent = await this.createForkedAgent(parentAgent)
        childSessionId = childAgent.id
      } else {
        const live = this.ctx.agents.get(childSessionId)
        if (live === undefined) throw new Error(`forked Session ${childSessionId} is not live`)
        childAgent = live
      }
      await this.attachForkWorkspace(parentAgent, childSessionId)
      const inherited = this.ctx.articles.get(childAgent)
      if (inherited?.branchId !== creating.branchId) {
        const child = this.ctx.articles.initializeBranch(childAgent, {
          branchId: creating.branchId,
          branchName: creating.branchName,
          explorationIdea: creating.explorationIdea,
        })
        await this.ctx.articleWorkspace.materialize(childAgent, refOf(child))
      }
      this.ctx.sessionTitle.rename(childAgent.session, creating.branchName)
      if (!hasChildUserText(childAgent, creating.explorationIdea)) childAgent.followup(branchIdeaMessage(creating.explorationIdea))
      const ready = this.ctx.articles.updateBranchRequest(parentAgent, creating.id, { status: 'ready', childSessionId })
      this.ctx.articles.recordAction(parentAgent, 'create-branch', 'completed', childSessionId)
      return { request: ready, childSessionId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = this.ctx.articles.updateBranchRequest(parentAgent, creating.id, {
        status: 'failed',
        ...childSessionId === undefined ? {} : { childSessionId },
        error: message,
      })
      this.ctx.articles.recordAction(parentAgent, 'create-branch', 'failed', message)
      return { request: failed, ...childSessionId === undefined ? {} : { childSessionId } }
    }
  }

  private async createForkedAgent(parentAgent: Agent): Promise<Agent> {
    const seed = stableForkSeed(parentAgent.session.events, parentAgent.session.id)
    const childId = SessionId(`session-${randomUUID()}`)
    const parentPreset = resolveSessionPreset(parentAgent.session)
    const handle = await this.ctx.agents.create({
      sessionId: childId,
      seed,
      meta: {
        ...parentAgent.session.header.cwd === undefined ? {} : { cwd: parentAgent.session.header.cwd },
        parentSession: parentAgent.session.id,
        seedLength: seed.length,
        ...parentPreset === undefined ? {} : { agentPreset: parentPreset },
      },
      agentOptions: agentOptionsForFork(parentAgent),
      setup: async (agentCtx) => {
        const presets = this.ctx.get('agentPresets')
        if (presets === undefined) return
        const joined = presets.composeFrom(agentCtx, parentAgent.ctx)
        if (joined === undefined && parentPreset !== undefined) await presets.mount(agentCtx, parentPreset)
      },
    })
    return handle.agent
  }

  private async attachForkWorkspace(parentAgent: Agent, childSessionId: SessionId): Promise<void> {
    const workspaceRegistry = this.ctx.get('workspaceRegistry')
    const cwd = parentAgent.session.header.cwd
    if (workspaceRegistry === undefined || cwd === undefined) return
    const workspace = await workspaceRegistry.resolveByPath(cwd)
    await workspace?.attachSession(childSessionId)
  }
}

function reviewTemplate(article: ArticleSnapshot): string {
  return [
    '# 审核记录',
    '',
    '## 文字审核',
    '- [ ] 结构完整，逻辑连贯',
    '- [ ] 长度符合预期',
    '- [ ] 术语与措辞一致',
    '',
    '## 事实 / 观点 / 猜测',
    '- 事实：',
    '- 观点：',
    '- 猜测：',
    '',
    '## 删除 / 保留',
    '- 删除：',
    '- 保留：',
    '',
    '## 标题',
    `- 现有标题：${article.title}`,
    '- 建议：',
    '',
    '## 配图位置',
    '- 配图 1：',
    '',
    '## 最终修改要求',
    '- ',
    '',
  ].join('\n')
}

function refOf(article: ArticleSnapshot): ArticleRef {
  return { branchId: article.branchId, revision: article.revision }
}

function requireRef(article: ArticleSnapshot | undefined, ref: ArticleRef): ArticleSnapshot {
  if (article === undefined) throw new ArticleError('the current session has no article branch', 'ARTICLE_NOT_FOUND')
  if (article.branchId !== ref.branchId || article.revision !== ref.revision) {
    throw new ArticleError('the article action used a stale branch revision', 'ARTICLE_STALE_REVISION')
  }
  return article
}

function assertIdle(agent: Agent): void {
  if (agent.status !== 'idle') throw new ArticleError('wait for the current Agent turn to finish', 'ARTICLE_INVALID_TRANSITION')
}

function workflowMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text' as const, text: `<article_workflow>\n${text}\n</article_workflow>` }],
    source: { kind: 'plugin' as const, plugin: 'article-control', form: 'notice' as const, summary: 'article workflow action' },
  })
}

function branchIdeaMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text' as const, text }],
    source: { kind: 'user' as const },
  })
}

function hasChildUserText(agent: Agent, text: string): boolean {
  for (const event of agent.session.events.slice(agent.session.header.seedLength ?? 0)) {
    if (event.type !== 'user/message') continue
    if (event.data.content.length !== 1) continue
    const block = event.data.content[0]
    if (block?.type === 'text' && block.text === text) return true
  }
  return false
}

function stableForkSeed(events: readonly SessionEvent[], sessionId: SessionId): SessionEvent[] {
  const boundary = events.findLast(event => event.type === 'turn/end')
  if (boundary !== undefined) {
    let cut = boundary.seq + 1
    while (cut < events.length && events[cut]?.type !== 'turn/start') cut += 1
    return events.slice(0, cut)
  }
  const openTurn = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  if (openTurn?.type === 'turn/start') {
    throw new ArticleError(`session "${sessionId}" has no completed turn to fork from`, 'ARTICLE_INVALID_TRANSITION')
  }
  return events.slice()
}

function agentOptionsForFork(agent: Agent) {
  const config = agent.session.requestHeader()?.config
  if (config === undefined) return { ...agent.options }
  return {
    provider: config.provider,
    model: config.model,
    ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
  }
}

export default ArticleControlService
