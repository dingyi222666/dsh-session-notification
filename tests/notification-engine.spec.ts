/**
 * Notification engine classification: running edges, pending edges (via the
 * uiSession pending map), failure detection, seeding, and cleanup. The engine
 * is dependency-injected and DOM-free, so these tests run under plain node
 * vitest.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  NotificationEngine, truncateDetail,
  type NotificationEnginePorts, type NotificationEvent, type PendingFacts, type SessionDetail,
} from '../src/client/notification-service.ts'

function summary(id: string, running: boolean) {
  return { id: id as SessionId, displayTitle: `会话 ${id}`, running, blank: false, updatedAt: 0 }
}

function list(byId: Record<string, ReturnType<typeof summary>>): SessionListState {
  return { ids: Object.keys(byId) as SessionId[], byId, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined } as unknown as SessionListState
}

function detail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return { maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, finalText: '', ...overrides }
}

function pending(sessionId: string, kind: PendingFacts['kind'], key = 'k1', text = ''): [string, PendingFacts] {
  return [sessionId, { key, kind, detail: text }]
}

function makePorts(overrides: Partial<NotificationEnginePorts> = {}): NotificationEnginePorts & { events: NotificationEvent[] } {
  const events: NotificationEvent[] = []
  return {
    detailOf: () => undefined,
    titleOf: (id) => String(id),
    settle: () => Promise.resolve(),
    emit: (event) => { events.push(event) },
    ...overrides,
    events,
  }
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('NotificationEngine', () => {
  it('raises nothing for sessions idle at seed', async () => {
    const ports = makePorts()
    const engine = new NotificationEngine(ports)
    engine.seed(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([])
  })

  it('notifies when a session that was running at seed finishes', async () => {
    const ports = makePorts({ detailOf: () => detail() })
    const engine = new NotificationEngine(ports)
    engine.seed(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('raises completed when a run ends without an error', async () => {
    const ports = makePorts({ detailOf: () => detail() })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('carries the final assistant text as the completed detail', async () => {
    const details = new Map<string, SessionDetail>([['a', detail({ finalText: '最初的回复' })]])
    const ports = makePorts({ detailOf: (id) => details.get(String(id)) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    details.set('a', detail({ finalText: '最终完成文本' }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '最终完成文本' }])
  })

  it('raises failed when a turn-error node appears during the run', async () => {
    const details = new Map<string, SessionDetail>([['a', detail()]])
    const ports = makePorts({ detailOf: (id) => details.get(String(id)) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    details.set('a', detail({ maxTurnErrorSeq: 12, failureMessage: 'boom' }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'failed', sessionId: 'a', title: 'a', detail: 'boom' }])
  })

  it('raises failed when a host agent-error lands during the run', async () => {
    const details = new Map<string, SessionDetail>([['a', detail()]])
    const ports = makePorts({ detailOf: (id) => details.get(String(id)) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    details.set('a', detail({ lastAgentError: 'loop crashed' }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'failed', sessionId: 'a', title: 'a', detail: 'loop crashed' }])
  })

  it('treats a stale pre-run agent error as not failed', async () => {
    const ports = makePorts({ detailOf: () => detail({ lastAgentError: 'stale' }) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('raises question when a pending question interaction arrives', () => {
    const ports = makePorts()
    const engine = new NotificationEngine(ports)
    engine.observePending(new Map([pending('a', 'question', 'q1', '继续吗?')]))
    expect(ports.events).toEqual([{ kind: 'question', sessionId: 'a', title: 'a', detail: '继续吗?' }])
  })

  it('raises permission when a pending approval interaction arrives', () => {
    const ports = makePorts()
    const engine = new NotificationEngine(ports)
    engine.observePending(new Map([pending('a', 'approval', 'a1', 'bash：run a command')]))
    expect(ports.events).toEqual([{ kind: 'permission', sessionId: 'a', title: 'a', detail: 'bash：run a command' }])
  })

  it('re-raises when the interaction is replaced with a new key', () => {
    const ports = makePorts()
    const engine = new NotificationEngine(ports)
    engine.observePending(new Map([pending('a', 'question', 'q1')]))
    engine.observePending(new Map([pending('a', 'question', 'q2')]))
    expect(ports.events).toEqual([
      { kind: 'question', sessionId: 'a', title: 'a', detail: '' },
      { kind: 'question', sessionId: 'a', title: 'a', detail: '' },
    ])
  })

  it('raises again when a pending kind switches', () => {
    const ports = makePorts()
    const engine = new NotificationEngine(ports)
    engine.observePending(new Map([pending('a', 'question', 'q1')]))
    engine.observePending(new Map([pending('a', 'approval', 'a2')]))
    expect(ports.events).toEqual([
      { kind: 'question', sessionId: 'a', title: 'a', detail: '' },
      { kind: 'permission', sessionId: 'a', title: 'a', detail: '' },
    ])
  })

  it('raises nothing when a pending interaction leaves the map', () => {
    const ports = makePorts()
    const engine = new NotificationEngine(ports)
    engine.observePending(new Map([pending('a', 'question', 'q1')]))
    engine.observePending(new Map())
    expect(ports.events).toEqual([{ kind: 'question', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('skips a stale settle when a newer run armed while settling', async () => {
    let release: (() => void) | undefined
    const ports = makePorts({
      detailOf: () => detail(),
      settle: () => new Promise<void>(resolve => { release = resolve }),
    })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    engine.observe(list({ a: summary('a', true) }))
    release?.()
    await flush()
    expect(ports.events).toEqual([])
  })

  it('forgets sessions that leave the list', async () => {
    const ports = makePorts({ detailOf: () => undefined })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({}))
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    // Reappearing session starts from a fresh prev: the run edge still fires.
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })
})

describe('truncateDetail', () => {
  it('truncates long detail text', () => {
    expect(truncateDetail('short')).toBe('short')
    expect(truncateDetail('x'.repeat(200)).length).toBe(160)
    expect(truncateDetail('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})
