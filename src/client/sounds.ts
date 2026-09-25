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

/** Lead time between `currentTime` and the first scheduled note. */
const START_LEAD_SECONDS = 0.02
/** Released-oscillator tail kept alive after a note's nominal duration. */
const NOTE_TAIL_SECONDS = 0.05
/** Quiet margin before the idle suspend, covering gain release and device latency. */
const IDLE_SUSPEND_MARGIN_SECONDS = 0.55
/** Margin after a custom element or final oscillator ends before suspending. */
const CUSTOM_IDLE_MARGIN_SECONDS = 0.25

/**
 * Web Audio player. The AudioContext is created lazily on the first play and
 * reused; a suspended context is resumed on every play (including the autoplay
 * policy's initial suspension), so sound starts working as soon as the user
 * has interacted with the page.
 *
 * The context is suspended again once the playback is over — a running
 * AudioContext holds a system output stream (and, on macOS, a
 * `PreventUserIdleSystemSleep` assertion) for as long as it lives, which would
 * pin the machine awake for the whole tab lifetime after a single chime
 * (issue #6). Built-in patterns use their known duration; custom audio uses
 * the element's `ended` event.
 *
 * Signal chain: per-note gain → master (volume) → loudness boost → soft
 * limiter → destination. The boost raises every sound by a fixed amount at
 * any volume setting, and the limiter (threshold −1 dB, ratio 20) tames only
 * the peaks that would otherwise clip, so the loudest notes stay clean.
 */
export class SoundPlayer {
  private context: AudioContext | undefined
  private master: GainNode | undefined
  /** Pending idle-suspend timer; every new playback clears it. */
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  /** Current custom-audio element and its per-play source node. */
  private customAudio: HTMLAudioElement | undefined
  private customSource: MediaElementAudioSourceNode | undefined

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
    const start = context.currentTime + START_LEAD_SECONDS
    this.master.gain.setValueAtTime(clampVolume(this.volume()), start)
    let finalOscillator: OscillatorNode | undefined
    let finalStop = Number.NEGATIVE_INFINITY
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
      const stop = at + note.duration + NOTE_TAIL_SECONDS
      oscillator.start(at)
      oscillator.stop(stop)
      if (stop > finalStop) {
        finalStop = stop
        finalOscillator = oscillator
      }
    }
    // A running AudioContext keeps a system output stream (and, on macOS, a
    // PreventUserIdleSystemSleep assertion) alive for as long as it lives, so
    // the context returns to `suspended` once the pattern is over and is
    // resumed by the next play. See issue #6. The final oscillator's `ended`
    // event is the precise, unthrottled trigger; the scheduled estimate is the
    // fallback for contexts that never reach it.
    finalOscillator?.addEventListener('ended', () => {
      this.scheduleIdleSuspend(CUSTOM_IDLE_MARGIN_SECONDS)
    }, { once: true })
    this.scheduleIdleSuspend(
      START_LEAD_SECONDS + patternDuration(pattern) + NOTE_TAIL_SECONDS + IDLE_SUSPEND_MARGIN_SECONDS,
    )
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
   *
   * The element's length is unknown, so the idle suspend hangs off `ended`:
   * when playback stops (or is refused) the per-play source is disconnected so
   * nodes do not accumulate, and the shared context is suspended again.
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
    this.releaseCustomSource()
    const audio = new Audio(dataUrl)
    this.customAudio = audio
    try {
      const source = context.createMediaElementSource(audio)
      source.connect(this.master)
      this.customSource = source
    } catch (_sourceFailed) {
      audio.volume = clampVolume(this.volume())
    }
    /** Finish this play: drop its source, then let the context go idle. */
    const release = (): void => {
      // A newer playback (or a dispose) superseded this element.
      if (this.customAudio !== audio) return
      this.releaseCustomSource()
      this.scheduleIdleSuspend(CUSTOM_IDLE_MARGIN_SECONDS)
    }
    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener('error', release, { once: true })
    void audio.play().catch(() => {
      // Autoplay policy refused playback; nothing is audible, so release the
      // source and return the context to idle instead of holding the stream.
      release()
    })
  }

  /**
   * Release every audio resource this player owns: the pending idle timer, the
   * live custom source, and the shared context. Called when the plugin unloads
   * so an unloaded page never keeps a system output stream (or its power
   * assertion) alive.
   */
  dispose(): void {
    this.clearIdleSuspend()
    this.releaseCustomSource()
    const context = this.context
    this.context = undefined
    this.master = undefined
    if (context !== undefined && context.state !== 'closed') void context.close()
  }

  /** Disconnect and forget the live custom-audio source, if any. */
  private releaseCustomSource(): void {
    this.customSource?.disconnect()
    this.customSource = undefined
    this.customAudio = undefined
  }

  /** Schedule the idle suspend, replacing any pending one. */
  private scheduleIdleSuspend(delaySeconds: number): void {
    this.clearIdleSuspend()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.context?.state === 'running') void this.context.suspend()
    }, Math.max(0, delaySeconds) * 1000)
  }

  /** Cancel a pending idle suspend. */
  private clearIdleSuspend(): void {
    if (this.idleTimer === undefined) return
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }
}

/** Clamp a volume candidate to [0, 1] (0–100%); the loudness boost is applied
 *  separately on the Web Audio chain, so the slider never needs to exceed 1. */
export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}
