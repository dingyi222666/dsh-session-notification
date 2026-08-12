/**
 * Notifications settings section store: a mirror of the plugin's
 * browser-local preferences scope, plus the write actions the section's
 * inject face exposes. The slot renderer owns the store instance and hands
 * its bound actions to the inject factory (the ui-theme row pattern); the
 * apply world syncs accepted scope snapshots through those actions. Component
 * reads go through `useStore`.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings, type NotificationType, type NotificationTypeSettings,
} from '../settings.ts'
import { browserPermission, type BrowserPermission } from './browser-notify.ts'
import { readCustomSounds, withCustomSound, type CustomSounds } from './custom-audio.ts'

export type { BrowserPermission } from './browser-notify.ts'

/** Store state mirrored from the preferences scope. */
export interface NotificationsState {
  /** Scope readiness (`unavailable` = no accepted snapshot — defaults apply). */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the preferences accept writes. */
  writable: boolean
  /** Current durable preferences. */
  settings: NotificationSettings
  /** Browser notification permission (updated after user-gesture requests). */
  permission: BrowserPermission
  /** Per-kind custom sound data URLs (browser-local; override the built-ins). */
  customSounds: CustomSounds
}

/** Declared action shape giving the exported factory a stable return type. */
type NotificationsActions = {
  adopt: (draft: NotificationsState, snapshot: SettingsScopeSnapshot<NotificationSettings>) => void
  setBrowserEnabled: (draft: NotificationsState, enabled: boolean) => void
  setNotifyCurrent: (draft: NotificationsState, enabled: boolean) => void
  setSoundEnabled: (draft: NotificationsState, enabled: boolean) => void
  setVolume: (draft: NotificationsState, volume: number) => void
  setType: (draft: NotificationsState, kind: NotificationType, patch: Partial<NotificationTypeSettings>) => void
  setPermission: (draft: NotificationsState, permission: BrowserPermission) => void
  setCustomSound: (draft: NotificationsState, kind: NotificationType, dataUrl: string | null) => void
}

/**
 * Declares the Notifications section state and write surface.
 * @returns the store handle.
 */
export function createNotificationsStore(): EngineStoreHandle<NotificationsState, NotificationsActions> {
  return defineStore({
    init: (): NotificationsState => ({
      status: 'loading',
      writable: false,
      settings: DEFAULT_NOTIFICATION_SETTINGS,
      permission: browserPermission(),
      customSounds: readCustomSounds(),
    }),
    actions: {
      adopt: (draft, snapshot) => {
        draft.status = snapshot.status
        draft.writable = snapshot.writable
        // Unavailable or still-loading keeps the last accepted settings
        // (defaults initially), so the section never blanks out.
        if (snapshot.status === 'ready' && snapshot.value !== undefined) {
          draft.settings = snapshot.value
        }
      },
      setBrowserEnabled: (draft, enabled) => {
        draft.settings = { ...draft.settings, browserEnabled: enabled }
      },
      setNotifyCurrent: (draft, enabled) => {
        draft.settings = { ...draft.settings, notifyCurrent: enabled }
      },
      setSoundEnabled: (draft, enabled) => {
        draft.settings = { ...draft.settings, soundEnabled: enabled }
      },
      setVolume: (draft, volume) => {
        draft.settings = { ...draft.settings, volume }
      },
      setType: (draft, kind, patch) => {
        draft.settings = {
          ...draft.settings,
          types: { ...draft.settings.types, [kind]: { ...draft.settings.types[kind], ...patch } },
        }
      },
      setPermission: (draft, permission) => {
        draft.permission = permission
      },
      setCustomSound: (draft, kind, dataUrl) => {
        draft.customSounds = withCustomSound(draft.customSounds, kind, dataUrl)
      },
    },
  })
}
