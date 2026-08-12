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
 * Resolve the current page's own icon (favicon) as an absolute URL, preferring
 * the largest declared one (`apple-touch-icon` over `rel=icon`). `link.href`
 * is the resolved absolute URL, so relative favicon paths need no base work.
 * @returns the icon URL, or undefined when the page declares none.
 */
function pageIconUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const appleTouch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
  if (appleTouch !== null && appleTouch.href.length > 0) return appleTouch.href
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (icon !== null && icon.href.length > 0) return icon.href
  return undefined
}

/**
 * Show one system notification, carrying the page's own icon (favicon).
 * Notifications are tagged so a burst of the same event collapses into a
 * single OS-level card. Suppressed notifications log the reason (missing API,
 * missing permission, constructor failure) so a silent "no notification" is
 * diagnosable from the console instead of being swallowed; an icon the
 * browser cannot rasterize falls back to an icon-less notification rather
 * than dropping the alert.
 * @param title - notification title.
 * @param body - notification body.
 * @returns whether a notification was actually shown.
 */
export function showBrowserNotification(title: string, body: string): boolean {
  if (typeof Notification === 'undefined') {
    console.warn('[dsh-session-notification] browser Notification API is unavailable (insecure context or unsupported browser)')
    return false
  }
  if (Notification.permission !== 'granted') {
    console.warn(`[dsh-session-notification] browser notification suppressed: permission is "${Notification.permission}"`)
    return false
  }
  const icon = pageIconUrl()
  try {
    const notification = new Notification(title, {
      body,
      tag: 'dsh-session-notification',
      ...(icon === undefined ? {} : { icon }),
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch (error) {
    // A page icon the browser cannot rasterize must not kill the alert:
    // retry once without it, then report.
    if (icon !== undefined) {
      try {
        const notification = new Notification(title, { body, tag: 'dsh-session-notification' })
        notification.onclick = () => {
          window.focus()
          notification.close()
        }
        console.warn('[dsh-session-notification] page icon was rejected; notification shown without it', error)
        return true
      } catch (_secondFailure) {
        console.warn('[dsh-session-notification] Notification constructor failed; check the browser/OS notification settings', _secondFailure)
        return false
      }
    }
    console.warn('[dsh-session-notification] Notification constructor failed; check the browser/OS notification settings', error)
    return false
  }
}
