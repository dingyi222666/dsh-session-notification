/**
 * Cross-tab notification arbitration (B + C).
 *
 * Every open dsh tab runs its own plugin instance and receives the same
 * session events, so one completion would ring once per open tab. This
 * coordinator claims each event (`sessionId:kind`) over a BroadcastChannel:
 * a claim is broadcast, a short arbitration window collects rivals, and one
 * tab wins — the earliest claim, tab id breaking a tie. The winner dispatches,
 * every other tab stays silent for that event.
 *
 * Visibility first (C): a visible tab claims immediately, a background tab
 * waits a short grace period so the tab you are actually looking at takes the
 * event first; only when no visible tab claims does a background tab proceed.
 *
 * Without BroadcastChannel the claim always succeeds — the pre-coordination
 * behavior (one alert per tab) rather than silence.
 */

/** Channel name shared by every same-origin dsh tab. */
const CHANNEL_NAME = 'dsh-session-notification'

/** Window in ms during which a rival's claim can beat ours. */
const DEFAULT_ARBITRATION_MS = 50

/** How long a background tab yields the floor to a visible one. */
const DEFAULT_VISIBLE_GRACE_MS = 60

/** Window in ms in which a repeated claim for the same event is a duplicate. */
const DEFAULT_DEDUPE_WINDOW_MS = 1_000

interface ClaimMessage { readonly type: 'claim'; readonly key: string; readonly tabId: string; readonly at: number }
interface WinMessage { readonly type: 'win'; readonly key: string; readonly tabId: string }

/** Wire shape read off an incoming message (every field re-validated). */
interface IncomingMessage {
  readonly type?: 'claim' | 'win'
  readonly key?: string
  readonly tabId?: string
  readonly at?: number
}

/** Minimal BroadcastChannel face (injectable so tests need no real channel). */
export interface TabChannel {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  close: () => void
}

/** Cross-tab event arbiter. */
export interface TabCoordinator {
  /** @param key - event identity. @returns true when this tab should dispatch it. */
  claim: (key: string) => Promise<boolean>
  /** Close the channel and drop the listener. */
  dispose: () => void
}

/** Options for {@link createTabCoordinator} (tests override the defaults). */
export interface TabCoordinatorOptions {
  /** Explicit channel; `null` disables coordination, undefined auto-creates. */
  channel?: TabChannel | null
  tabId?: string
  arbitrationMs?: number
  visibleGraceMs?: number
  dedupeWindowMs?: number
  /** Whether this tab is visible (C); defaults to `document.visibilityState`. */
  visible?: () => boolean
  now?: () => number
}

/** The shared channel, when the browser exposes BroadcastChannel. */
function defaultChannel(): TabChannel | undefined {
  try {
    if (typeof BroadcastChannel === 'undefined') return undefined
    return new BroadcastChannel(CHANNEL_NAME) as unknown as TabChannel
  } catch {
    return undefined
  }
}

/** Whether this tab is the one the user is looking at. */
function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

const delay = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * Create the cross-tab coordinator.
 * @param options - channel/clock/window overrides (tests).
 * @returns the coordinator.
 */
export function createTabCoordinator(options: TabCoordinatorOptions = {}): TabCoordinator {
  const arbitrationMs = options.arbitrationMs ?? DEFAULT_ARBITRATION_MS
  const visibleGraceMs = options.visibleGraceMs ?? DEFAULT_VISIBLE_GRACE_MS
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS
  const now = options.now ?? ((): number => Date.now())
  const visible = options.visible ?? defaultVisible
  const tabId = options.tabId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const channel = options.channel === undefined ? defaultChannel() : (options.channel ?? undefined)

  const recent = new Map<string, number>()
  const rivals = new Map<string, { at: number; tabId: string }>()
  const wins = new Set<string>()

  /** Earlier claim wins; equal timestamps fall back to the tab id. */
  const beats = (a: { at: number; tabId: string }, b: { at: number; tabId: string }): boolean =>
    a.at < b.at || (a.at === b.at && a.tabId < b.tabId)

  const onMessage = (event: { data: unknown }): void => {
    const message = event.data as IncomingMessage | null
    if (message === null || typeof message !== 'object') return
    const { key, tabId: sender, type, at } = message
    if (sender === undefined || sender === tabId || typeof key !== 'string') return
    if (type === 'claim' && typeof at === 'number') {
      const current = rivals.get(key)
      if (current === undefined || beats({ at, tabId: sender }, current)) rivals.set(key, { at, tabId: sender })
    } else if (type === 'win') {
      wins.add(key)
      setTimeout(() => { wins.delete(key) }, dedupeWindowMs)
    }
  }
  channel?.addEventListener('message', onMessage)

  return {
    async claim(key: string): Promise<boolean> {
      const started = now()
      const last = recent.get(key)
      if (last !== undefined && started - last < dedupeWindowMs) return false
      recent.set(key, started)
      if (channel === undefined) return true

      // C: a background tab yields the floor, so a visible tab claims first.
      if (!visible()) {
        await delay(visibleGraceMs)
        if (rivals.has(key)) {
          rivals.delete(key)
          return false
        }
      }
      const mine = { at: now(), tabId }
      channel.postMessage({ type: 'claim', key, ...mine } satisfies ClaimMessage)
      await delay(arbitrationMs)

      if (wins.delete(key)) {
        rivals.delete(key)
        return false
      }
      const rival = rivals.get(key)
      rivals.delete(key)
      if (rival !== undefined && beats(rival, mine)) return false
      channel.postMessage({ type: 'win', key, tabId } satisfies WinMessage)
      return true
    },
    dispose(): void {
      channel?.removeEventListener('message', onMessage)
      channel?.close()
    },
  }
}
