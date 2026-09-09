/**
 * Cross-tab arbitration (B + C): one tab wins each event, a visible tab takes
 * it ahead of a background one, and repeated claims inside the dedupe window
 * are dropped. A shared in-memory hub stands in for BroadcastChannel.
 */
import { describe, expect, it } from 'vitest'
import { createTabCoordinator, type TabChannel } from '../src/client/tab-coordinator.ts'

/** Hub factory: every channel sees the others' messages, never its own. */
function createHub(): () => TabChannel {
  const members = new Set<{ notify: (message: unknown) => void }>()
  return () => {
    const listeners = new Set<(event: { data: unknown }) => void>()
    const self = { notify: (message: unknown): void => { for (const listener of [...listeners]) listener({ data: message }) } }
    members.add(self)
    return {
      postMessage: (message: unknown): void => {
        for (const member of [...members]) if (member !== self) member.notify(message)
      },
      addEventListener: (_type, listener): void => { listeners.add(listener) },
      removeEventListener: (_type, listener): void => { listeners.delete(listener) },
      close: (): void => { members.delete(self) },
    }
  }
}

const FAST = { arbitrationMs: 5, visibleGraceMs: 10 } as const

describe('createTabCoordinator', () => {
  it('claims without a channel (pre-coordination fallback)', async () => {
    const coordinator = createTabCoordinator({ channel: null })
    expect(await coordinator.claim('a:completed')).toBe(true)
  })

  it('drops a repeated claim inside the dedupe window and allows it after', async () => {
    let clock = 1_000
    const coordinator = createTabCoordinator({ channel: null, dedupeWindowMs: 100, now: () => clock })
    expect(await coordinator.claim('a:completed')).toBe(true)
    clock = 1_050
    expect(await coordinator.claim('a:completed')).toBe(false)
    clock = 1_200
    expect(await coordinator.claim('a:completed')).toBe(true)
  })

  it('lets exactly one of two visible tabs win', async () => {
    const hub = createHub()
    const first = createTabCoordinator({ channel: hub(), tabId: 'a', visible: () => true, now: () => 1_000, ...FAST })
    const second = createTabCoordinator({ channel: hub(), tabId: 'b', visible: () => true, now: () => 1_000, ...FAST })
    const [firstWon, secondWon] = await Promise.all([first.claim('a:completed'), second.claim('a:completed')])
    expect(firstWon).toBe(true)
    expect(secondWon).toBe(false)
  })

  it('yields a background tab to a visible tab (C)', async () => {
    const hub = createHub()
    const background = createTabCoordinator({ channel: hub(), tabId: 'a', visible: () => false, now: () => 1_000, ...FAST })
    const visible = createTabCoordinator({ channel: hub(), tabId: 'b', visible: () => true, now: () => 1_000, ...FAST })
    const [backgroundWon, visibleWon] = await Promise.all([
      background.claim('a:completed'),
      visible.claim('a:completed'),
    ])
    expect(visibleWon).toBe(true)
    expect(backgroundWon).toBe(false)
  })

  it('still elects one winner when every tab is background', async () => {
    const hub = createHub()
    const first = createTabCoordinator({ channel: hub(), tabId: 'a', visible: () => false, now: () => 1_000, ...FAST })
    const second = createTabCoordinator({ channel: hub(), tabId: 'b', visible: () => false, now: () => 1_000, ...FAST })
    const [firstWon, secondWon] = await Promise.all([first.claim('a:completed'), second.claim('a:completed')])
    expect(firstWon).toBe(true)
    expect(secondWon).toBe(false)
  })

  it('lets every tab keep distinct events', async () => {
    const hub = createHub()
    const first = createTabCoordinator({ channel: hub(), tabId: 'a', visible: () => true, now: () => 1_000, ...FAST })
    const second = createTabCoordinator({ channel: hub(), tabId: 'b', visible: () => true, now: () => 1_000, ...FAST })
    const [firstWon, secondWon] = await Promise.all([first.claim('a:completed'), second.claim('b:completed')])
    expect(firstWon).toBe(true)
    expect(secondWon).toBe(true)
  })
})
