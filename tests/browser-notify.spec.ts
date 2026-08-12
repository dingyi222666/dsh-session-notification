// @vitest-environment jsdom
/**
 * Browser notification wrapper: page-icon resolution, icon fallback when the
 * constructor rejects the icon, and permission gating. The global Notification
 * is stubbed because jsdom does not implement it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserPermission, showBrowserNotification } from '../src/client/browser-notify.ts'

interface FakeNotification {
  staticPermission: NotificationPermission
  created: Array<{ title: string; options: NotificationOptions }>
}

function stubNotification(): FakeNotification {
  const created: Array<{ title: string; options: NotificationOptions }> = []
  let staticPermission: NotificationPermission = 'granted'
  class FakeNotificationClass {
    static get permission(): NotificationPermission { return staticPermission }
    static set permission(value: NotificationPermission) { staticPermission = value }
    onclick: (() => void) | null = null
    constructor(title: string, options: NotificationOptions) {
      created.push({ title, options })
    }
    close(): void {}
  }
  vi.stubGlobal('Notification', FakeNotificationClass)
  return { get staticPermission() { return staticPermission }, set staticPermission(v) { staticPermission = v }, created }
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
