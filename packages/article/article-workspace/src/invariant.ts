/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-article-workspace`.
 * @module @deepseek-ai/dsh-article-workspace/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-article-workspace'

/** Cordis companion plugin name. */
export const name = 'article-workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the durable workspace snapshot is validated
 * by `@deepseek-ai/dsh-article`; this package owns host filesystem effects
 * that are checked synchronously before each materialization or import.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
