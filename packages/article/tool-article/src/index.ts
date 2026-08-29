/**
 * Model-facing read/write tools for the active article branch.
 * @module @deepseek-ai/dsh-tool-article
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ArticleBranchId,
  ArticleError,
  type ArticleDocumentKind,
  type ArticleDocumentRecord,
  type ArticleDocumentSummary,
  type ArticleSnapshot,
} from '@deepseek-ai/dsh-article'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-article-workspace'

export const name = 'tool-article'
export const inject = ['tools', 'articles', 'articleWorkspace', 'systemPrompt']

/** Tool visibility policy for article authoring. */
export interface Config {
  /** Register the write tool. Disable to expose article state as read-only to models. */
  writable?: boolean
}

/** Schemastery config for the article tool consumer. */
export const Config: z<Config> = z.object({
  writable: z.boolean().default(true),
})

const KINDS = ['material', 'draft', 'review', 'final'] as const
const STAGES = ['idea', 'draft', 'review', 'final'] as const

type ArticleReadDocument = {
  revision_id: string
  kind: ArticleDocumentKind
  source: string
  markdown: string
}

type ArticleReadValue = {
  article: null | {
    tree_id: string
    branch_id: string
    revision: number
    title: string
    branch_name: string
    stage: ArticleSnapshot['stage']
    parent_branch_id?: string
    parent_session_id?: string
    workspace_directory?: string
    documents: Partial<Record<ArticleDocumentKind, ArticleReadDocument>>
  }
}

type ArticleWriteValue = {
  article: {
    branch_id: string
    revision: number
    stage: ArticleSnapshot['stage']
    current_document_revision_id: string
    workspace_directory?: string
  }
}

const READ_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      article: {
        required: true,
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              tree_id: { type: 'string', required: true },
              branch_id: { type: 'string', required: true },
              revision: { type: 'integer', required: true },
              title: { type: 'string', required: true },
              branch_name: { type: 'string', required: true },
              stage: { type: 'string', required: true, enum: [...STAGES] },
              parent_branch_id: { type: 'string' },
              parent_session_id: { type: 'string' },
              workspace_directory: { type: 'string' },
              documents: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: Object.fromEntries(KINDS.map(kind => [kind, documentSchema()])),
              },
            },
          },
        ],
      },
    },
  },
  render: (_args: unknown, value: ArticleReadValue) => [{
    type: 'text' as const,
    text: value.article === null
      ? 'No article branch exists in this session.'
      : JSON.stringify(value),
  }],
} as const

const WRITE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      article: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          branch_id: { type: 'string', required: true },
          revision: { type: 'integer', required: true },
          stage: { type: 'string', required: true, enum: [...STAGES] },
          current_document_revision_id: { type: 'string', required: true },
          workspace_directory: { type: 'string' },
        },
      },
    },
  },
  render: (_args: unknown, value: ArticleWriteValue) => [{
    type: 'text' as const,
    text: `Saved ${value.article.stage} revision ${String(value.article.revision)} for branch ${value.article.branch_id}.`,
  }],
} as const

const READ_DESCRIPTION =
  'Read the current article branch, including its exact branch_id/revision CAS ref and current Markdown documents. '
  + 'Use this before article_write.'

const WRITE_DESCRIPTION =
  'Save one new immutable Markdown document revision on the current article branch. Copy branch_id and revision '
  + 'from article_read_current. This never modifies parent or sibling branches and never rolls back or creates branches.'

function documentSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      revision_id: { type: 'string', required: true },
      kind: { type: 'string', required: true, enum: [...KINDS] },
      source: { type: 'string', required: true },
      markdown: { type: 'string', required: true },
    },
  } as const
}

function sourceLabel(document: ArticleDocumentSummary | ArticleDocumentRecord): string {
  if (document.source.kind !== 'branch-seed') return document.source.kind
  return `branch-seed:${document.source.branchId}:${document.source.revisionId}`
}

