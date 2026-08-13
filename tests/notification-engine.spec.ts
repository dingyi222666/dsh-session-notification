/**
 * Notification engine classification: running edges, pending edges, failure
 * detection, seeding, and cleanup. The engine is dependency-injected and
 * DOM-free, so these tests run under plain node vitest.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  PendingInteraction, PendingInteractionStatus, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  NotificationEngine, questionText, approvalText, truncateDetail,
  type NotificationEnginePorts, type NotificationEvent, type SessionDetail,
} from '../src/client/notification-service.ts'

function summary(id: string, running: boolean, pending?: PendingInteractionStatus) {
  return { id: id as SessionId, displayTitle: `会话 ${id}`, running, blank: false, updatedAt: 0, ...(pending === undefined ? {} : { pendingInteraction: pending }) }
}

function list(byId: Record<string, ReturnType<typeof summary>>): SessionListState {
  return { ids: Object.keys(byId) as SessionId[], byId, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined } as unknown as SessionListState
}

/** A question pending interaction (structural stand-in for PendingWait). */
function question(kind: 'question', text: string): PendingInteraction {
  return { kind, payload: { questions: [{ id: 'q1', question: text }] } } as unknown as PendingInteraction
}

/** An approval pending interaction (structural stand-in for PendingWait). */
function approval(tool: string, reason?: string): PendingInteraction {
  return { kind: 'approval', payload: { approvalId: 'a1', toolName: tool, ...(reason === undefined ? {} : { reason }) } } as unknown as PendingInteraction
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

  it('raises nothing for pre-existing pending interactions at seed', async () => {
    const ports = makePorts({ detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '' }) })
    const engine = new NotificationEngine(ports)
    engine.seed(list({ a: summary('a', false, 'question') }))
    engine.observe(list({ a: summary('a', false, 'question') }))
    await flush()
    expect(ports.events).toEqual([])
  })

  it('notifies when a session that was running at seed finishes', async () => {
    const ports = makePorts({ detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '' }) })
    const engine = new NotificationEngine(ports)
    engine.seed(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('raises completed when a run ends without an error', async () => {
    const ports = makePorts({ detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '' }) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('carries the final assistant text as the completed detail', async () => {
    const details = new Map<string, SessionDetail>([
      ['a', { maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '最初的回复' }],
    ])
    const ports = makePorts({ detailOf: (id) => details.get(String(id)) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    details.set('a', { maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '最终完成文本' })
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '最终完成文本' }])
  })

  it('raises failed when a turn-error node appears during the run', async () => {
    const details = new Map<string, SessionDetail>([
      ['a', { maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '' }],
    ])
    const ports = makePorts({ detailOf: (id) => details.get(String(id)) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    details.set('a', { maxTurnErrorSeq: 12, failureMessage: 'boom', lastAgentError: null, pending: [], finalText: '' })
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'failed', sessionId: 'a', title: 'a', detail: 'boom' }])
  })

  it('raises failed when a host agent-error lands during the run', async () => {
    const details = new Map<string, SessionDetail>([
      ['a', { maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '' }],
    ])
    const ports = makePorts({ detailOf: (id) => details.get(String(id)) })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    details.set('a', { maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: 'loop crashed', pending: [], finalText: '' })
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'failed', sessionId: 'a', title: 'a', detail: 'loop crashed' }])
  })

  it('treats a stale pre-run agent error as not failed', async () => {
    const ports = makePorts({
      detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: 'stale', pending: [], finalText: '' }),
    })
    const engine = new NotificationEngine(ports)
    engine.observe(list({ a: summary('a', true) }))
    engine.observe(list({ a: summary('a', false) }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'completed', sessionId: 'a', title: 'a', detail: '' }])
  })

  it('raises question when the pending interaction becomes a question', async () => {
    const ports = makePorts({ detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [question('question', '继续吗?')], finalText: '' }) })
    const engine = new NotificationEngine(ports)
    engine.seed(list({ a: summary('a', false) }))
    engine.observe(list({ a: summary('a', false, 'question') }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'question', sessionId: 'a', title: 'a', detail: '继续吗?' }])
  })

  it('raises permission when the pending interaction becomes an approval', async () => {
    const ports = makePorts({ detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [approval('bash', 'run a command')], finalText: '' }) })
    const engine = new NotificationEngine(ports)
    engine.seed(list({ a: summary('a', false) }))
    engine.observe(list({ a: summary('a', false, 'approval') }))
    await flush()
    expect(ports.events).toEqual([{ kind: 'permission', sessionId: 'a', title: 'a', detail: 'bash：run a command' }])
  })

  it('skips a stale settle when a newer run armed while settling', async () => {
    let release: (() => void) | undefined
    const ports = makePorts({
      detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, pending: [], finalText: '' }),
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

describe('detail text extraction', () => {
  it('extracts the first question text', () => {
    expect(questionText([approval('bash'), question('question', '继续吗?'), question('question', '真的吗?')])).toBe('继续吗?')
    expect(questionText([])).toBe('')
  })

  it('extracts the approval tool with its reason', () => {
    expect(approvalText([question('question', 'x'), approval('fs', 'delete')])).toBe('fs：delete')
    expect(approvalText([approval('fs')])).toBe('fs')
    expect(approvalText([])).toBe('')
  })

  it('truncates long detail text', () => {
    expect(truncateDetail('short')).toBe('short')
    expect(truncateDetail('x'.repeat(200)).length).toBe(160)
    expect(truncateDetail('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})
