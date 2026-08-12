/**
 * Durable notification preferences shared by the Host schema and the browser
 * scope. This module is deliberately free of schemastery so the browser half
 * and the test suite can import it without a Host dependency; the schemastery
 * wire schema lives in `schema.ts` (Host half only).
 */

/** Settings namespace owned by the notification plugin. */
export const NOTIFICATIONS_NS = 'dsh-session-notification'

/** The four notification kinds the plugin can raise. */
export const NOTIFICATION_TYPES = ['completed', 'failed', 'question', 'permission'] as const

/** One selectable notification kind. */
export type NotificationType = typeof NOTIFICATION_TYPES[number]

/**
 * The four built-in sound effects. Each notification kind defaults to one of
 * them and can be reassigned to any other (or to `none`).
 */
export const SOUND_IDS = ['chime', 'fault', 'pop', 'alert'] as const

/** A selectable sound effect; `none` mutes the kind, `custom` plays the
 *  kind's uploaded audio (resolved at dispatch time, never persisted). */
export type SoundId = typeof SOUND_IDS[number] | 'none' | 'custom'

/** Per-kind preference: whether the kind notifies and which sound it plays. */
export interface NotificationTypeSettings {
  /** Whether this kind raises notifications at all. */
  enabled: boolean
  /** Sound played for this kind; `none` plays nothing. */
  sound: SoundId
}

/** Durable notification preferences. */
export interface NotificationSettings {
  /** Master switch for browser (OS-level) notifications. */
  browserEnabled: boolean
  /** Whether events from the session you are currently reading also alert. */
  notifyCurrent: boolean
  /** Master switch for sound playback. */
  soundEnabled: boolean
  /** Master playback volume in [0, 1]. */
  volume: number
  /** Per-kind preferences. */
  types: Record<NotificationType, NotificationTypeSettings>
}

/** Default preferences applied when the user document holds no override. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  // Browser notifications default OFF: showing them requires the user to
  // grant the browser permission first (the settings toggle does that).
  browserEnabled: false,
  // The session you are reading stays quiet by default; the toggle opts into
  // being alerted there too.
  notifyCurrent: false,
  soundEnabled: true,
  volume: 0.6,
  types: Object.freeze({
    completed: Object.freeze({ enabled: true, sound: 'chime' }),
    failed: Object.freeze({ enabled: true, sound: 'fault' }),
    question: Object.freeze({ enabled: true, sound: 'pop' }),
    permission: Object.freeze({ enabled: true, sound: 'alert' }),
  }),
})

/** Default sound per notification kind (the "default four sound effects"). */
export const DEFAULT_SOUND: Record<NotificationType, SoundId> = Object.freeze({
  completed: 'chime',
  failed: 'fault',
  question: 'pop',
  permission: 'alert',
})

/**
 * Narrow one candidate to a sound id.
 * @param value - value crossing the settings or wire boundary.
 * @returns whether the value is a selectable sound id.
 */
export function isSoundId(value: unknown): value is SoundId {
  return value === 'none' || value === 'custom' || SOUND_IDS.some(sound => sound === value)
}

/**
 * Narrow one candidate to a notification kind.
 * @param value - value crossing the settings or wire boundary.
 * @returns whether the value is a notification kind.
 */
export function isNotificationType(value: unknown): value is NotificationType {
  return NOTIFICATION_TYPES.some(kind => kind === value)
}

/**
 * Merge an unknown wire section over the defaults, dropping malformed fields
 * so a hand-edited user document degrades to the default rather than to a
 * broken player configuration.
 * @param raw - the raw user-layer section (or undefined when absent).
 * @returns a complete, valid settings object.
 */
export function resolveNotificationSettings(raw: unknown): NotificationSettings {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const typeConfig = (kind: NotificationType): NotificationTypeSettings => {
    const entry = source.types
    const own = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)[kind] : undefined
    const config = typeof own === 'object' && own !== null && !Array.isArray(own)
      ? own as Record<string, unknown> : {}
    return {
      enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
      sound: isSoundId(config.sound) ? config.sound : DEFAULT_SOUND[kind],
    }
  }
  const volume = typeof source.volume === 'number' && Number.isFinite(source.volume)
    ? Math.min(1, Math.max(0, source.volume)) : DEFAULT_NOTIFICATION_SETTINGS.volume
  return {
    browserEnabled: typeof source.browserEnabled === 'boolean'
      ? source.browserEnabled : DEFAULT_NOTIFICATION_SETTINGS.browserEnabled,
    notifyCurrent: typeof source.notifyCurrent === 'boolean'
      ? source.notifyCurrent : DEFAULT_NOTIFICATION_SETTINGS.notifyCurrent,
    soundEnabled: typeof source.soundEnabled === 'boolean'
      ? source.soundEnabled : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
    volume,
    types: {
      completed: typeConfig('completed'),
      failed: typeConfig('failed'),
      question: typeConfig('question'),
      permission: typeConfig('permission'),
    },
  }
}
