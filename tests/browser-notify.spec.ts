// @vitest-environment jsdom
/**
 * Browser notification wrapper: page-icon resolution, icon fallback when the
 * constructor rejects the icon, and permission gating. The global Notification
 * is stubbed because jsdom does not implement it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserPermission, showBrowserNotification } from '../src/client/browser-notify.ts'

interface FakeNotificationInstance {
  onclick: (() => void) | null
  close: ReturnType<typeof vi.fn>
}

interface FakeNotification {
  staticPermission: NotificationPermission
  created: Array<{ title: string; options: NotificationOptions }>
  instances: FakeNotificationInstance[]
}

function stubNotification(): FakeNotification {
  const created: Array<{ title: string; options: NotificationOptions }> = []
  const instances: FakeNotificationClass[] = []
  let staticPermission: NotificationPermission = 'granted'
  class FakeNotificationClass {
    static get permission(): NotificationPermission { return staticPermission }
    static set permission(value: NotificationPermission) { staticPermission = value }
    onclick: (() => void) | null = null
    close = vi.fn()
    constructor(title: string, options: NotificationOptions) {
      created.push({ title, options })
      instances.push(this)
    }
  }
  vi.stubGlobal('Notification', FakeNotificationClass)
  return { get staticPermission() { return staticPermission }, set staticPermission(v) { staticPermission = v }, created, instances }
}

function addIconLink(rel: string, href: string): void {
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  document.head.appendChild(link)
}

afterEach(() => {
  document.head.querySelectorAll('link').forEach(link => link.remove())
  vi.unstubAllGlobals()
})

describe('page icon in browser notifications', () => {
  it('uses the page favicon as the notification icon', () => {
    addIconLink('icon', '/favicon.svg')
    const { created } = stubNotification()
    expect(showBrowserNotification('t', 'b')).toBe(true)
    expect(created[0].options.icon).toMatch(/\/favicon\.svg$/)
  })

  it('focuses the page, runs the click action, then closes the card', () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const activated = vi.fn()
    const { instances } = stubNotification()
    expect(showBrowserNotification('t', 'b', 'tag', activated)).toBe(true)
    const notification = instances[0]
    notification.onclick?.()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(activated).toHaveBeenCalledTimes(1)
    expect(notification.close).toHaveBeenCalledTimes(1)
    focus.mockRestore()
  })

  it('closes the card even when the click action throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { instances } = stubNotification()
    const activated = vi.fn(() => { throw new Error('navigation failed') })
    showBrowserNotification('t', 'b', 'tag', activated)
    const notification = instances[0]
    notification.onclick?.()
    expect(activated).toHaveBeenCalledTimes(1)
    expect(notification.close).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('marks desktop notifications silent so the OS sound does not double ours', () => {
    vi.stubGlobal('dshDesktop', { protocolVersion: 1 })
    const { created } = stubNotification()
    expect(showBrowserNotification('t', 'b')).toBe(true)
    expect((created[0].options as { silent?: boolean }).silent).toBe(true)
  })

  it('leaves the silent flag to the browser outside the desktop shell', () => {
    const { created } = stubNotification()
    showBrowserNotification('t', 'b')
    expect((created[0].options as { silent?: boolean }).silent).toBeUndefined()
  })

  it('ignores a data: SVG icon the native layer cannot rasterize', () => {
    addIconLink('icon', 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E')
    const { created } = stubNotification()
    expect(showBrowserNotification('t', 'b')).toBe(true)
    expect(created[0].options.icon).toBeUndefined()
  })

  it('keeps a raster data: icon', () => {
    addIconLink('icon', 'data:image/png;base64,AAAA')
    const { created } = stubNotification()
    expect(showBrowserNotification('t', 'b')).toBe(true)
    expect(created[0].options.icon).toMatch(/^data:image\/png/)
  })

  it('ignores a custom-scheme (desktop dsh-app:) page icon', () => {
    addIconLink('icon', 'dsh-app://app/favicon.svg')
    const { created } = stubNotification()
    expect(showBrowserNotification('t', 'b')).toBe(true)
    // No icon passed: the native layer falls back to the app icon instead of
    // trying to fetch a URL it cannot rasterize.
    expect(created[0].options.icon).toBeUndefined()
  })

  it('re-alerts when a same-tag notification is replaced (renotify + tag)', () => {
    const { created } = stubNotification()
    showBrowserNotification('t', 'b')
    // Without renotify, Windows/Chromium replace a same-tag card silently.
    expect((created[0].options as { renotify?: boolean }).renotify).toBe(true)
    expect(created[0].options.tag).toBe('dsh-session-notification')
  })

  it('collapses per kind through the caller-supplied tag', () => {
    const { created } = stubNotification()
    showBrowserNotification('t', 'b', 'dsh-session-notification:failed')
    expect(created[0].options.tag).toBe('dsh-session-notification:failed')
  })

  it('prefers the apple-touch-icon over the plain icon', () => {
    addIconLink('icon', '/favicon.svg')
    addIconLink('apple-touch-icon', '/icon-180.png')
    const { created } = stubNotification()
    showBrowserNotification('t', 'b')
    expect(created[0].options.icon).toMatch(/\/icon-180\.png$/)
  })

  it('shows without an icon when the page declares none', () => {
    const { created } = stubNotification()
    showBrowserNotification('t', 'b')
    expect(created[0].options.icon).toBeUndefined()
  })

  it('retries without the icon when the constructor rejects it', () => {
    addIconLink('icon', '/favicon.svg')
    const { created } = stubNotification()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    class RejectingIcon {
      static permission = 'granted'
      onclick: (() => void) | null = null
      constructor(title: string, options: NotificationOptions) {
        if (options.icon !== undefined) throw new Error('icon rejected')
        created.push({ title, options })
      }
      close(): void {}
    }
    vi.stubGlobal('Notification', RejectingIcon)
    expect(showBrowserNotification('t', 'b')).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0].options.icon).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('returns false without granted permission', () => {
    addIconLink('icon', '/favicon.svg')
    const stub = stubNotification()
    stub.staticPermission = 'denied'
    expect(showBrowserNotification('t', 'b')).toBe(false)
  })

  it('reports unsupported when the Notification API is absent', () => {
    vi.stubGlobal('Notification', undefined)
    expect(browserPermission()).toBe('unsupported')
    expect(showBrowserNotification('t', 'b')).toBe(false)
  })
})
