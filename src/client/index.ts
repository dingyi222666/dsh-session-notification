/**
 * Notification plugin, browser half: the Notifications settings section and
 * the event-driven notification engine. The engine watches the sessions list
 * for running and pending-interaction edges, classifies finished runs as
 * completed or failed from the session's conversation snapshot, and hands
 * events to a dispatcher that plays the kind's sound and shows a system
 * notification when browser notifications are enabled.
 *
 * The settings section follows the official row pattern (ui-theme): the
 * store declared at register is owned by the slot renderer, which hands its
 * bound actions to the inject factory; the apply world never creates a
 * second instance. The scope is the source of truth for reads (dispatcher,
 * engine) and writes; the bound actions mirror scope snapshots into the
 * renderer's store.
 *
 * Preferences are browser-local (localStorage, `createLocalSettingsScope`):
 * the plugin owns its namespace end to end and needs no host-side settings
 * exposure, so it runs against a pristine harness without touching
 * `packages/host/apiproxy` or any other host package.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings surface's slot-name augmentation, which types the
// `settings.section` seat this plugin registers (a side effect of importing
// the face is the ctx.settingsScope Context merge, which the plugin no
// longer uses — preferences are browser-local).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { NotificationSettings, NotificationType, SoundId } from '../settings.ts'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../settings.ts'
import { createLocalSettingsScope } from './local-settings.ts'
import { SoundPlayer } from './sounds.ts'
import { browserPermission, requestBrowserPermission, showBrowserNotification } from './browser-notify.ts'
import { MAX_CUSTOM_AUDIO_BYTES, readCustomSound, readFileAsDataUrl, writeCustomSound } from './custom-audio.ts'
import {
  NotificationDispatcher, NotificationEngine, sessionDetailOf,
} from './notification-service.ts'
import { createNotificationsStore } from './settings-store.ts'
import {
  NotificationsSection, type NotificationsSectionInjected,
} from './NotificationsSection.tsx'
import { en, zh, type NotificationsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Notifications settings section's copy. */
    'notifications': NotificationsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'notifications'

/** How long a finished run waits for trailing wire frames before classification. */
const SETTLE_MS = 250

/** Required services: the slot registry, dictionaries, and the session list. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: bind the browser-local preferences scope, register the
 * Notifications section, and watch the sessions list for notification events.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-notification: dictionaries')

  const scope = createLocalSettingsScope()
  const store = createNotificationsStore()
  let bound: BoundActions<typeof store> | undefined

  const currentSettings = (): NotificationSettings => {
    const snapshot = scope.getSnapshot()
    return snapshot.status === 'ready' && snapshot.value !== undefined
      ? snapshot.value
      : DEFAULT_NOTIFICATION_SETTINGS
  }

  // Scope → renderer store mirror. The renderer binds its own store instance
  // and hands it to the inject factory; until the section mounts, adopt is a
  // no-op (the inject factory performs the first sync on mount).
  ctx.effect(() => scope.subscribe(() => { bound?.adopt(scope.getSnapshot()) }), 'dsh-session-notification: scope adoption')

  const player = new SoundPlayer(() => currentSettings().volume)
  const t = ctx.locale.bind(NS)
  const translate = (key: string): string => t(key as NotificationsKey)
  /** Play the effective sound: a custom audio when one is supplied, else the built-in. */
  const playEffective = (sound: SoundId, customUrl?: string): void => {
    if (sound === 'custom' && customUrl !== undefined) player.playCustom(customUrl)
    else player.play(sound)
  }

  const dispatcher = new NotificationDispatcher({
    settings: currentSettings,
    t: translate,
    playSound: (sound, customUrl) => { playEffective(sound, customUrl) },
    customSoundOf: (kind) => readCustomSound(kind),
    showBrowser: (title, body) => showBrowserNotification(title, body),
    currentSession: () => ctx.sessions.list.getSnapshot().current,
    isHidden: () => (typeof document === 'undefined' ? false : document.visibilityState === 'hidden'),
  })

  const engine = new NotificationEngine({
    detailOf: (id: SessionId) => {
      const binding = ctx.sessions.binding(id)
      return binding === undefined ? undefined : sessionDetailOf(binding.session.getSnapshot())
    },
    titleOf: (id: SessionId) => ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? id,
    settle: () => new Promise(resolve => setTimeout(resolve, SETTLE_MS)),
    emit: (event) => { dispatcher.dispatch(event) },
  })
  ctx.effect(() => {
    const unsubscribe = ctx.sessions.list.subscribe(() => engine.observe(ctx.sessions.list.getSnapshot()))
    // Establish the baseline so pre-existing state raises nothing.
    engine.seed(ctx.sessions.list.getSnapshot())
    return unsubscribe
  }, 'dsh-session-notification: session watch')

  /** Persist one top-level preference through the scope, mirroring optimistically. */
  const persist = (field: 'browserEnabled' | 'notifyCurrent' | 'soundEnabled' | 'volume', value: unknown): void => {
    if (field === 'browserEnabled') bound?.setBrowserEnabled(value as boolean)
    else if (field === 'notifyCurrent') bound?.setNotifyCurrent(value as boolean)
    else if (field === 'soundEnabled') bound?.setSoundEnabled(value as boolean)
    else bound?.setVolume(value as number)
    void scope.set(field, value)
  }

  /** Persist one per-kind preference (the whole `types` section is one field). */
  const persistType = (kind: NotificationType, patch: Partial<{ enabled: boolean; sound: SoundId }>): void => {
    const next = { ...currentSettings().types[kind], ...patch }
    bound?.setType(kind, patch)
    void scope.set('types', { ...currentSettings().types, [kind]: next })
  }

  const injected = (actions: BoundActions<typeof store>): NotificationsSectionInjected => {
    bound = actions
    // First sync on mount: push the accepted scope value into the renderer's store.
    bound.adopt(scope.getSnapshot())
    return {
      setBrowserEnabled: async (enabled) => {
        if (enabled) {
          let permission = browserPermission()
          if (permission === 'default') {
            permission = await requestBrowserPermission()
            bound?.setPermission(permission)
          }
          if (permission !== 'granted') return
        }
        persist('browserEnabled', enabled)
      },
      setNotifyCurrent: (enabled) => { persist('notifyCurrent', enabled) },
      setSoundEnabled: (enabled) => { persist('soundEnabled', enabled) },
      setVolume: (volume) => { persist('volume', Math.min(1, Math.max(0, volume))) },
      setType: (kind, patch) => { persistType(kind, patch) },
      testSound: (sound, customUrl) => { playEffective(sound, customUrl) },
      requestPermission: async () => {
        bound?.setPermission(await requestBrowserPermission())
      },
      testBrowserNotification: () => {
        showBrowserNotification(t('test.notification.title'), t('test.notification.body'))
      },
      uploadCustomSound: async (kind, file) => {
        if (file.size > MAX_CUSTOM_AUDIO_BYTES) return
        const dataUrl = await readFileAsDataUrl(file)
        writeCustomSound(kind, dataUrl)
        bound?.setCustomSound(kind, dataUrl)
        // Uploading from the 自定义 picker selection persists the selection too.
        persistType(kind, { sound: 'custom' })
      },
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'notifications',
    order: 40,
    label: () => t('nav'),
    store,
    locale: NS,
    inject: injected,
  }, NotificationsSection))
}
