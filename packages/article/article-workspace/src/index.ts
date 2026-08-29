/** Conflict-safe branch-local Markdown working copies. @module @deepseek-ai/dsh-article-workspace */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ArticleDocumentKind,
  ArticleRef,
  ArticleSnapshot,
  ArticleWorkspaceFile,
} from '@deepseek-ai/dsh-article'
import type { ArticleWorkspaceErrorCode, ArticleWorkspaceResult } from './types.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export type * from './types.ts'

const DOCUMENT_NAMES: Record<ArticleDocumentKind, string> = {
  material: 'material.md',
  draft: 'draft.md',
  review: 'review.md',
  final: 'final.md',
}

/** A working-copy operation that refused to guess or overwrite. */
export class ArticleWorkspaceError extends Error {
  override readonly name = 'ArticleWorkspaceError'

  /**
   * @param message - human-readable workspace rejection reason.
   * @param code - stable workspace failure code.
   */
  constructor(message: string, readonly code: ArticleWorkspaceErrorCode) {
    super(message)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { articleWorkspace: ArticleWorkspaceService }
}

/** Branch-local Markdown service (`ctx.articleWorkspace`). */
export class ArticleWorkspaceService extends TypertRemoteService {
  static inject = ['articles']

  /**
   * @param ctx - Cordis context that owns article state and workspace controls.
   */
  constructor(ctx: Context) {
    super(ctx, 'articleWorkspace')
  }

  /**
   * Materialize every current durable document without overwriting external edits.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @returns current article snapshot plus whether files or workspace metadata changed.
   */
  async materialize(agent: Agent, ref: ArticleRef): Promise<ArticleWorkspaceResult> {
    let article = this.requireRef(agent, ref)
    const directory = branchDirectory(agent, article)
    const previous = article.workspace
    if (previous !== undefined && resolve(previous.directory) !== directory) {
      throw new ArticleWorkspaceError('the recorded article workspace does not match this branch directory', 'ARTICLE_WORKSPACE_INVALID_PATH')
    }
    const files: Partial<Record<ArticleDocumentKind, ArticleWorkspaceFile>> = { ...previous?.files }
    let changed = previous === undefined
    for (const kind of Object.keys(DOCUMENT_NAMES) as ArticleDocumentKind[]) {
      const revisionId = article.currentDocuments[kind]
      if (revisionId === undefined) continue
      const document = this.ctx.articles.readDocument(agent, revisionId)
      const path = join(directory, DOCUMENT_NAMES[kind])
      assertChild(directory, path)
      const tracked = files[kind]
      const disk = await readOptional(path)
      if (tracked !== undefined) {
        assertTrackedPath(directory, kind, tracked)
        if (disk === undefined || digest(disk) !== tracked.digest) {
          throw new ArticleWorkspaceError(`${DOCUMENT_NAMES[kind]} contains an unsynchronized external edit`, 'ARTICLE_WORKSPACE_CONFLICT')
        }
      } else if (disk !== undefined && disk !== document.markdown) {
        throw new ArticleWorkspaceError(`${DOCUMENT_NAMES[kind]} already exists with unrelated content`, 'ARTICLE_WORKSPACE_CONFLICT')
      }
      const contentDigest = digest(document.markdown)
      if (disk !== document.markdown) {
        await writeFileAtomic(path, document.markdown, { mode: 0o600, dirMode: 0o700 })
        changed = true
      }
      if (tracked === undefined || tracked.baseRevisionId !== revisionId || tracked.digest !== contentDigest) changed = true
      files[kind] = { kind, path, baseRevisionId: revisionId, digest: contentDigest }
    }
    if (changed) {
      article = this.ctx.articles.updateWorkspace(agent, currentRef(article), {
        directory,
        files,
        updatedAt: Date.now(),
      })
    }
    return { article, changed }
  }

