/**
 * Sound catalog and player scheduling helpers.
 */
import { describe, expect, it } from 'vitest'
import { SOUND_PATTERNS, patternDuration, clampVolume } from '../src/client/sounds.ts'
import { SOUND_IDS } from '../src/settings.ts'

describe('SOUND_PATTERNS', () => {
  it('provides exactly the four built-in sound effects', () => {
    expect(Object.keys(SOUND_PATTERNS).sort()).toEqual([...SOUND_IDS].sort())
  })

  it('keeps every pattern within a bounded duration and valid notes', () => {
    for (const [name, pattern] of Object.entries(SOUND_PATTERNS)) {
      expect(pattern.notes.length).toBeGreaterThan(0)
      for (const note of pattern.notes) {
        expect(note.frequency).toBeGreaterThan(0)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.at).toBeGreaterThanOrEqual(0)
        expect(note.gain).toBeGreaterThan(0)
        expect(note.gain).toBeLessThanOrEqual(1)
      }
      expect(patternDuration(pattern)).toBeLessThan(1.5)
      expect(name).toMatch(/^(chime|fault|pop|alert)$/)
    }
  })

  it('distinguishes the four patterns from each other', () => {
    const fingerprints = Object.values(SOUND_PATTERNS).map(pattern =>
      pattern.notes.map(note => `${note.at}:${note.frequency}:${note.type}`).join('|'))
    expect(new Set(fingerprints).size).toBe(4)
  })
})

describe('clampVolume', () => {
  it('clamps into [0, 1]', () => {
    expect(clampVolume(0.5)).toBe(0.5)
    expect(clampVolume(1.5)).toBe(1)
    expect(clampVolume(-1)).toBe(0)
  })
})
