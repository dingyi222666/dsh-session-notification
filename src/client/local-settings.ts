/**
 * Browser-local preferences scope for the notification plugin.
 *
 * The notification preferences are owned end to end by this plugin and
 * persist in the browser (localStorage), so the plugin works against a
 * pristine harness — no host-side settings-namespace exposure, no change to
 * `packages/host/apiproxy` or any other host package. dsh 0.1.7-alpha.1
 * renamed the client settings contract to `ConfigForm` (schema-derived plugin
 * config forms over the profile patch); this scope implements that official
 * contract over localStorage, so nothing else in the plugin depends on the
 * host settings transport. Reads resolve through the same
 * `resolveNotificationSettings` decoder the host document path used, so
 * hand-edited or malformed storage degrades to the defaults.
 */
// The official client settings-form contract (0.1.7 renamed SettingsScope to
// ConfigForm; the write methods now settle with a boolean).
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
// The mutation op shape the contract carries (dsh-settings owns the wire view).
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import {
  DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_NS, resolveNotificationSettings,
  type NotificationSettings,
} from '../settings.ts'

/** Re-exported for the section store (the official 0.1.7 form snapshot). */
export type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** localStorage key holding the whole preferences section. */
export const LOCAL_STORAGE_KEY = `${NOTIFICATIONS_NS}:preferences`

/** Read the browser storage when present (absent in Node/SSR). */
function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    // Access denied (e.g. privacy mode) — the scope still works in memory.
    return undefined
  }
}

/** Parse one stored section; anything malformed resolves to the defaults. */
function parseStored(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/**
 * Create the browser-local scope.
 * @returns a scope whose snapshot is `ready` immediately, backed by
 * localStorage when available and by memory otherwise.
 */
export function createLocalSettingsScope(): ConfigForm<NotificationSettings> {
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  let value: NotificationSettings = resolveNotificationSettings(
    parseStored(storage()?.getItem(LOCAL_STORAGE_KEY) ?? null),
  )
  let revision = 1

  const snapshot = (): ConfigFormSnapshot<NotificationSettings> => ({
    status: 'ready',
    value,
    base: DEFAULT_NOTIFICATION_SETTINGS,
    user: undefined,
    revision,
    writable: true,
    mode: 'memory',
  })

  const commit = (next: NotificationSettings, persist: boolean): void => {
    value = next
    revision += 1
    if (persist) {
      try {
        storage()?.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Quota/access errors keep the in-memory value; nothing else to do.
      }
    }
    notify()
  }

  // Writes from other tabs arrive through the browser storage event, keeping
  // the "sync across tabs" behavior the host-document path used to provide.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== LOCAL_STORAGE_KEY) return
      commit(resolveNotificationSettings(parseStored(event.newValue)), false)
    })
  }

  return {
    getSnapshot: snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    // The local scope is its own document: fold every op over the stored
    // value (deep set/unset), then validate through the same decoder as any
    // other write so malformed payloads degrade to the defaults.
    async mutate(ops: readonly SettingsPathOpView[], _expectedRevision?: number): Promise<boolean> {
      const next = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
      for (const op of ops) {
        if (op.path.length === 0) {
          // The empty path addresses the section root.
          if (op.op === 'set') {
            for (const key of Object.keys(next)) delete next[key]
            Object.assign(next, op.value)
          }
          continue
        }
        if (op.op === 'set') deepSet(next, op.path, op.value)
        else deepUnset(next, op.path)
      }
      commit(resolveNotificationSettings(next), true)
      return true
    },
    async set(field: string, fieldValue: unknown): Promise<boolean> {
      commit(resolveNotificationSettings({ ...value, [field]: fieldValue }), true)
      return true
    },
    async unset(field: string): Promise<boolean> {
      const fallback = (DEFAULT_NOTIFICATION_SETTINGS as unknown as Record<string, unknown>)[field]
      commit(resolveNotificationSettings({ ...value, [field]: fallback }), true)
      return true
    },
  }
}

/** Walk one path and assign the value at its end (creating intermediates). */
function deepSet(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor: unknown = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]
    const next = (cursor as Record<string, unknown>)[segment]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      const created: Record<string, unknown> = {}
      ;(cursor as Record<string, unknown>)[segment] = created
      cursor = created
    } else {
      cursor = next
    }
  }
  ;(cursor as Record<string, unknown>)[path[path.length - 1]] = value
}

/** Walk one path and delete the value at its end (no-op when absent). */
function deepUnset(root: Record<string, unknown>, path: readonly string[]): void {
  let cursor: unknown = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const next = (cursor as Record<string, unknown>)[path[index]]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) return
    cursor = next
  }
  delete (cursor as Record<string, unknown>)[path[path.length - 1]]
}
