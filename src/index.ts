/**
 * Host loader entry for the browser notification plugin. The Host half
 * reserves the `dsh-session-notification` settings namespace through the
 * settings seam (the plugin's own layer), keeping the name owned host-side
 * for forward compatibility. The browser half persists its preferences
 * browser-locally (localStorage), so the plugin needs no host namespace
 * exposure to work.
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
