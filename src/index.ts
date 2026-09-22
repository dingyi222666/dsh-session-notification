/**
 * Host loader entry for the browser notification plugin.
 *
 * dsh 0.1.7-alpha.1 replaced the plugin-registered settings namespace
 * (`ctx.settings.register(ns, schema)`) with schema-derived configuration
 * forms over the profile patch document, and this plugin's preferences are
 * browser-local (localStorage), so the host half has no registration to make:
 * the browser half runs on its own against the harness services. The exported
 * `NotificationSettingsSchema` stays available for a future host-config
 * adoption.
 */
import type { Context } from '@deepseek-ai/cordis'

export { NOTIFICATIONS_NS } from './settings.ts'
export type { NotificationSettings, NotificationTypeSettings, NotificationType, SoundId } from './settings.ts'
export { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_TYPES, SOUND_IDS, resolveNotificationSettings } from './settings.ts'
export { NotificationSettingsSchema } from './schema.ts'

/**
 * Inert host half: the settings namespace is no longer reserved through the
 * settings service (0.1.7 derives plugin config forms from Loader entries),
 * and nothing else runs host-side.
 * @param _ctx - Host context (unused).
 */
export function apply(_ctx: Context): void {}
