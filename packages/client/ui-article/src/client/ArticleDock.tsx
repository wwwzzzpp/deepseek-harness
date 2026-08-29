import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ArticleBranchRequest,
  ArticleBranchRequestId,
  ArticleDocumentKind,
  ArticleDocumentSource,
  ArticleDocumentSummary,
  ArticleProjection,
  ArticleSnapshot,
  ArticleStage,
  DocumentRevisionId,
} from '@deepseek-ai/dsh-article/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ArticleKey } from './locales.ts'
import type { ArticleDockActions } from './slots.ts'
import css from './ArticleDock.module.css'

/** Full props of the article dock entry. */
export type ArticleDockProps =
  PropsRuntime<'conversation.input.dock'> &
  ArticleDockActions &
  PropsLocale<'article'>

const STAGES = ['idea', 'draft', 'review', 'final'] as const satisfies readonly ArticleStage[]

const STAGE_KEYS = {
  idea: 'stage.idea',
  draft: 'stage.draft',
  review: 'stage.review',
  final: 'stage.final',
} as const satisfies Record<ArticleStage, ArticleKey>

const DOCUMENT_KEYS = {
  material: 'document.material',
  draft: 'document.draft',
  review: 'document.review',
  final: 'document.final',
} as const satisfies Record<ArticleDocumentKind, ArticleKey>

const CURRENT_DOCUMENT_BY_STAGE = {
  idea: 'material',
  draft: 'draft',
  review: 'review',
  final: 'final',
} as const satisfies Record<ArticleStage, ArticleDocumentKind>

const EMPTY_TREE: ArticleTree = { roots: [], byBranch: {}, size: 0 }

interface ArticleTreeNode {
  readonly sessionId: SessionId
  readonly summary: SessionSummary
  readonly article: ArticleSnapshot
  readonly children: ArticleTreeNode[]
}

interface ArticleTree {
  readonly roots: readonly ArticleTreeNode[]
  readonly byBranch: Readonly<Record<string, ArticleTreeNode>>
  readonly size: number
}

