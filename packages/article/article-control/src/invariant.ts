/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-article-control`.
 * @module @deepseek-ai/dsh-article-control/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-article-control'

/** Cordis companion plugin name. */
export const name = 'article-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: human actions append durable article/action
 * and article/branch-change facts that `@deepseek-ai/dsh-article` validates.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
