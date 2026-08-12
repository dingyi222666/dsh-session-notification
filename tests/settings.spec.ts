/**
 * Durable-preferences resolution: defaults, malformed input, and clamping.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_SOUND, resolveNotificationSettings,
} from '../src/settings.ts'

describe('resolveNotificationSettings', () => {
  it('returns the defaults for an absent section', () => {
    const resolved = resolveNotificationSettings(undefined)
    expect(resolved).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('keeps sound enabled and browser notifications disabled by default', () => {
    const resolved = resolveNotificationSettings(undefined)
    expect(resolved.soundEnabled).toBe(true)
    expect(resolved.browserEnabled).toBe(false)
    expect(resolved.notifyCurrent).toBe(false)
  })

  it('assigns the default four sounds to the four kinds', () => {
    const resolved = resolveNotificationSettings(undefined)
    expect(resolved.types.completed.sound).toBe('chime')
    expect(resolved.types.failed.sound).toBe('fault')
    expect(resolved.types.question.sound).toBe('pop')
    expect(resolved.types.permission.sound).toBe('alert')
  })

  it('merges a partial section over the defaults', () => {
    const resolved = resolveNotificationSettings({
      volume: 0.3,
      types: { failed: { enabled: false, sound: 'alert' } },
    })
    expect(resolved.volume).toBe(0.3)
    expect(resolved.browserEnabled).toBe(false)
    expect(resolved.soundEnabled).toBe(true)
    expect(resolved.types.failed).toEqual({ enabled: false, sound: 'alert' })
    expect(resolved.types.completed).toEqual(DEFAULT_NOTIFICATION_SETTINGS.types.completed)
  })

  it('clamps the volume into [0, 1]', () => {
    expect(resolveNotificationSettings({ volume: 1.5 }).volume).toBe(1)
    expect(resolveNotificationSettings({ volume: -0.5 }).volume).toBe(0)
    expect(resolveNotificationSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_NOTIFICATION_SETTINGS.volume)
  })

  it('drops malformed values back to the defaults', () => {
    const resolved = resolveNotificationSettings({
      browserEnabled: 'yes',
      soundEnabled: 1,
      volume: 'loud',
      types: 'broken',
      unknown: 'ignored',
    })
    expect(resolved).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('rejects unknown sound ids per kind', () => {
    const resolved = resolveNotificationSettings({
      types: { question: { enabled: true, sound: 'megaphone' } },
    })
    expect(resolved.types.question.sound).toBe(DEFAULT_SOUND.question)
  })

  it('ignores array-shaped sections', () => {
    expect(resolveNotificationSettings([1, 2, 3])).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })
})