/** Composer dock for root creation and article-branch workflow controls. */
export function ArticleDock(props: ArticleDockProps) {
  const {
    sessionId,
    useProjection,
    useSessions,
    t,
    onCreate,
    onNext,
    onApproveFinal,
    onOpenDocument,
    onSynchronize,
    onRequestChanges,
    onListDraftRevisions,
    onRollback,
    onCreateBranch,
    onConfirmBranch,
    onRetryBranch,
    onCancelBranch,
    onOpenSession,
  } = props

  const projection = useProjection('article')
  const sessions = useSessions(state => state)
  const running = sessions.byId[sessionId]?.running ?? false
  const pendingRef = useRef(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [createTitle, setCreateTitle] = useState('')
  const [createBranchName, setCreateBranchName] = useState('主线')
  const [branchOpen, setBranchOpen] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [branchIdea, setBranchIdea] = useState('')
  const [treeOpen, setTreeOpen] = useState(false)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [drafts, setDrafts] = useState<readonly ArticleDocumentSummary[] | null>(null)
  const [selectedDraft, setSelectedDraft] = useState('')
  const articleBranchId = projection?.article.branchId
  const branchTree = useMemo(() => {
    const article = projection?.article
    return article === undefined ? EMPTY_TREE : buildArticleTree(sessions, article.treeId)
  }, [projection?.article, sessions])

  useEffect(() => {
    setBranchOpen(false)
    setBranchName('')
    setBranchIdea('')
    setRollbackOpen(false)
    setDrafts(null)
    setSelectedDraft('')
    setActionError(null)
  }, [articleBranchId])

  const runAction = useCallback(async <T,>(
    name: string,
    action: () => Promise<RemoteResult<T>>,
    onSuccess?: (value: T) => void,
  ): Promise<RemoteResult<T> | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPendingAction(name)
    setActionError(null)
    try {
      const result = await action()
      if (result.ok) {
        onSuccess?.(result.value)
      } else {
        setActionError(`${result.error.message} (${result.error.code})`)
      }
      return result
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      return undefined
    } finally {
      pendingRef.current = false
      setPendingAction(null)
    }
  }, [])

  if (projection === undefined) {
    return (
      <section className={css.root} aria-label={t('title')}>
        <div className={css.body}>
          <Header title={t('title')} subtitle={t('loading')} />
        </div>
      </section>
    )
  }

  if (projection === null) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const title = createTitle.trim()
      if (title === '') return
      const name = createBranchName.trim() || '主线'
      void runAction('create', () => onCreate(title, name))
    }
    return (
      <section className={css.root} aria-label={t('title')}>
        <div className={css.body}>
          <Header title={t('empty.title')} subtitle={t('empty.desc')} />
          <form className={css.form} onSubmit={submit}>
            <label className={css.field}>
              <span className={css.label}>{t('field.title')}</span>
              <input
                className={css.input}
                value={createTitle}
                placeholder={t('field.title.placeholder')}
                onChange={(event) => { setCreateTitle(event.currentTarget.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('field.branchName')}</span>
              <input
                className={css.input}
                value={createBranchName}
                placeholder={t('field.branch.placeholder')}
                onChange={(event) => { setCreateBranchName(event.currentTarget.value) }}
              />
            </label>
            <div className={css.actions}>
              <button
                type="submit"
                className={`${css.button} ${css.primary}`}
                disabled={pendingAction !== null || createTitle.trim() === ''}
              >
                {t('action.create')}
              </button>
            </div>
            {actionError !== null && <div className={css.error}>{actionError}</div>}
          </form>
        </div>
      </section>
    )
  }

  const article = projection.article
  const currentKind = CURRENT_DOCUMENT_BY_STAGE[article.stage]
  const currentFile = article.workspace?.files[currentKind]
  const currentDocumentId = article.currentDocuments[currentKind]
  const path = branchPath(article, branchTree)
  const canRequestChanges = (article.stage === 'review' || article.stage === 'final') && article.currentDocuments.draft !== undefined
  const blocked = pendingAction !== null

  const loadDrafts = () => {
    void runAction('listDrafts', onListDraftRevisions, (value) => {
      setDrafts(value.revisions)
      setSelectedDraft(String(value.revisions[0]?.id ?? ''))
    })
  }

  const submitBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = branchName.trim()
    const idea = branchIdea.trim()
    if (name === '' || idea === '') return
    void runAction('createBranch', () => onCreateBranch(name, idea))
  }

  return (
    <section className={css.root} aria-label={t('title')} data-article-branch={article.branchId}>
      <div className={css.body}>
        <Header title={article.title} subtitle={path} />
        <div className={css.stages} aria-label={`${t('stage.current')} ${t(STAGE_KEYS[article.stage])} v${String(article.revision)}`}>
          {STAGES.map(stage => (
            <span key={stage} className={css.stage} data-active={stage === article.stage}>
              {t(STAGE_KEYS[stage])}
            </span>
          ))}
        </div>
        <div className={css.subtitle}>
          {t('stage.current')}：{t(STAGE_KEYS[article.stage])} v{String(article.revision)}
          {' · '}
          {t(DOCUMENT_KEYS[currentKind])} {shortId(currentDocumentId)}
        </div>
        <div className={css.actions}>
          {article.stage === 'review' ? (
            <button
              type="button"
              className={`${css.button} ${css.primary}`}
              disabled={blocked || running}
              onClick={() => { void runAction('approveFinal', onApproveFinal) }}
            >
              {t('action.approveFinal')}
            </button>
          ) : (
            <button
              type="button"
              className={`${css.button} ${css.primary}`}
              disabled={blocked || running || article.stage === 'final'}
              onClick={() => { void runAction('next', onNext) }}
            >
              {t('action.next')}
            </button>
          )}
          <button
            type="button"
            className={css.button}
            disabled={blocked || currentFile === undefined}
            onClick={() => { void runAction('open', () => onOpenDocument(currentKind)) }}
          >
            {t('action.open')}
          </button>
          <button
            type="button"
            className={css.button}
            disabled={blocked || running || currentFile === undefined}
            onClick={() => { void runAction('sync', () => onSynchronize(currentKind)) }}
          >
            {t('action.sync')}
          </button>
          <button
            type="button"
            className={css.button}
            disabled={blocked || running || article.currentDocuments.draft === undefined}
            onClick={() => {
              setRollbackOpen(open => !open)
              if (!rollbackOpen && drafts === null) loadDrafts()
            }}
          >
            {t('action.rollback')}
          </button>
          <button type="button" className={css.button} disabled={blocked} onClick={() => { setBranchOpen(open => !open) }}>
            {branchOpen ? t('action.close') : t('action.branch')}
          </button>
          <button type="button" className={css.button} onClick={() => { setTreeOpen(open => !open) }}>
            {treeOpen ? t('action.close') : t('action.tree')}
          </button>
          {article.parentSessionId !== undefined && (
            <button
              type="button"
              className={css.button}
              disabled={blocked}
              onClick={() => { void runAction('parent', () => onOpenSession(article.parentSessionId as SessionId)) }}
            >
              {t('action.parent')}
            </button>
          )}
        </div>
        {rollbackOpen && (
          <RollbackPanel
            article={article}
            drafts={drafts}
            selectedDraft={selectedDraft}
            pending={blocked}
            canRequestChanges={canRequestChanges}
            t={t}
            setSelectedDraft={setSelectedDraft}
            requestChanges={() => { void runAction('requestChanges', onRequestChanges) }}
            rollback={() => {
              if (selectedDraft !== '') void runAction('rollback', () => onRollback(selectedDraft as DocumentRevisionId))
            }}
          />
        )}
        {branchOpen && (
          <form className={css.form} onSubmit={submitBranch}>
            <dl className={css.details}>
              <dt>{t('branch.from')}</dt>
              <dd>{article.branchName}</dd>
              <dt>{t('branch.stage')}</dt>
              <dd>{t(STAGE_KEYS[article.stage])}</dd>
              <dt>{t('branch.document')}</dt>
              <dd>{shortId(currentDocumentId)}</dd>
            </dl>
            <label className={css.field}>
              <span className={css.label}>{t('field.branchName')}</span>
              <input
                className={css.input}
                value={branchName}
                placeholder={article.branchName}
                onChange={(event) => { setBranchName(event.currentTarget.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.label}>{t('field.idea')}</span>
              <textarea
                className={css.textarea}
                value={branchIdea}
                placeholder={t('field.idea.placeholder')}
                onChange={(event) => { setBranchIdea(event.currentTarget.value) }}
              />
            </label>
            <div className={css.notice}>
              {t('branch.files')}
              {' '}
              {t('branch.notice')}
            </div>
            <div className={css.actions}>
              <button
                type="submit"
                className={`${css.button} ${css.primary}`}
                disabled={blocked || branchName.trim() === '' || branchIdea.trim() === ''}
              >
                {t('action.branch')}
              </button>
              <button type="button" className={css.button} onClick={() => { setBranchOpen(false) }}>
                {t('action.cancel')}
              </button>
            </div>
          </form>
        )}
        {projection.latestBranchRequest !== undefined && (
          <BranchRequestPanel
            request={projection.latestBranchRequest}
            running={running}
            pending={blocked}
            t={t}
            confirm={(requestId) => { void runAction('confirmBranch', () => onConfirmBranch(requestId)) }}
            retry={(requestId) => { void runAction('retryBranch', () => onRetryBranch(requestId)) }}
            cancel={(requestId) => { void runAction('cancelBranch', () => onCancelBranch(requestId)) }}
            open={(target) => { void runAction('openChild', () => onOpenSession(target)) }}
          />
        )}
        {treeOpen && (
          <BranchTreePanel
            tree={branchTree}
            currentBranchId={article.branchId}
            currentSessionId={sessionId}
            t={t}
            open={(target) => { void runAction('openTreeNode', () => onOpenSession(target)) }}
          />
        )}
        {actionError !== null && <div className={css.error}>{actionError}</div>}
      </div>
    </section>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className={css.header}>
      <span className={css.glyph} aria-hidden>✦</span>
      <span className={css.titleBlock}>
        <span className={css.title}>{title}</span>
        <span className={css.subtitle}>{subtitle}</span>
      </span>
    </div>
  )
}

function RollbackPanel({
  article,
  drafts,
  selectedDraft,
  pending,
  canRequestChanges,
  t,
  setSelectedDraft,
  requestChanges,
  rollback,
}: {
  article: ArticleSnapshot
  drafts: readonly ArticleDocumentSummary[] | null
  selectedDraft: string
  pending: boolean
  canRequestChanges: boolean
  t: ArticleDockProps['t']
  setSelectedDraft: (value: string) => void
  requestChanges: () => void
  rollback: () => void
}) {
  return (
    <div className={css.notice}>
      <div className={css.row}>
        <button
          type="button"
          className={css.button}
          disabled={pending || !canRequestChanges}
          onClick={requestChanges}
        >
          {t('action.currentDraft')}
        </button>
        <span>{t(STAGE_KEYS[article.stage])} v{String(article.revision)}</span>
      </div>
      {drafts === null ? null : drafts.length === 0 ? (
        <div>{t('rollback.empty')}</div>
      ) : (
        <div className={css.form}>
          <select
            className={css.select}
            value={selectedDraft}
            onChange={(event) => { setSelectedDraft(event.currentTarget.value) }}
          >
            {drafts.map(draft => (
              <option key={draft.id} value={draft.id}>
                {shortId(draft.id)} · {formatTime(draft.createdAt)} · {sourceLabel(draft.source, t)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            disabled={pending || selectedDraft === ''}
            onClick={rollback}
          >
            {t('action.rollbackRevision')}
          </button>
        </div>
      )}
    </div>
  )
}

function BranchRequestPanel({
  request,
  running,
  pending,
  t,
  confirm,
  retry,
  cancel,
  open,
}: {
  request: ArticleBranchRequest
  running: boolean
  pending: boolean
  t: ArticleDockProps['t']
  confirm: (requestId: ArticleBranchRequestId) => void
  retry: (requestId: ArticleBranchRequestId) => void
  cancel: (requestId: ArticleBranchRequestId) => void
  open: (sessionId: SessionId) => void
}) {
  if (request.status === 'cancelled') return null
  return (
    <div className={css.notice}>
      <div>{branchRequestMessage(request, running, t)}</div>
      <dl className={css.details}>
        <dt>{t('field.branchName')}</dt>
        <dd>{request.branchName}</dd>
        <dt>{t('branch.stage')}</dt>
        <dd>{t(STAGE_KEYS[request.forkedFromStage])} v{String(request.forkedFromArticleRevision)}</dd>
        <dt>{t('branch.document')}</dt>
        <dd>{shortId(request.forkedFromDocumentRevisionId)}</dd>
      </dl>
      {request.error !== undefined && <div className={css.error}>{request.error}</div>}
      <div className={css.actions}>
        {request.status === 'draft' && !running && (
          <button type="button" className={`${css.button} ${css.primary}`} disabled={pending} onClick={() => { confirm(request.id) }}>
            {t('action.confirmBranch')}
          </button>
        )}
        {request.status === 'failed' && (
          <button type="button" className={`${css.button} ${css.primary}`} disabled={pending || running} onClick={() => { retry(request.id) }}>
            {t('action.retryBranch')}
          </button>
        )}
        {request.childSessionId !== undefined && (
          <button type="button" className={css.button} disabled={pending} onClick={() => { open(request.childSessionId as SessionId) }}>
            {t('action.openChild')}
          </button>
        )}
        {(request.status === 'draft' || request.status === 'failed') && (
          <button type="button" className={`${css.button} ${css.danger}`} disabled={pending} onClick={() => { cancel(request.id) }}>
            {t('action.cancelBranch')}
          </button>
        )}
      </div>
    </div>
  )
}

function BranchTreePanel({
  tree,
  currentBranchId,
  currentSessionId,
  t,
  open,
}: {
  tree: ArticleTree
  currentBranchId: ArticleSnapshot['branchId']
  currentSessionId: SessionId
  t: ArticleDockProps['t']
  open: (sessionId: SessionId) => void
}) {
  const onlyCurrent = tree.size <= 1
  return (
    <div className={css.tree}>
      {onlyCurrent && <div className={css.notice}>{t('tree.empty')}</div>}
      <ul className={css.treeList}>
        {tree.roots.map(node => (
          <BranchTreeNodeView
            key={node.article.branchId}
            node={node}
            currentBranchId={currentBranchId}
            currentSessionId={currentSessionId}
            t={t}
            open={open}
          />
        ))}
      </ul>
    </div>
  )
}

function BranchTreeNodeView({
  node,
  currentBranchId,
  currentSessionId,
  t,
  open,
}: {
  node: ArticleTreeNode
  currentBranchId: ArticleSnapshot['branchId']
  currentSessionId: SessionId
  t: ArticleDockProps['t']
  open: (sessionId: SessionId) => void
}) {
  const current = node.article.branchId === currentBranchId || node.sessionId === currentSessionId
  return (
    <li>
      <button type="button" className={css.treeRow} data-current={current} onClick={() => { open(node.sessionId) }}>
        <span>
          <span className={css.treeName}>{node.article.branchName}</span>
          <span className={css.treeMeta}>
            {t(STAGE_KEYS[node.article.stage])} v{String(node.article.revision)}
            {' · '}
            {formatTime(node.article.createdAt)}
            {' · '}
            {t('tree.external')}
          </span>
        </span>
        <span className={css.treeTags}>
          {current && <span className={css.tag}>{t('tree.current')}</span>}
          {node.summary.running && <span className={css.tag}>{t('tree.running')}</span>}
        </span>
      </button>
      {node.children.length > 0 && (
        <ul className={css.treeChildren}>
          {node.children.map(child => (
            <BranchTreeNodeView
              key={child.article.branchId}
              node={child}
              currentBranchId={currentBranchId}
              currentSessionId={currentSessionId}
              t={t}
              open={open}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function branchRequestMessage(request: ArticleBranchRequest, running: boolean, t: ArticleDockProps['t']): string {
  switch (request.status) {
    case 'draft':
      return running ? t('request.draft') : t('request.draft.ready')
    case 'creating':
      return t('request.creating')
    case 'ready':
      return t('request.ready')
    case 'failed':
      return t('request.failed')
    case 'cancelled':
      return ''
    default:
      return assertNever(request.status)
  }
}

function buildArticleTree(sessions: SessionListState, treeId: ArticleSnapshot['treeId']): ArticleTree {
  const byBranch: Record<string, ArticleTreeNode> = {}
  for (const summary of Object.values(sessions.byId)) {
    const projection = articleProjection(summary)
    if (projection === undefined || projection.article.treeId !== treeId) continue
    const article = projection.article
    byBranch[article.branchId] = { sessionId: summary.id, summary, article, children: [] }
  }
  const roots: ArticleTreeNode[] = []
  for (const node of Object.values(byBranch)) {
    const parent = node.article.parentBranchId === undefined ? undefined : byBranch[node.article.parentBranchId]
    if (parent === undefined) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  }
  sortNodes(roots)
  return { roots, byBranch, size: Object.keys(byBranch).length }
}

function articleProjection(summary: SessionSummary): ArticleProjection | undefined {
  const projection = summary.projectionValues?.article
  return projection === null || projection === undefined ? undefined : projection
}

function sortNodes(nodes: ArticleTreeNode[]): void {
  nodes.sort((a, b) => a.article.createdAt - b.article.createdAt)
  for (const node of nodes) sortNodes(node.children)
}

function branchPath(article: ArticleSnapshot, tree: ArticleTree): string {
  const names: string[] = []
  let cursor: ArticleSnapshot | undefined = article
  for (let guard = 0; cursor !== undefined && guard < 32; guard++) {
    names.unshift(cursor.branchName)
    if (cursor.parentBranchId === undefined) break
    cursor = tree.byBranch[cursor.parentBranchId]?.article
    if (cursor === undefined) names.unshift('…')
  }
  return names.join(' / ')
}

function sourceLabel(source: ArticleDocumentSource, t: ArticleDockProps['t']): string {
  switch (source.kind) {
    case 'agent':
      return t('source.agent')
    case 'human-file':
      return t('source.human-file')
    case 'plugin':
      return t('source.plugin')
    case 'branch-seed':
      return t('source.branch-seed')
    default:
      return assertNever(source)
  }
}

function shortId(value: string | undefined): string {
  if (value === undefined) return '—'
  return value.length > 26 ? `${value.slice(0, 16)}…${value.slice(-6)}` : value
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function assertNever(value: never): never {
  throw new Error(`unreachable article value: ${String(value)}`)
}
