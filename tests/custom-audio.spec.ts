// @vitest-environment jsdom
/**
 * Browser-local custom-audio storage helpers.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_CUSTOM_AUDIO_BYTES, readCustomSound, readCustomSounds, withCustomSound, writeCustomSound,
} from '../src/client/custom-audio.ts'

describe('custom-audio storage', () => {
  it('round-trips one kind through localStorage', () => {
    writeCustomSound('completed', 'data:audio/wav;base64,AAA')
    expect(readCustomSound('completed')).toBe('data:audio/wav;base64,AAA')
    expect(readCustomSound('failed')).toBeUndefined()
    writeCustomSound('completed', null)
    expect(readCustomSound('completed')).toBeUndefined()
    expect(readCustomSounds()).toEqual({})
  })

  it('ignores corrupt storage content', () => {
    localStorage.setItem('dsh-session-notification.customSounds', 'not json{')
    expect(readCustomSounds()).toEqual({})
    localStorage.setItem('dsh-session-notification.customSounds', '[1,2]')
    expect(readCustomSounds()).toEqual({})
  })

  it('withCustomSound replaces and removes one entry purely', () => {
    const base = { completed: 'data:audio/wav;base64,AAA' }
    expect(withCustomSound(base, 'failed', 'data:audio/wav;base64,BBB')).toEqual({
      completed: 'data:audio/wav;base64,AAA',
      failed: 'data:audio/wav;base64,BBB',
    })
    expect(withCustomSound(base, 'completed', null)).toEqual({})
    expect(base).toEqual({ completed: 'data:audio/wav;base64,AAA' })
  })

  it('caps one custom audio file at one megabyte', () => {
    expect(MAX_CUSTOM_AUDIO_BYTES).toBe(1_048_576)
  })
})