  /**
   * Import one externally edited file as a new immutable human revision.
   * @param agent - live Agent whose Session log owns the branch.
   * @param ref - compare-and-set branch revision expected by the caller.
   * @param kind - branch-local Markdown file to import.
   * @returns current article snapshot plus whether a new durable revision was saved.
   */
  async synchronize(agent: Agent, ref: ArticleRef, kind: ArticleDocumentKind): Promise<ArticleWorkspaceResult> {
    let article = this.requireRef(agent, ref)
    if (article.workspace === undefined) {
      article = (await this.materialize(agent, currentRef(article))).article
    }
    const workspace = article.workspace
    if (workspace === undefined) throw new ArticleWorkspaceError('article workspace initialization did not commit', 'ARTICLE_WORKSPACE_UNAVAILABLE')
    const tracked = workspace.files[kind]
    if (tracked === undefined) throw new ArticleWorkspaceError(`${DOCUMENT_NAMES[kind]} does not exist yet`, 'ARTICLE_WORKSPACE_UNAVAILABLE')
    assertTrackedPath(workspace.directory, kind, tracked)
    if (article.currentDocuments[kind] !== tracked.baseRevisionId) {
      throw new ArticleWorkspaceError(`${DOCUMENT_NAMES[kind]} is based on a different durable revision`, 'ARTICLE_WORKSPACE_CONFLICT')
    }
    const markdown = await readFile(tracked.path, 'utf8')
    const nextDigest = digest(markdown)
    if (nextDigest === tracked.digest) return { article, changed: false }
    article = this.ctx.articles.saveDocument(agent, currentRef(article), {
      kind,
      markdown,
      source: { kind: 'human-file' },
    })
    const nextFiles = {
      ...workspace.files,
      [kind]: { kind, path: tracked.path, baseRevisionId: article.currentDocuments[kind], digest: nextDigest },
    }
    article = this.ctx.articles.updateWorkspace(agent, currentRef(article), {
      ...workspace,
      files: nextFiles,
      updatedAt: Date.now(),
    })
    return { article, changed: true }
  }

  /**
   * Reject a state-changing file export or rollback while a tracked file is dirty.
   * @param agent - live Agent whose branch workspace should be checked.
   * @returns void when no tracked file has unsynchronized external edits.
   */
  async assertClean(agent: Agent): Promise<void> {
    const article = this.ctx.articles.get(agent)
    if (article?.workspace === undefined) return
    for (const [kind, tracked] of Object.entries(article.workspace.files) as [ArticleDocumentKind, ArticleWorkspaceFile][]) {
      assertTrackedPath(article.workspace.directory, kind, tracked)
      const disk = await readOptional(tracked.path)
      if (disk === undefined || digest(disk) !== tracked.digest) {
        throw new ArticleWorkspaceError(`${DOCUMENT_NAMES[kind]} contains an unsynchronized external edit`, 'ARTICLE_WORKSPACE_CONFLICT')
      }
    }
  }

  private requireRef(agent: Agent, ref: ArticleRef): ArticleSnapshot {
    const article = this.ctx.articles.get(agent)
    if (article === undefined) throw new ArticleWorkspaceError('the current session has no article branch', 'ARTICLE_WORKSPACE_UNAVAILABLE')
    if (article.branchId !== ref.branchId || article.revision !== ref.revision) {
      throw new ArticleWorkspaceError('the article workspace request used a stale revision', 'ARTICLE_WORKSPACE_CONFLICT')
    }
    return article
  }
}

function currentRef(article: ArticleSnapshot): ArticleRef {
  return { branchId: article.branchId, revision: article.revision }
}

function branchDirectory(agent: Agent, article: ArticleSnapshot): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined || !isAbsolute(cwd)) {
    throw new ArticleWorkspaceError('article Markdown files require a Session with an absolute cwd', 'ARTICLE_WORKSPACE_UNAVAILABLE')
  }
  for (const value of [article.treeId, article.branchId]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new ArticleWorkspaceError('article ids are unsafe as path segments', 'ARTICLE_WORKSPACE_INVALID_PATH')
  }
  return resolve(cwd, '.dsh', 'article', article.treeId, article.branchId)
}

function assertChild(directory: string, path: string): void {
  const child = relative(directory, resolve(path))
  if (child.startsWith('..') || isAbsolute(child)) {
    throw new ArticleWorkspaceError('article file escaped its branch directory', 'ARTICLE_WORKSPACE_INVALID_PATH')
  }
}

function assertTrackedPath(directory: string, kind: ArticleDocumentKind, file: ArticleWorkspaceFile): void {
  const expected = join(resolve(directory), DOCUMENT_NAMES[kind])
  assertChild(directory, file.path)
  if (resolve(file.path) !== expected || file.kind !== kind) {
    throw new ArticleWorkspaceError(`tracked ${kind} path is invalid`, 'ARTICLE_WORKSPACE_INVALID_PATH')
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    await stat(path)
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export default ArticleWorkspaceService