function readValue(ctx: Context, agent: Agent): ArticleReadValue {
  const article = ctx.articles.get(agent)
  if (article === undefined) return { article: null }
  const documents: Partial<Record<ArticleDocumentKind, ArticleReadDocument>> = {}
  for (const kind of KINDS) {
    const document = ctx.articles.readCurrentDocument(agent, kind)
    if (document === undefined) continue
    documents[kind] = {
      revision_id: document.id,
      kind,
      source: sourceLabel(document),
      markdown: document.markdown,
    }
  }
  return {
    article: {
      tree_id: article.treeId,
      branch_id: article.branchId,
      revision: article.revision,
      title: article.title,
      branch_name: article.branchName,
      stage: article.stage,
      ...article.parentBranchId === undefined ? {} : { parent_branch_id: article.parentBranchId },
      ...article.parentSessionId === undefined ? {} : { parent_session_id: article.parentSessionId },
      ...article.workspace === undefined ? {} : { workspace_directory: article.workspace.directory },
      documents,
    },
  }
}

function requireAgent(exec: ToolRunContext): Agent {
  const agent = exec.agent
  if (agent === undefined) {
    throw new ArticleError('article tools require an owning agent session', 'ARTICLE_AGENT_NOT_LIVE')
  }
  return agent
}

function assertAllowedWrite(article: ArticleSnapshot, kind: ArticleDocumentKind): void {
  if (kind === 'final' && article.stage !== 'review' && article.stage !== 'final') {
    throw new ArticleError('a final can be written only from review or final stage', 'ARTICLE_INVALID_TRANSITION')
  }
  if (kind === 'review' && article.stage === 'idea') {
    throw new ArticleError('review notes require an existing draft stage', 'ARTICLE_INVALID_TRANSITION')
  }
}

function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

/**
 * Register article read/write tools and model guidance.
 * @param ctx - Cordis context carrying tool, prompt, article, and workspace services.
 * @param config - write-tool visibility policy.
 */
export function apply(ctx: Context, config: Config): void {
  const writable = config.writable ?? true
  ctx.systemPrompt.section({
    name: 'tool:article',
    order: 116,
    text: 'When an article branch exists, use article_read_current before article_write. '
      + 'Write only the current branch. Do not create, merge, roll back, or modify parent or sibling branches; '
      + 'those article workflow controls are human-only.',
  })

  ctx.tools.register(defineTool({
    name: 'article_read_current',
    description: READ_DESCRIPTION,
    parameters: {},
    output: READ_OUTPUT,
    execute(_args, exec) {
      return Promise.resolve(readValue(ctx, requireAgent(exec)))
    },
    presentCall: () => present('Read article branch'),
  }))

  if (!writable) return

  ctx.tools.register(defineTool({
    name: 'article_write',
    description: WRITE_DESCRIPTION,
    parameters: {
      branch_id: {
        type: 'string',
        required: true,
        description: 'Exact branch_id returned by article_read_current.',
      },
      revision: {
        type: 'number',
        required: true,
        description: 'Exact positive revision returned by article_read_current.',
      },
      kind: {
        type: 'string',
        required: true,
        enum: [...KINDS],
        description: 'material | draft | review | final',
      },
      markdown: {
        type: 'string',
        required: true,
        description: 'Complete Markdown content for the new immutable revision.',
      },
    },
    output: WRITE_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const article = ctx.articles.get(agent)
      if (article === undefined) throw new ArticleError('the current session has no article branch', 'ARTICLE_NOT_FOUND')
      const kind = args.kind
      assertAllowedWrite(article, kind)
      await ctx.articleWorkspace.assertClean(agent)
      const saved = ctx.articles.saveDocument(agent, {
        branchId: ArticleBranchId(args.branch_id),
        revision: args.revision,
      }, {
        kind,
        markdown: args.markdown,
        source: { kind: 'agent' },
      })
      const materialized = await ctx.articleWorkspace.materialize(agent, {
        branchId: saved.branchId,
        revision: saved.revision,
      })
      const current = materialized.article.currentDocuments[kind]
      if (current === undefined) {
        throw new ArticleError(`article_write did not select a ${kind} revision`, 'ARTICLE_DOCUMENT_NOT_FOUND')
      }
      return {
        article: {
          branch_id: materialized.article.branchId,
          revision: materialized.article.revision,
          stage: materialized.article.stage,
          current_document_revision_id: current,
          ...materialized.article.workspace === undefined ? {} : {
            workspace_directory: materialized.article.workspace.directory,
          },
        },
      }
    },
    presentCall: args => present('Write article document', { kind: args.kind, branch_id: args.branch_id }),
  }))
}
