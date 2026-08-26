/**
 * Built-in sound effects, synthesized with Web Audio so the bundle ships no
 * audio assets. Each notification kind defaults to one pattern and can be
 * reassigned to any other (or muted) in the settings section.
 */
import { SOUND_IDS } from '../settings.ts'
import type { SoundId } from '../settings.ts'

/** One oscillator note inside a sound pattern. */
export interface SoundNote {
  /** Seconds from the pattern start before the note begins. */
  at: number
  /** Oscillator frequency in Hz. */
  frequency: number
  /** Note duration in seconds. */
  duration: number
  /** Oscillator waveform. */
  type: OscillatorType
  /** Peak gain relative to the master volume. */
  gain: number
}

/** A synthesized sound effect: an ordered set of notes. */
export interface SoundPattern {
  notes: readonly SoundNote[]
}

/** The four selectable sound effects (the "default four sounds"). */
export const SOUND_PATTERNS: Record<typeof SOUND_IDS[number], SoundPattern> = {
  /** 叮咚 — a pleasant ascending two-note chime (E5 → A5). */
  chime: {
    notes: [
      { at: 0, frequency: 659.25, duration: 0.2, type: 'sine', gain: 0.9 },
      { at: 0.16, frequency: 880, duration: 0.4, type: 'sine', gain: 0.9 },
    ],
  },
  /** 低鸣 — a low descending sawtooth pair (A3 → E3). */
  fault: {
    notes: [
      { at: 0, frequency: 220, duration: 0.24, type: 'sawtooth', gain: 0.45 },
      { at: 0.2, frequency: 164.81, duration: 0.42, type: 'sawtooth', gain: 0.45 },
    ],
  },
  /** 轻响 — one short soft triangle pop (A5). */
  pop: {
    notes: [
      { at: 0, frequency: 880, duration: 0.09, type: 'triangle', gain: 0.8 },
    ],
  },
  /** 警示 — a square-wave double beep plus a higher third hit. */
  alert: {
    notes: [
      { at: 0, frequency: 660, duration: 0.12, type: 'square', gain: 0.35 },
      { at: 0.18, frequency: 660, duration: 0.12, type: 'square', gain: 0.35 },
      { at: 0.36, frequency: 880, duration: 0.24, type: 'square', gain: 0.35 },
    ],
  },
}

/** Total duration of a pattern in seconds (for scheduling tests). */
export function patternDuration(pattern: SoundPattern): number {
  let end = 0
  for (const note of pattern.notes) {
    end = Math.max(end, note.at + note.duration)
  }
  return end
}

/** Fixed loudness preamp applied after the master volume (≈ +6 dB). The
 *  volume slider stays 0–100%; this boost is what makes the sounds louder,
 *  and the soft limiter after it catches the overs instead of hard-clipping. */
const LOUDNESS_BOOST = 2

/**
 * Web Audio player. The AudioContext is created lazily on the first play and
 * reused; a suspended context (autoplay policy) is resumed on every play, so
 * sound starts working as soon as the user has interacted with the page.
 *
 * Signal chain: per-note gain → master (volume) → loudness boost → soft
 * limiter → destination. The boost raises every sound by a fixed amount at
 * any volume setting, and the limiter (threshold −1 dB, ratio 20) tames only
 * the peaks that would otherwise clip, so the loudest notes stay clean.
 */
export class SoundPlayer {
  private context: AudioContext | undefined
  private master: GainNode | undefined

  /**
   * @param volume - reads the current master volume in [0, 1] at play time.
   */
  constructor(private readonly volume: () => number) {}

  /**
   * Play one built-in sound effect.
   * @param sound - the sound id; `none` and `custom` (which plays through
   * {@link playCustom}) play nothing here.
   */
  play(sound: SoundId): void {
    if (sound === 'none' || sound === 'custom') return
    const context = this.ensureContext()
    if (context === undefined || this.master === undefined) return
    const pattern = SOUND_PATTERNS[sound]
    const start = context.currentTime + 0.02
    this.master.gain.setValueAtTime(clampVolume(this.volume()), start)
    for (const note of pattern.notes) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = note.type
      oscillator.frequency.value = note.frequency
      const at = start + note.at
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(note.gain, at + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, at + note.duration)
      oscillator.connect(gain).connect(this.master)
      oscillator.start(at)
      oscillator.stop(at + note.duration + 0.05)
    }
  }

  /** Create (or resume) the shared context; undefined outside browsers. */
  private ensureContext(): AudioContext | undefined {
    if (typeof AudioContext === 'undefined') return undefined
    if (this.context === undefined) {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      const boost = this.context.createGain()
      boost.gain.value = LOUDNESS_BOOST
      const limiter = this.context.createDynamicsCompressor()
      // Soft limiter: engage only near 0 dB, so quiet material is untouched
      // and loud peaks are pinned instead of clipping.
      limiter.threshold.value = -1
      limiter.knee.value = 3
      limiter.ratio.value = 20
      limiter.attack.value = 0.001
      limiter.release.value = 0.05
      this.master.connect(boost).connect(limiter).connect(this.context.destination)
    }
    if (this.context.state === 'suspended') void this.context.resume()
    return this.context
  }

  /**
   * Play a user-supplied audio file (data URL). The element's audio feeds the
   * same master/boost/limiter chain through a MediaElementSource, so custom
   * audio gets the same loudness treatment as the built-ins instead of being
   * capped at the element's own volume (browser maximum 1.0). When the source
   * cannot be created (unusual browsers), the element plays at the master
   * volume as a fallback.
   * @param dataUrl - the audio data URL.
   */
  playCustom(dataUrl: string): void {
    if (typeof Audio === 'undefined') return
    const context = this.ensureContext()
    if (context === undefined || this.master === undefined) {
      // No Web Audio: element-only playback at the master volume.
      const audio = new Audio(dataUrl)
      audio.volume = clampVolume(this.volume())
      void audio.play().catch(() => { /* autoplay rejection is silent */ })
      return
    }
    const audio = new Audio(dataUrl)
    try {
      const source = context.createMediaElementSource(audio)
      source.connect(this.master)
    } catch (_sourceFailed) {
      audio.volume = clampVolume(this.volume())
    }
    void audio.play().catch(() => { /* autoplay rejection is silent */ })
  }
}

/** Clamp a volume candidate to [0, 1] (0–100%); the loudness boost is applied
 *  separately on the Web Audio chain, so the slider never needs to exceed 1. */
export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}
