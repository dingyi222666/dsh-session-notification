/**
 * Browser `Notification` API wrapper. Every call is guarded so non-browser
 * or permission-less environments degrade to a no-op instead of throwing.
 */

/** Notification permission state, with `unsupported` for non-browser runs. */
export type BrowserPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/** The current notification permission state. */
export function browserPermission(): BrowserPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * Request notification permission. A 'default' state triggers the browser's
 * permission prompt — call from a user gesture (the settings toggle click).
 * @returns the resulting permission state.
 */
export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  return permission
}

/**
 * Show one system notification. Notifications are tagged so a burst of the
 * same event collapses into a single OS-level card.
 * @param title - notification title.
 * @param body - notification body.
 * @returns whether a notification was actually shown.
 */
export function showBrowserNotification(title: string, body: string): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    const notification = new Notification(title, { body, tag: 'dsh-session-notification' })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch (_notificationRejected) {
    return false
  }
}
