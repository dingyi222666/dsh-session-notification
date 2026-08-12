/**
 * The notification engine: watches the sessions-list snapshot for running and
 * pending-interaction edges, classifies each finished run as completed or
 * failed from the session's conversation snapshot, and hands classified
 * events to a dispatcher. The engine is dependency-injected and DOM-free so
 * the classification logic runs under plain vitest; the browser wiring lives
 * in `index.ts`.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  AssistantBlock, ConversationSnapshot, PendingInteraction, PendingInteractionStatus,
  SessionListState, TurnErrorNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { NotificationSettings, NotificationType, SoundId } from '../settings.ts'

/** One selectable notification kind (re-export for the settings rows). */
export type { NotificationType } from '../settings.ts'

/** Per-session facts the engine reads from the conversation snapshot. */
export interface SessionDetail {
  /** Max seq of materialized turn-error nodes (unretried failures only). */
  maxTurnErrorSeq: number
  /** Most recent failure message, when one is visible. */
  failureMessage: string | null
  /** Host agent-error text, null when none. */
  lastAgentError: string | null
  /** Pending interactions visible in the session snapshot. */
  pending: readonly PendingInteraction[]
  /** Text of the last assistant message (the final completion text); '' when none. */
  finalText: string
}

/** One classified notification event. */
export interface NotificationEvent {
  kind: NotificationType
  sessionId: SessionId
  /** Human display title of the session. */
  title: string
  /** Kind-specific detail (error message, question text, tool name). */
  detail: string
}

/** Engine dependencies (injected by the browser wiring; stubbed in tests). */
export interface NotificationEnginePorts {
  /** Read one session's detail snapshot; undefined when unavailable. */
  detailOf: (sessionId: SessionId) => SessionDetail | undefined
  /** Human display title of one session. */
  titleOf: (sessionId: SessionId) => string
  /** Wait for trailing wire frames after a running edge (settle window). */
  settle: () => Promise<void>
  /** Deliver one classified event. */
  emit: (event: NotificationEvent) => void
}

/** Baseline captured when a run starts. */
interface RunState {
  baselineErrorSeq: number
  baselineAgentError: string | null
}

/** Last-observed list signal for one session. */
interface PrevSignal {
  running: boolean
  pending: PendingInteractionStatus | undefined
}

/**
 * Classifies session lifecycle edges into notification events. Edges are
 * observed on the sessions-list snapshot: a running true→false transition
 * arms a classification (completed vs failed) after the settle window; a
 * pending-interaction arrival raises the question/permission kinds. A session
 * that was already idle when observation started raises nothing.
 */
export class NotificationEngine {
  private readonly prev = new Map<SessionId, PrevSignal>()
  private readonly runs = new Map<SessionId, RunState>()
  private readonly settling = new Set<SessionId>()

  /** @param ports - injected readers and sink. */
  constructor(private readonly ports: NotificationEnginePorts) {}

  /**
   * Process one sessions-list snapshot (called on every list change).
   * @param sessions - the latest list snapshot.
   */
  observe(sessions: SessionListState): void {
    const seen = new Set<SessionId>()
    for (const summary of Object.values(sessions.byId)) {
      const id = summary.id
      seen.add(id)
      const prev = this.prev.get(id) ?? { running: false, pending: undefined }
      if (summary.pendingInteraction !== prev.pending) {
        if (summary.pendingInteraction === 'question') this.raise('question', id)
        else if (summary.pendingInteraction === 'approval') this.raise('permission', id)
        prev.pending = summary.pendingInteraction
      }
      if (prev.running && !summary.running) {
        void this.settleRun(id)
      } else if (!prev.running && summary.running) {
        this.armRun(id)
      }
      prev.running = summary.running
      this.prev.set(id, prev)
    }
    for (const id of this.prev.keys()) {
      if (!seen.has(id)) {
        this.prev.delete(id)
        this.runs.delete(id)
      }
    }
  }

  /**
   * Establish the baseline before live observation: record every session's
   * current signal and arm runs already in progress, but raise nothing —
   * pending interactions and idle sessions that predate the plugin raise no
   * notification.
   * @param sessions - the first list snapshot.
   */
  seed(sessions: SessionListState): void {
    for (const summary of Object.values(sessions.byId)) {
      const id = summary.id
      this.prev.set(id, { running: summary.running, pending: summary.pendingInteraction })
      if (summary.running) this.armRun(id)
    }
  }

  /** Capture the pre-run failure baseline when a run starts. */
  private armRun(id: SessionId): void {
    const detail = this.ports.detailOf(id)
    this.runs.set(id, {
      baselineErrorSeq: detail?.maxTurnErrorSeq ?? 0,
      baselineAgentError: detail?.lastAgentError ?? null,
    })
  }

  /** Classify a finished run after the settle window (completed vs failed). */
  private async settleRun(id: SessionId): Promise<void> {
    const run = this.runs.get(id)
    if (run === undefined || this.settling.has(id)) return
    this.runs.delete(id)
    this.settling.add(id)
    try {
      await this.ports.settle()
      // A newer run armed while settling will classify itself; skip the stale one.
      if (this.runs.has(id)) return
      const detail = this.ports.detailOf(id)
      const failed = detail !== undefined && (
        detail.maxTurnErrorSeq > run.baselineErrorSeq ||
        (detail.lastAgentError !== null && detail.lastAgentError !== run.baselineAgentError)
      )
      const message = failed
        ? (detail?.failureMessage ?? detail?.lastAgentError ?? '')
        : (detail?.finalText ?? '')
      this.ports.emit({
        kind: failed ? 'failed' : 'completed',
        sessionId: id,
        title: this.ports.titleOf(id),
        detail: message,
      })
    } finally {
      this.settling.delete(id)
    }
  }

