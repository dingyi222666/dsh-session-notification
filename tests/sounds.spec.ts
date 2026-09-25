/**
 * Sound catalog and player scheduling helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SOUND_PATTERNS, SoundPlayer, patternDuration, clampVolume, type SoundPattern,
} from '../src/client/sounds.ts'
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

/* ------------------------------------------------------------------ *
 * Idle-suspend regression (issue #6): a running AudioContext holds a  *
 * system output stream (and on macOS a PreventUserIdleSystemSleep     *
 * assertion) for as long as it lives, so the player must suspend it   *
 * after every playback and resume on the next one.                    *
 * ------------------------------------------------------------------ */

class FakeAudioParam {
  value = 0
  setValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void {
    const wrapped = (): void => {
      if (options?.once === true) this.listeners.get(type)?.delete(wrapped)
      listener()
    }
    const set = this.listeners.get(type) ?? new Set()
    set.add(wrapped)
    this.listeners.set(type, set)
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }
}

class FakeNode extends FakeEventTarget {
  connect = vi.fn((node: unknown) => node)
  disconnect = vi.fn()
}

class FakeGain extends FakeNode {
  gain = new FakeAudioParam()
}

class FakeOscillator extends FakeNode {
  type = 'sine'
  frequency = new FakeAudioParam()
  start = vi.fn()
  stop = vi.fn()
}

class FakeCompressor extends FakeNode {
  threshold = new FakeAudioParam()
  knee = new FakeAudioParam()
  ratio = new FakeAudioParam()
  attack = new FakeAudioParam()
  release = new FakeAudioParam()
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 0
  destination = {}
  createGain = vi.fn(() => new FakeGain())
  createOscillator = vi.fn(() => new FakeOscillator())
  createDynamicsCompressor = vi.fn(() => new FakeCompressor())
  createMediaElementSource = vi.fn(() => new FakeNode())
  suspend = vi.fn(async () => { this.state = 'suspended' })
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { FakeAudioContext.instances.push(this) }
}

class FakeAudio extends FakeEventTarget {
  static instances: FakeAudio[] = []
  static rejectPlay = false
  volume = 1
  play = vi.fn(async () => {
    if (FakeAudio.rejectPlay) throw new Error('autoplay blocked')
  })
  constructor(readonly src: string) {
    super()
    FakeAudio.instances.push(this)
  }
}

/** The delay the player waits before suspending a built-in pattern, in ms. */
const idleDelayMs = (pattern: SoundPattern): number =>
  (patternDuration(pattern) + 0.02 + 0.05 + 0.55) * 1000

describe('SoundPlayer idle suspend (issue #6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.instances = []
    FakeAudio.instances = []
    FakeAudio.rejectPlay = false
    vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext)
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('suspends the shared context once the built-in pattern is over', () => {
    const player = new SoundPlayer(() => 0.6)
    player.play('chime')
    const context = FakeAudioContext.instances[0]
    expect(context.state).toBe('running')

    vi.advanceTimersByTime(idleDelayMs(SOUND_PATTERNS.chime) - 1)
    expect(context.state).toBe('running')
    vi.advanceTimersByTime(2)
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('suspended')
  })

  it('resumes the context on the next play after an idle suspend', () => {
    const player = new SoundPlayer(() => 0.6)
    player.play('chime')
    const context = FakeAudioContext.instances[0]
    vi.advanceTimersByTime(idleDelayMs(SOUND_PATTERNS.chime))
    expect(context.state).toBe('suspended')

    player.play('pop')
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')
    expect(FakeAudioContext.instances).toHaveLength(1)
  })

  it('keeps the context alive while a newer sound is still scheduled', () => {
    const player = new SoundPlayer(() => 0.6)
    player.play('pop')
    const context = FakeAudioContext.instances[0]
    // The second play replaces the first pattern's pending suspend.
    vi.advanceTimersByTime(100)
    player.play('alert')

    vi.advanceTimersByTime(idleDelayMs(SOUND_PATTERNS.pop) - 100 + 2)
    expect(context.state).toBe('running')
    vi.advanceTimersByTime(idleDelayMs(SOUND_PATTERNS.alert) + 2)
    expect(context.state).toBe('suspended')
  })

  it('suspends via the final oscillator ended event before the fallback timer', () => {
    const player = new SoundPlayer(() => 0.6)
    player.play('chime')
    const context = FakeAudioContext.instances[0]
    const oscillators = context.createOscillator.mock.results.map(result => result.value as FakeOscillator)
    const finalOscillator = oscillators[oscillators.length - 1]
    expect(context.state).toBe('running')

    finalOscillator.emit('ended')
    vi.advanceTimersByTime(251)
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('suspended')
  })

  it('suspends on custom audio end and disconnects the per-play source', () => {
    const player = new SoundPlayer(() => 0.6)
    player.playCustom('data:audio/wav;base64,AAA')
    const context = FakeAudioContext.instances[0]
    const source = context.createMediaElementSource.mock.results[0]?.value as FakeNode
    const audio = FakeAudio.instances[0]
    expect(context.state).toBe('running')

    audio.emit('ended')
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')
    vi.advanceTimersByTime(251)
    expect(context.state).toBe('suspended')
  })

  it('releases a custom source and idles when autoplay is refused', async () => {
    FakeAudio.rejectPlay = true
    const player = new SoundPlayer(() => 0.6)
    player.playCustom('data:audio/wav;base64,BBB')
    const context = FakeAudioContext.instances[0]
    const source = context.createMediaElementSource.mock.results[0]?.value as FakeNode
    await Promise.resolve()

    expect(source.disconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(251)
    expect(context.state).toBe('suspended')
  })

  it('does not create a context for a muted or custom-only play call', () => {
    const player = new SoundPlayer(() => 0.6)
    player.play('none')
    player.play('custom')
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('dispose closes the context and cancels a pending suspend', () => {
    const player = new SoundPlayer(() => 0.6)
    player.play('chime')
    const context = FakeAudioContext.instances[0]
    player.dispose()
    vi.advanceTimersByTime(idleDelayMs(SOUND_PATTERNS.chime) + 10)

    expect(context.close).toHaveBeenCalledTimes(1)
    expect(context.suspend).not.toHaveBeenCalled()
    expect(context.state).toBe('closed')

    // A later play builds a fresh context instead of reusing the closed one.
    player.play('pop')
    expect(FakeAudioContext.instances).toHaveLength(2)
  })
})
