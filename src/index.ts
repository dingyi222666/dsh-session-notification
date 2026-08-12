/**
 * Host loader entry for the browser notification plugin. The Host half owns
 * one contribution: the durable `dsh-session-notification` settings namespace, so
 * the browser settings section reads and writes through the user-settings
 * document instead of a browser-local store.
 */
import type { Context } from '@deepseek-ai/cordis'
// Value import: the settings namespace brand. The module's Context merge
// (ctx.settings) rides the same import.
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { NOTIFICATIONS_NS } from './settings.ts'
import { NotificationSettingsSchema } from './schema.ts'

export { NOTIFICATIONS_NS } from './settings.ts'
export type { NotificationSettings, NotificationTypeSettings, NotificationType, SoundId } from './settings.ts'
export { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_TYPES, SOUND_IDS, resolveNotificationSettings } from './settings.ts'
export { NotificationSettingsSchema } from './schema.ts'

/**
 * Register the durable notification section when the settings service is
 * composed (the web profile always composes it). Absent the service the
 * browser half still runs, falling back to its defaults.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(settingsNamespace(NOTIFICATIONS_NS), NotificationSettingsSchema)
  })
}