  /** Raise the question/permission kind on a pending-interaction edge. */
  private raise(kind: 'question' | 'permission', id: SessionId): void {
    const detail = this.ports.detailOf(id)
    const pending = detail?.pending ?? []
    this.ports.emit({
      kind,
      sessionId: id,
      title: this.ports.titleOf(id),
      detail: kind === 'question' ? questionText(pending) : approvalText(pending),
    })
  }
}

/** Extract the first question text from a session's pending interactions. */
export function questionText(pending: readonly PendingInteraction[]): string {
  for (const item of pending) {
    if (item.kind !== 'question') continue
    const first = item.payload.questions[0]
    if (first !== undefined && first.question.length > 0) return first.question
  }
  return ''
}

/** Extract the tool name (+ reason) from a session's pending approvals. */
export function approvalText(pending: readonly PendingInteraction[]): string {
  for (const item of pending) {
    if (item.kind !== 'approval') continue
    const { toolName, reason } = item.payload
    return reason !== undefined && reason.length > 0 ? `${toolName}：${reason}` : toolName
  }
  return ''
}

/**
 * Project one conversation snapshot into the engine's {@link SessionDetail}.
 * The final completion text is the joined text of the last assistant step
 * (the chat view's `assistant-step` node) that carries any.
 * @param snapshot - the session's current conversation snapshot.
 * @returns the derived detail.
 */
export function sessionDetailOf(snapshot: ConversationSnapshot): SessionDetail {
  let maxTurnErrorSeq = 0
  let failureMessage: string | null = null
  let finalText = ''
  for (const node of snapshot.chat.nodes.values()) {
    if (node.kind === 'turn-error') {
      const data = node.data as TurnErrorNode
      if (data.seq > maxTurnErrorSeq) {
        maxTurnErrorSeq = data.seq
        failureMessage = data.message
      }
    } else if (node.kind === 'assistant-step') {
      const data = node.data as { readonly blocks: readonly AssistantBlock[] }
      const text = data.blocks
        .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block.kind === 'text')
        .map(block => block.text)
        .join('')
      if (text.length > 0) finalText = text
    }
  }
  return {
    maxTurnErrorSeq,
    failureMessage,
    lastAgentError: snapshot.lastAgentError,
    pending: snapshot.pending,
    finalText,
  }
}

/** Cap the detail text shown in a notification. */
export function truncateDetail(text: string, max = 160): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/** Dispatcher dependencies (injected by the browser wiring; stubbed in tests). */
export interface NotificationDispatcherDeps {
  /** Read the current durable preferences at dispatch time. */
  settings: () => NotificationSettings
  /** Bound namespace translate. */
  t: (key: string) => string
  /**
   * Play one sound effect; `custom` carries the data URL resolved from
   * {@link customSoundOf}.
   */
  playSound: (sound: SoundId, customUrl?: string) => void
  /** Read one kind's custom sound data URL (undefined = use the built-in). */
  customSoundOf: (kind: NotificationType) => string | undefined
  /** Show one system notification; returns whether it was shown. */
  showBrowser: (title: string, body: string) => boolean
  /** The currently selected session, when one is selected. */
  currentSession: () => SessionId | undefined
  /** Whether the document is hidden (backgrounded). */
  isHidden: () => boolean
}

/**
 * Applies the durable preferences to one classified event. The session you
 * are reading stays quiet by default: while it is current and the tab is
 * visible, nothing fires unless the `notifyCurrent` toggle opts it in.
 * Otherwise the kind's effective sound (the uploaded custom audio when the
 * picker selects 自定义, else the selected built-in) plays when sound is
 * enabled, and a system notification shows when browser notifications are
 * enabled and the user is not looking at that session (backgrounded, or
 * focused elsewhere).
 */
export class NotificationDispatcher {
  /** @param deps - injected readers and sinks. */
  constructor(private readonly deps: NotificationDispatcherDeps) {}

  /**
   * Dispatch one event.
   * @param event - the classified event.
   */
  dispatch(event: NotificationEvent): void {
    const settings = this.deps.settings()
    const type = settings.types[event.kind]
    if (!type.enabled) return
    const isCurrent = this.deps.currentSession() === event.sessionId
    const hidden = this.deps.isHidden()
    // Not interrupting what you are reading: the current, visible session
    // alerts only when the user opted in.
    if (isCurrent && !hidden && !settings.notifyCurrent) return
    const title = this.deps.t(`notify.${event.kind}.title`)
    const template = this.deps.t(`notify.${event.kind}.body`)
    const detail = truncateDetail(event.detail)
    const base = template.replaceAll('{title}', event.title)
    // A completed run's detail is the final assistant text — show it on its
    // own line so long-form content reads naturally; the other kinds embed
    // the detail inline in their templates.
    const body = event.kind === 'completed'
      ? (detail.length > 0 ? `${base}\n${detail}` : base)
      : base.replaceAll('{detail}', detail)
    if (settings.soundEnabled) {
      // The custom audio plays only when the kind's picker selects 自定义;
      // otherwise the selected built-in plays (a dormant custom file is inert).
      if (type.sound === 'custom') {
        const customUrl = this.deps.customSoundOf(event.kind)
        if (customUrl !== undefined) this.deps.playSound('custom', customUrl)
      } else if (type.sound !== 'none') {
        this.deps.playSound(type.sound)
      }
    }
    if (!settings.browserEnabled) return
    const elsewhere = hidden || !isCurrent || settings.notifyCurrent
    if (elsewhere) this.deps.showBrowser(title, body)
  }
}
