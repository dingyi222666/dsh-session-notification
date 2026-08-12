/**
 * Browser-local preferences scope for the notification plugin.
 *
 * The notification preferences are owned end to end by this plugin and
 * persist in the browser (localStorage), so the plugin works against a
 * pristine harness — no host-side settings-namespace exposure, no change to
 * `packages/host/apiproxy` or any other host package. The scope implements
 * the runtime `SettingsScope` contract (snapshot + subscribe + set/unset) so
 * the apply world and the section store keep working unchanged; reads resolve
 * through the same `resolveNotificationSettings` decoder the host document
 * path used, so hand-edited or malformed storage degrades to the defaults.
 */
import type {
  SettingsScope, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_NS, resolveNotificationSettings,
  type NotificationSettings,
} from '../settings.ts'

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
export function createLocalSettingsScope(): SettingsScope<NotificationSettings> {
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  let value: NotificationSettings = resolveNotificationSettings(
    parseStored(storage()?.getItem(LOCAL_STORAGE_KEY) ?? null),
  )
  let revision = 1

  const snapshot = (): SettingsScopeSnapshot<NotificationSettings> => ({
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
    async set(field: string, fieldValue: unknown): Promise<void> {
      commit(resolveNotificationSettings({ ...value, [field]: fieldValue }), true)
    },
    async unset(field: string): Promise<void> {
      const fallback = (DEFAULT_NOTIFICATION_SETTINGS as unknown as Record<string, unknown>)[field]
      commit(resolveNotificationSettings({ ...value, [field]: fallback }), true)
    },
  }
}
