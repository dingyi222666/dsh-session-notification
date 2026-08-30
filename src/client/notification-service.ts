/**
 * The notification engine: watches the sessions-list snapshot for running
 * edges and the uiSession pending-interactions map for question/approval
 * edges, classifies each finished run as completed or failed from the chat
 * view nodes, and hands classified events to a dispatcher. The engine is
 * dependency-injected and DOM-free so the classification logic runs under
 * plain vitest; the browser wiring lives in `index.ts`.
 *
 * dsh 0.1.2-alpha.2 data model: the session snapshot no longer carries the
 * chat view (`chat.nodes`) or `pendingInteraction` — the chat view comes from
 * `uiConversation.binding(binding).target('chat')` and pending interactions
 * from `uiSession.pendingInteractions`, so the engine reads those two
 * surfaces instead of the old single list snapshot.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  AssistantBlock, SessionListState, TurnErrorNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { NotificationSettings, NotificationType, SoundId } from '../settings.ts'

/** One selectable notification kind (re-export for the settings rows). */
export type { NotificationType } from '../settings.ts'

/** Minimal structural view of the alpha chat target snapshot (ui-chat ChatSnapshot). */
export interface ChatViewNode {
  kind: string
  data: unknown
}

/** Minimal structural view of the chat node store. */
export interface ChatNodeStoreLike {
  values(): IterableIterator<ChatViewNode>
}

/** Minimal structural view of the chat snapshot the engine classifies on. */
export interface ChatSnapshotLike {
  nodes: ChatNodeStoreLike
}

/** One pending interaction's notification facts (from uiSession). */
export interface PendingFacts {
  /** Interaction identity; a replacement interaction carries a new key. */
  key: string
  /** Plugin notification kind: question covers 'question'/'plan-review'. */
  kind: 'question' | 'approval'
  /** Interaction detail text (question text / tool name). */
  detail: string
}

/** Per-session facts the engine reads from the session and chat snapshots. */
export interface SessionDetail {
  /** Max seq of materialized turn-error nodes (unretried failures only). */
  maxTurnErrorSeq: number
  /** Most recent failure message, when one is visible. */
  failureMessage: string | null
  /** Host agent-error text, null when none. */
  lastAgentError: string | null
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

/**
 * Classifies session lifecycle edges into notification events. Running
 * true→false transitions arm a classification (completed vs failed) after the
 * settle window; a pending-interaction arrival raises the question/permission
 * kinds (observed through the uiSession pending map). A session that was
 * already idle when observation started raises nothing.
 */
export class NotificationEngine {
  private readonly prevRunning = new Map<SessionId, boolean>()
  private readonly runs = new Map<SessionId, RunState>()
  private readonly settling = new Set<SessionId>()
  private readonly pendingKeys = new Map<SessionId, string>()

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
      const prevRunning = this.prevRunning.get(id) ?? false
      if (prevRunning && !summary.running) {
        void this.settleRun(id)
      } else if (!prevRunning && summary.running) {
        this.armRun(id)
      }
      this.prevRunning.set(id, summary.running)
    }
    for (const id of this.prevRunning.keys()) {
      if (!seen.has(id)) {
        this.prevRunning.delete(id)
        this.runs.delete(id)
        this.pendingKeys.delete(id)
      }
    }
  }

  /**
   * Establish the baseline before live observation: record every session's
   * current running bit and arm runs already in progress, but raise nothing —
   * idle sessions that predate the plugin raise no notification.
   * @param sessions - the first list snapshot.
   */
  seed(sessions: SessionListState): void {
    for (const summary of Object.values(sessions.byId)) {
      const id = summary.id
      this.prevRunning.set(id, summary.running)
      if (summary.running) this.armRun(id)
    }
  }

  /**
   * Process one uiSession pending-interactions snapshot. A session entering
   * the map (or replacing its interaction — a new key, or a kind switch)
   * raises the question/permission kind; leaving the map raises nothing.
   * @param pending - current effective pending interaction per session.
   */
  observePending(pending: ReadonlyMap<SessionId, PendingFacts>): void {
    for (const [id, facts] of pending) {
      const prevKey = this.pendingKeys.get(id)
      if (prevKey === undefined || prevKey !== facts.key) {
        this.raise(facts.kind, id, facts.detail)
      }
      this.pendingKeys.set(id, facts.key)
    }
    for (const id of this.pendingKeys.keys()) {
      if (!pending.has(id)) this.pendingKeys.delete(id)
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

  /** Raise the question/permission kind on a pending-interaction arrival. */
  private raise(kind: PendingFacts['kind'], id: SessionId, detail: string): void {
    this.ports.emit({
      // The plugin's four kinds fold the alpha 'approval' interaction into
      // the 'permission' kind (and 'question'/'plan-review' into 'question').
      kind: kind === 'approval' ? 'permission' : 'question',
      sessionId: id,
      title: this.ports.titleOf(id),
      detail,
    })
  }
}

/**
 * Project one session's lifecycle + chat snapshots into the engine's
 * {@link SessionDetail}. The final completion text is the joined text of the
 * last assistant step (the chat view's `assistant-step` node) that carries
 * any; failure classification reads the chat view's turn-error nodes plus the
 * session's host agent-error. An absent chat target (session not opened)
 * yields no turn-error or final-text facts, never a throw.
 * @param session - the session lifecycle snapshot (session-controller).
 * @param chat - the session's chat view snapshot, when one is materialized.
 * @returns the derived detail.
 */
export function sessionDetailOf(
  session: SessionSnapshot,
  chat: ChatSnapshotLike | undefined,
): SessionDetail {
  let maxTurnErrorSeq = 0
  let failureMessage: string | null = null
  let finalText = ''
  if (chat !== undefined) {
    for (const node of chat.nodes.values()) {
      if (node.kind === 'turn-error') {
        const data = node.data as TurnErrorNode
        if (data.seq > maxTurnErrorSeq) {
          maxTurnErrorSeq = data.seq
          failureMessage = data.message
        }
      } else if (node.kind === 'assistant-step') {
        const data = node.data as { blocks: readonly AssistantBlock[] }
        const text = data.blocks
          .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block.kind === 'text')
          .map(block => block.text)
          .join('')
        if (text.length > 0) finalText = text
      }
    }
  }
  return {
    maxTurnErrorSeq,
    failureMessage,
    lastAgentError: session.lastAgentError,
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
