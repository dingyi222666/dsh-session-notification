/**
 * Browser-local storage for per-kind custom notification sounds. Audio files
 * are device-local media assets, so they live in localStorage (as data URLs)
 * rather than the shared user-settings document — this also keeps the schema
 * and Host half untouched. Reads are guarded so non-browser runs degrade to
 * "no custom sound".
 */
import type { NotificationType } from '../settings.ts'

/** Per-kind custom sound data URLs (empty string = none). */
export type CustomSounds = Partial<Record<NotificationType, string>>

/** localStorage key for the custom-sound map. */
const STORAGE_KEY = 'dsh-session-notification.customSounds'

/** Upper bound for one custom audio file (base64 payload after encoding). */
export const MAX_CUSTOM_AUDIO_BYTES = 1_048_576

/** Read the whole custom-sound map from localStorage. */
export function readCustomSounds(): CustomSounds {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as CustomSounds
  } catch (_corruptEntry) {
    return {}
  }
}

/** Read one kind's custom sound data URL (undefined = none). */
export function readCustomSound(kind: NotificationType): string | undefined {
  const url = readCustomSounds()[kind]
  return url !== undefined && url.length > 0 ? url : undefined
}

/** Persist one kind's custom sound (null removes it). */
export function writeCustomSound(kind: NotificationType, dataUrl: string | null): void {
  if (typeof localStorage === 'undefined') return
  const next: CustomSounds = { ...readCustomSounds() }
  if (dataUrl === null) delete next[kind]
  else next[kind] = dataUrl
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

/** The sound map with one entry replaced (pure helper for store mirrors). */
export function withCustomSound(
  current: CustomSounds,
  kind: NotificationType,
  dataUrl: string | null,
): CustomSounds {
  const next = { ...current }
  if (dataUrl === null) delete next[kind]
  else next[kind] = dataUrl
  return next
}

/** Read a picked audio file as a data URL (the stored custom-sound form). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('audio file read produced no data URL'))
    }
    reader.onerror = () => { reject(reader.error ?? new Error('audio file read failed')) }
    reader.readAsDataURL(file)
  })
}
