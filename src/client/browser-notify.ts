/**
 * Browser `Notification` API wrapper. Every call is guarded so non-browser
 * or permission-less environments degrade to a no-op instead of throwing.
 */

/** Notification permission state, with `unsupported` for non-browser runs. */
export type BrowserPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/**
 * Notification options carrying the spec's `renotify`, which the DOM lib
 * typings do not declare yet. With a `tag` set, `renotify: true` re-alerts
 * when a same-tag notification is replaced; without it, Windows/Chromium
 * swap the card in the action centre silently and no banner replays.
 */
interface RenotifyOptions extends NotificationOptions {
  renotify?: boolean
}

/** Tag prefix shared by every alert from this plugin. */
export const NOTIFICATION_TAG_PREFIX = 'dsh-session-notification'

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

/** Schemes a native notification layer can fetch an icon from. */
const ICON_URL_SCHEME = /^(?:https?|blob):/i

/**
 * A `data:` icon is usable only when it carries a raster image: native
 * notification layers decode bitmaps and never rasterize SVG documents.
 */
const RASTER_DATA_ICON = /^data:image\/(?!svg)/i

/** One declared icon link, or undefined when absent or unusable natively. */
function iconUrlOf(link: HTMLLinkElement | null): string | undefined {
  if (link === null || link.href.length === 0) return undefined
  // The desktop shell serves its page from `dsh-app://` and declares SVG
  // favicons; neither is fetchable/decodable by the native notification
  // layer, so skipping them lets Electron fall back to the packaged
  // application icon instead of dropping or retrying the alert.
  if (ICON_URL_SCHEME.test(link.href)) return link.href
  return RASTER_DATA_ICON.test(link.href) ? link.href : undefined
}

/**
 * Whether this page runs inside the dsh desktop (Electron) shell. The official
 * client code detects it the same way (`dshDesktop` comes from the desktop
 * preload); the main frame always carries it.
 */
export function isDesktopShell(): boolean {
  return typeof globalThis !== 'undefined' && 'dshDesktop' in globalThis
}

/**
 * Resolve the current page's own icon (favicon) as an absolute URL, preferring
 * the largest declared one (`apple-touch-icon` over `rel=icon`). `link.href`
 * is the resolved absolute URL, so relative favicon paths need no base work.
 * @returns the icon URL, or undefined when the page declares none.
 */
function pageIconUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined
  return iconUrlOf(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]'))
    ?? iconUrlOf(document.querySelector<HTMLLinkElement>('link[rel~="icon"]'))
}

/**
 * Show one system notification, carrying the page's own icon (favicon).
 * Notifications are tagged so a burst of the same kind collapses into a
 * single OS-level card, and `renotify` makes that collapse re-alert instead
 * of updating the card silently (the Windows/Chromium behaviour). Suppressed
 * notifications log the reason (missing API, missing permission, constructor
 * failure) so a silent "no notification" is diagnosable from the console
 * instead of being swallowed; an icon the browser cannot rasterize falls back
 * to an icon-less notification rather than dropping the alert.
 * @param title - notification title.
 * @param body - notification body.
 * @param tag - collapse key; alerts of one kind share it, kinds differ.
 * @param onActivate - click action, run after the page is focused (the client
 * wiring navigates to the event's session here).
 * @returns whether a notification was actually shown.
 */
export function showBrowserNotification(
  title: string,
  body: string,
  tag: string = NOTIFICATION_TAG_PREFIX,
  onActivate?: () => void,
): boolean {
  if (typeof Notification === 'undefined') {
    console.warn('[dsh-session-notification] browser Notification API is unavailable (insecure context or unsupported browser)')
    return false
  }
  if (Notification.permission !== 'granted') {
    console.warn(`[dsh-session-notification] browser notification suppressed: permission is "${Notification.permission}"`)
    return false
  }
  /** Focus the page, run the caller's navigation, then dismiss the card. */
  const activate = (notification: Notification): void => {
    notification.onclick = () => {
      window.focus()
      onActivate?.()
      notification.close()
    }
  }
  const icon = pageIconUrl()
  const options: RenotifyOptions = {
    body,
    tag,
    renotify: true,
    // The desktop shell forwards `silent` to the native notification, and its
    // own notifications set it: without it the OS alert sound plays on top of
    // this plugin's Web Audio sound. On the Web the notification sound stays
    // the browser's business, as before.
    ...(isDesktopShell() ? { silent: true } : {}),
    ...(icon === undefined ? {} : { icon }),
  }
  try {
    const notification = new Notification(title, options)
    activate(notification)
    return true
  } catch (error) {
    // A page icon the browser cannot rasterize must not kill the alert:
    // retry once without it, then report.
    if (icon !== undefined) {
      try {
        const bareOptions: RenotifyOptions = { body, tag, renotify: true }
        const notification = new Notification(title, bareOptions)
        activate(notification)
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
