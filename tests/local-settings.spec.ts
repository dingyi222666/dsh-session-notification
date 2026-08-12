// @vitest-environment jsdom
/**
 * Browser-local preferences scope: defaults, round-trip persistence, nested
 * type patches, malformed storage fallback, and unset-to-default behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalSettingsScope, LOCAL_STORAGE_KEY } from '../src/client/local-settings.ts'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/settings.ts'

describe('createLocalSettingsScope', () => {
  beforeEach(() => { localStorage.clear() })

  it('starts ready with the defaults when storage is empty', () => {
    const scope = createLocalSettingsScope()
    const snapshot = scope.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.value).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    expect(snapshot.writable).toBe(true)
    expect(snapshot.mode).toBe('memory')
  })

  it('persists a scalar field write and re-reads it from a fresh scope', async () => {
    const scope = createLocalSettingsScope()
    await scope.set('volume', 0.3)
    expect(scope.getSnapshot().value?.volume).toBe(0.3)
    const again = createLocalSettingsScope()
    expect(again.getSnapshot().value?.volume).toBe(0.3)
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeTruthy()
  })

  it('persists nested per-kind type patches', async () => {
    const scope = createLocalSettingsScope()
    await scope.set('types', {
      ...DEFAULT_NOTIFICATION_SETTINGS.types,
      failed: { enabled: false, sound: 'alert' },
    })
    const again = createLocalSettingsScope()
    expect(again.getSnapshot().value?.types.failed).toEqual({ enabled: false, sound: 'alert' })
    expect(again.getSnapshot().value?.types.completed).toEqual(DEFAULT_NOTIFICATION_SETTINGS.types.completed)
  })

  it('falls back to the defaults for malformed stored JSON', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, '{not json')
    const scope = createLocalSettingsScope()
    expect(scope.getSnapshot().value).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('drops unknown fields from stored sections back to the defaults', () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ volume: 0.5, ghost: true }))
    const scope = createLocalSettingsScope()
    const resolved = scope.getSnapshot().value
    expect(resolved).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, volume: 0.5 })
  })

  it('notifies subscribers on set', async () => {
    const scope = createLocalSettingsScope()
    const listener = vi.fn()
    scope.subscribe(listener)
    await scope.set('soundEnabled', false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(scope.getSnapshot().value?.soundEnabled).toBe(false)
  })

  it('removes a subscriber through the returned disposer', async () => {
    const scope = createLocalSettingsScope()
    const listener = vi.fn()
    const dispose = scope.subscribe(listener)
    dispose()
    await scope.set('soundEnabled', false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('unset restores the field default', async () => {
    const scope = createLocalSettingsScope()
    await scope.set('volume', 0.3)
    await scope.unset('volume')
    expect(scope.getSnapshot().value?.volume).toBe(DEFAULT_NOTIFICATION_SETTINGS.volume)
  })
})
