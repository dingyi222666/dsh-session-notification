/**
 * Notification dispatcher gating: per-kind enable, sound, and browser
 * visibility rules.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import {
  NotificationDispatcher, type NotificationDispatcherDeps, type NotificationEvent,
} from '../src/client/notification-service.ts'
import { zh } from '../src/client/locales.ts'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/settings.ts'
import type { NotificationSettings, SoundId } from '../src/settings.ts'

const event = (kind: NotificationEvent['kind'], sessionId = 'a'): NotificationEvent => ({
  kind, sessionId: sessionId as SessionId, title: '会话 a', detail: '',
})

function makeDeps(overrides: Partial<NotificationDispatcherDeps> = {}): {
  deps: NotificationDispatcherDeps
  sounds: Array<{ sound: SoundId; customUrl?: string }>
  browser: Array<{ title: string; body: string }>
  settings: NotificationSettings
} {
  const sounds: Array<{ sound: SoundId; customUrl?: string }> = []
  const browser: Array<{ title: string; body: string }> = []
  const settings: NotificationSettings = structuredClone(DEFAULT_NOTIFICATION_SETTINGS)
  // The shipped default keeps browser notifications off; these tests focus on
  // the browser path, so enable it unless a test flips it off explicitly.
  settings.browserEnabled = true
  return {
    deps: {
      settings: () => settings,
      t: (key: string) => (zh as Record<string, string>)[key] ?? key,
      playSound: (sound, customUrl) => { sounds.push(customUrl === undefined ? { sound } : { sound, customUrl }) },
      customSoundOf: () => undefined,
      showBrowser: (title, body) => { browser.push({ title, body }); return true },
      currentSession: () => undefined,
      isHidden: () => false,
      ...overrides,
    },
    sounds,
    browser,
    settings,
  }
}

describe('NotificationDispatcher', () => {
  it('plays the kind sound and shows a browser notification when elsewhere', () => {
    const { deps, sounds, browser } = makeDeps()
    const dispatcher = new NotificationDispatcher(deps)
    dispatcher.dispatch(event('completed'))
    expect(sounds).toEqual([{ sound: 'chime' }])
    expect(browser).toHaveLength(1)
    expect(browser[0].body).toContain('会话 a')
  })

  it('appends the final completion text to a completed notification body', () => {
    const { deps, browser } = makeDeps()
    const dispatcher = new NotificationDispatcher(deps)
    dispatcher.dispatch({ ...event('completed'), detail: '这是最终完成文本。' })
    expect(browser).toHaveLength(1)
    expect(browser[0].body).toBe('「会话 a」已完成\n这是最终完成文本。')
  })

  it('skips everything when the kind is disabled', () => {
    const { deps, sounds, browser, settings } = makeDeps()
    const dispatcher = new NotificationDispatcher(deps)
    settings.types.failed = { enabled: false, sound: 'fault' }
    dispatcher.dispatch(event('failed'))
    expect(sounds).toEqual([])
    expect(browser).toEqual([])
  })

  it('plays no sound when sound is disabled or the kind is muted', () => {
    const { deps, sounds, settings } = makeDeps()
    settings.soundEnabled = false
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([])
    settings.soundEnabled = true
    settings.types.completed = { enabled: true, sound: 'none' }
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([])
  })

  it('stays fully quiet while the user watches that session (default)', () => {
    const { deps, sounds, browser } = makeDeps({ currentSession: () => 'a' as SessionId })
    new NotificationDispatcher(deps).dispatch(event('completed', 'a'))
    expect(sounds).toEqual([])
    expect(browser).toEqual([])
  })

  it('alerts for the current session when the notifyCurrent toggle is on', () => {
    const { deps, sounds, browser, settings } = makeDeps({ currentSession: () => 'a' as SessionId })
    settings.notifyCurrent = true
    new NotificationDispatcher(deps).dispatch(event('completed', 'a'))
    expect(sounds).toEqual([{ sound: 'chime' }])
    expect(browser).toHaveLength(1)
  })

  it('shows a browser notification for a different session while visible', () => {
    const { deps, browser } = makeDeps({ currentSession: () => 'b' as SessionId })
    new NotificationDispatcher(deps).dispatch(event('completed', 'a'))
    expect(browser).toHaveLength(1)
  })

  it('shows a browser notification when hidden even for the current session', () => {
    const { deps, browser } = makeDeps({ currentSession: () => 'a' as SessionId, isHidden: () => true })
    new NotificationDispatcher(deps).dispatch(event('question', 'a'))
    expect(browser).toHaveLength(1)
  })

  it('keeps sound when browser notifications are disabled', () => {
    const { deps, sounds, browser, settings } = makeDeps()
    settings.browserEnabled = false
    new NotificationDispatcher(deps).dispatch(event('permission'))
    expect(sounds).toEqual([{ sound: 'alert' }])
    expect(browser).toEqual([])
  })

  it('plays the custom audio when 自定义 is the selected sound', () => {
    const { deps, sounds, settings } = makeDeps({ customSoundOf: () => 'data:audio/wav;base64,AAA' })
    settings.types.completed = { enabled: true, sound: 'custom' }
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([{ sound: 'custom', customUrl: 'data:audio/wav;base64,AAA' }])
  })

  it('plays the built-in while a custom file is dormant (自定义 not selected)', () => {
    const { deps, sounds } = makeDeps({ customSoundOf: () => 'data:audio/wav;base64,AAA' })
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([{ sound: 'chime' }])
  })

  it('plays nothing when 自定义 is selected but no file is stored', () => {
    const { deps, sounds, settings } = makeDeps({ customSoundOf: () => undefined })
    settings.types.completed = { enabled: true, sound: 'custom' }
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([])
  })

  it('plays nothing for a muted kind even with a stored custom file', () => {
    const { deps, sounds, settings } = makeDeps({ customSoundOf: () => 'data:audio/wav;base64,AAA' })
    settings.types.completed = { enabled: true, sound: 'none' }
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([])
  })

  it('plays nothing for a disabled kind even with a custom audio', () => {
    const { deps, sounds, settings } = makeDeps({ customSoundOf: () => 'data:audio/wav;base64,AAA' })
    settings.types.completed = { enabled: false, sound: 'custom' }
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([])
  })

  it('plays nothing when sound is disabled even with a custom audio', () => {
    const { deps, sounds, settings } = makeDeps({ customSoundOf: () => 'data:audio/wav;base64,AAA' })
    settings.soundEnabled = false
    new NotificationDispatcher(deps).dispatch(event('completed'))
    expect(sounds).toEqual([])
  })

  it('interpolates the title and detail into the body', () => {
    const { deps, browser } = makeDeps({
      t: (key: string) => key === 'notify.failed.body' ? '“{title}” failed: {detail}' : key,
    })
    new NotificationDispatcher(deps).dispatch({ ...event('failed'), detail: 'boom' })
    expect(browser[0].body).toContain('会话 a')
    expect(browser[0].body).toContain('boom')
  })
})
