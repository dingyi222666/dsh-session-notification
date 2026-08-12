/**
 * Package-owned invariant companion for `dsh-session-notification`.
 * @module dsh-session-notification/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
// Type-only: pulls the invariants package's cordis Context merge (ctx.invariants).
import type {} from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-session-notification'

/** Cordis companion plugin name. */
export const name = 'dsh-session-notification-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer client plugin — it emits no cordis
 * events and owns no mutable cross-plugin state; its settings-namespace
 * registration is a plain effect whose disposal the settings service's own
 * specs and this package's behavior specs observe directly.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
