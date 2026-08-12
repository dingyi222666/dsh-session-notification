/**
 * Schemastery wire schema for the `dsh-session-notification` settings namespace.
 * Host-half only: the browser scope validates against the serialized wire
 * schema served by the Host, never this module. The schema types the
 * PERSISTED shape — `sound` never stores `custom` (custom audio is resolved
 * at dispatch time from browser-local storage).
 */
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_TYPES, SOUND_IDS,
  type NotificationSettings, type NotificationType,
} from './settings.ts'

/** Persisted sound choices: the four built-ins, `custom`, and `none`. */
type PersistedSound = typeof SOUND_IDS[number] | 'custom' | 'none'

/** Persisted per-kind settings (the transient custom audio is stored browser-locally). */
type PersistedTypeSettings = { enabled: boolean; sound: PersistedSound }

/** Persisted section shape, narrowing {@link NotificationSettings}. */
export type PersistedNotificationSettings = Omit<NotificationSettings, 'types'> & {
  types: Record<NotificationType, PersistedTypeSettings>
}

const SOUND_UNION = z.union([...SOUND_IDS, 'custom', 'none'])

const typeSchema: z<PersistedTypeSettings> = z.object({
  enabled: z.boolean().default(true),
  sound: SOUND_UNION.default('none'),
})

/** Durable notification-preferences schema shared by the settings seam. */
export const NotificationSettingsSchema: z<PersistedNotificationSettings> = z.object({
  browserEnabled: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.browserEnabled),
  notifyCurrent: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.notifyCurrent),
  soundEnabled: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.soundEnabled),
  volume: z.number().min(0).max(1).default(DEFAULT_NOTIFICATION_SETTINGS.volume),
  types: z.object({
    [NOTIFICATION_TYPES[0]]: typeSchema,
    [NOTIFICATION_TYPES[1]]: typeSchema,
    [NOTIFICATION_TYPES[2]]: typeSchema,
    [NOTIFICATION_TYPES[3]]: typeSchema,
  }).default({
    completed: { enabled: true, sound: 'chime' },
    failed: { enabled: true, sound: 'fault' },
    question: { enabled: true, sound: 'pop' },
    permission: { enabled: true, sound: 'alert' },
  }),
})
