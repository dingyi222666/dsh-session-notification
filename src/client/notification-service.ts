/**
 * The notification engine: watches the sessions-list snapshot for running
 * edges and the uiSession pending-interactions map for question/approval
 * edges, classifies each finished run as completed or failed from the chat
 * view nodes, and hands classified events to a dispatcher. The engine is
 * dependency-injected and DOM-free so the classification logic runs under
 * plain vitest; the browser wiring lives in `index.ts`.
 *
 * dsh 0.1.3-alpha.1 data model: the session snapshot still carries no chat
 * view or pending interaction — the chat view comes from
 * `uiConversation.binding(binding).target('chat')` and pending interactions
 * from the uiSession session-status source. The engine's session types now come
 * from the api-session-controller client (dsh-client-runtime was dissolved);
 * `AssistantBlock`/`TurnErrorNode` live with the ui-conversation records.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SessionListState, SessionSnapshot,
} from '@deepseek-ai/dsh-api-session-controller/client'
// dsh 0.1.3: the runtime package is gone; the chat-view node payload types
// (assistant text blocks and turn-error records) live with the conversation
// records in ui-conversation (re-exported by ui-chat's snapshot contract).
import type {
  AssistantBlock, TurnErrorNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NOTIFICATION_TAG_PREFIX } from './browser-notify.ts'
import type { NotificationMode, NotificationSettings, NotificationType, SoundId } from '../settings.ts'

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
  /**
   * Text of the latest user message (the request this run answered); '' when
   * the chat view holds none. Session titles come from the first prompt and
   * never move, so a notification titled with the session title names a
   * subject the user has long since left behind; this is the fresh subject.
   */
  lastUserText: string
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
  /**
   * Materialize the detail inputs before the settle read (open a session the
   * UI never opened so its chat view can assemble the final assistant text).
   * Optional and best-effort: a failure must not lose the classification.
   */
  ensureDetail?: (sessionId: SessionId) => Promise<void>
  /** Human display title of one session. */
  titleOf: (sessionId: SessionId) => string
  /**
   * Wait for trailing wire frames after a running edge (settle window).
   * @param attempt - zero-based re-check index; the wiring may return early
   * once the run has demonstrably settled.
   */
  settle: (attempt: number) => Promise<void>
  /**
   * Whether one session still reports running (re-read after the settle
   * window). A run that came back is a continuation, not a completion; an
   * absent reader counts as "not running" (the quiet fallback is to notify).
   * Optional: absent keeps the historical single-edge behavior.
   */
  isRunning?: (sessionId: SessionId) => boolean
  /**
   * Whether one session still has unfinished work of its own that will start
   * another turn without the user: a queued follow-up, an armed goal round, or
   * a live background job. The host running bit is false in all three, so a
   * completion notice there announces an end that has not happened. Optional:
   * absent holds nothing extra.
   */
  hasUnfinishedWork?: (sessionId: SessionId) => boolean
  /** Whether one session is a subagent (never the main session). */
  isSubagent: (sessionId: SessionId) => boolean
  /** Whether one session still has a running descendant (recursive). */
  hasRunningDescendants: (sessionId: SessionId) => boolean
  /** Deliver one classified event. */
  emit: (event: NotificationEvent) => void
}

/** Baseline captured when a run starts. */
interface RunState {
  baselineErrorSeq: number
  baselineAgentError: string | null
}

/**
 * How many settle rounds one finished run may re-check before its verdict
 * sticks. Auto-continuation (a goal round, a settled background job, a queued
 * follow-up) lands within a few seconds of the idle edge, so a single 250 ms
 * window is far too short to call a run finished.
 */
export const MAX_SETTLE_ATTEMPTS = 4

/**
 * Classifies session lifecycle edges into notification events. Running
 * true→false transitions arm a classification (completed vs failed) after the
 * settle window; a pending-interaction arrival raises the question/permission
 * kinds (observed through the uiSession pending map). A session that was
 * already idle when observation started raises nothing.
 *
 * A run only counts as finished once the session stayed idle across every
 * settle round: an idle edge that comes back running is a continuation, and
 * one that leaves queued work behind will start another turn by itself.
 */
export class NotificationEngine {
  private readonly prevRunning = new Map<SessionId, boolean>()
  private readonly runs = new Map<SessionId, RunState>()
  private readonly settling = new Set<SessionId>()
  private readonly pendingKeys = new Map<SessionId, string>()
  /** Completions held back until the session is genuinely quiet again. */
  private readonly heldCompletions = new Map<SessionId, { title: string, detail: string }>()
  /** Notification scope. Defaults to the durable default; wiring syncs it. */
  private mode: NotificationMode = 'main-wait'

  /** @param ports - injected readers and sink. */
  constructor(private readonly ports: NotificationEnginePorts) {}

  /** Update the notification scope (which sessions alert, subagent wait). */
  setNotificationMode(mode: NotificationMode): void {
    const previous = this.mode
    this.mode = mode
    // Silencing subagents forgets their tracking so a stale running edge can
    // never fire for one after the switch.
    if (mode !== 'all') this.forgetSubagents()
    // Leaving the waiting mode releases anything already held.
    if (previous === 'main-wait' && mode !== 'main-wait') this.releaseHeld()
  }

  /**
   * Emit every held completion whose session is now genuinely finished
   * (descendants settled, no run back in flight, no work queued). A held
   * event waits for a later snapshot to prove that; a run that starts
   * meanwhile supersedes it in {@link armRun}.
   */
  private releaseHeld(): void {
    for (const [id, held] of [...this.heldCompletions]) {
      if (!this.finished(id)) continue
      this.heldCompletions.delete(id)
      this.ports.emit({ kind: 'completed', sessionId: id, title: held.title, detail: held.detail })
    }
  }

  /**
   * Whether one session is genuinely finished: no running turn, no running
   * descendant, and no unfinished work that will start another turn by itself.
   * Anything else is a pause, and a completion notice there announces an end
   * the user has not reached — the continuation's own end classifies instead.
   */
  private finished(id: SessionId): boolean {
    if (this.ports.isRunning?.(id) === true) return false
    if (this.ports.hasUnfinishedWork?.(id) === true) return false
    return !this.waitsFor(id)
  }

  /** Whether one session should stay silent (subagents under a main-only mode). */
  private silenced(id: SessionId): boolean {
    return this.mode !== 'all' && this.ports.isSubagent(id)
  }

  /** Whether one completion must wait for its still-running descendants. */
  private waitsFor(id: SessionId): boolean {
    return this.mode === 'main-wait' && this.ports.hasRunningDescendants(id)
  }

  /** Drop tracking state for every subagent session (subagents were silenced). */
  private forgetSubagents(): void {
    for (const id of new Set([...this.prevRunning.keys(), ...this.runs.keys(), ...this.pendingKeys.keys()])) {
      if (!this.ports.isSubagent(id)) continue
      this.prevRunning.delete(id)
      this.runs.delete(id)
      this.pendingKeys.delete(id)
    }
  }

  /**
   * Process one sessions-list snapshot (called on every list change).
   * @param sessions - the latest list snapshot.
   */
  observe(sessions: SessionListState): void {
    const seen = new Set<SessionId>()
    for (const summary of Object.values(sessions.byId)) {
      const id = summary.id
      seen.add(id)
      if (this.silenced(id)) {
        // Never track a silenced subagent; drop any state left from when the
        // filter was off so no stale edge fires.
        this.prevRunning.delete(id)
        this.runs.delete(id)
        this.pendingKeys.delete(id)
        continue
      }
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
        this.heldCompletions.delete(id)
      }
    }
    // A descendant may have just settled: release any completion waiting on it.
    this.releaseHeld()
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
      if (this.silenced(id)) continue
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
      if (this.silenced(id)) {
        this.pendingKeys.delete(id)
        continue
      }
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
    // A new run supersedes any completion still waiting on descendants.
    this.heldCompletions.delete(id)
    const detail = this.ports.detailOf(id)
    this.runs.set(id, {
      baselineErrorSeq: detail?.maxTurnErrorSeq ?? 0,
      baselineAgentError: detail?.lastAgentError ?? null,
    })
  }

  /** Classify a finished run after the settle rounds (completed vs failed). */
  private async settleRun(id: SessionId): Promise<void> {
    const run = this.runs.get(id)
    if (run === undefined || this.settling.has(id)) return
    this.runs.delete(id)
    this.settling.add(id)
    try {
      for (let attempt = 0; attempt < MAX_SETTLE_ATTEMPTS; attempt += 1) {
        await this.ports.settle(attempt)
        // A newer run armed while settling will classify itself; skip the stale one.
        if (this.runs.has(id)) return
        // An idle edge that came back is a continuation — a goal round, a
        // settled background job, a queued follow-up waking a new turn — not a
        // finished run. Stop confirming: the verdict below holds it.
        if (this.ports.isRunning?.(id) === true) break
      }
      // The filter may have changed while settling (e.g. main-only re-enabled):
      // never emit for a session that is now silenced.
      if (this.silenced(id)) {
        this.prevRunning.delete(id)
        return
      }
      // A session the user never opened has no loaded history, so its chat
      // view holds no nodes yet; materialize it best-effort before reading.
      try {
        await this.ports.ensureDetail?.(id)
      } catch {
        // Best effort only: classify from whatever snapshot reads exist.
      }
      const detail = this.ports.detailOf(id)
      const failed = detail !== undefined && (
        detail.maxTurnErrorSeq > run.baselineErrorSeq ||
        (detail.lastAgentError !== null && detail.lastAgentError !== run.baselineAgentError)
      )
      const message = failed
        ? (detail?.failureMessage ?? detail?.lastAgentError ?? '')
        : (detail?.finalText ?? '')
      if (failed) {
        // A failure is actionable now: never hold it behind subagents.
        this.heldCompletions.delete(id)
        this.ports.emit({ kind: 'failed', sessionId: id, title: this.label(id, detail), detail: message })
        return
      }
      // Not finished: descendants still run, or the session will start another
      // turn on its own (a queued follow-up, an armed goal round, a live job).
      // Hold the notice and release it once a later snapshot proves the whole
      // thing ended — a continuation supersedes it in `armRun` instead.
      if (!this.finished(id)) {
        this.heldCompletions.set(id, { title: this.label(id, detail), detail: message })
        return
      }
      this.ports.emit({ kind: 'completed', sessionId: id, title: this.label(id, detail), detail: message })
    } finally {
      this.settling.delete(id)
    }
  }

  /**
   * The freshest subject an event can name: the latest user message (what the
   * run was actually about), falling back to the session title when the chat
   * view holds no user message. Session titles come from the first prompt and
   * never move, so they name a subject long left behind.
   */
  private label(id: SessionId, detail?: SessionDetail): string {
    const read = detail ?? this.ports.detailOf(id)
    const text = read?.lastUserText?.trim() ?? ''
    if (text.length > 0) return truncateTitle(text)
    return this.ports.titleOf(id)
  }

  /** Raise the question/permission kind on a pending-interaction arrival. */
  private raise(kind: PendingFacts['kind'], id: SessionId, detail: string): void {
    this.ports.emit({
      // The plugin's four kinds fold the alpha 'approval' interaction into
      // the 'permission' kind (and 'question'/'plan-review' into 'question').
      kind: kind === 'approval' ? 'permission' : 'question',
      sessionId: id,
      title: this.label(id),
      detail,
    })
  }
}

/**
 * Project one session's lifecycle + chat snapshots into the engine's
 * {@link SessionDetail}. The final completion text is the joined text of the
 * last assistant step (the chat view's `assistant-step` node) that carries
 * any; the notification subject is the latest `user` node's text, which names
 * the request the run answered instead of the long-stale session title.
 * Failure classification reads the chat view's turn-error nodes plus the
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
  let lastUserText = ''
  let lastUserSeq = -1
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
      } else if (node.kind === 'user') {
        const data = node.data as { seq: number, content: readonly ContentBlockLike[] }
        if (data.seq > lastUserSeq) {
          lastUserSeq = data.seq
          lastUserText = userTextOf(data.content)
        }
      }
    }
  }
  return {
    maxTurnErrorSeq,
    failureMessage,
    lastAgentError: session.lastAgentError,
    finalText,
    lastUserText,
  }
}

/** Minimal structural view of one user-message content block. */
interface ContentBlockLike {
  type: string
  text?: string
}

/** Join the text blocks of one user message (attachments and images carry no text). */
function userTextOf(content: readonly ContentBlockLike[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

/** Cap the notification subject (a user message can be a whole paragraph). */
export function truncateTitle(text: string, max = 60): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1)}…`
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
  /**
   * Show one system notification under the event kind's collapse tag; the
   * session id lets the click action navigate back to the event's session.
   */
  showBrowser: (title: string, body: string, tag: string, sessionId: SessionId) => boolean
  /** Whether one session is the one currently shown in the main view. */
  isCurrent: (sessionId: SessionId) => boolean
  /** Whether the document is hidden (background tab, minimized, or occluded). */
  isHidden: () => boolean
  /**
   * Whether the document has focus; false while another application is in
   * front. Optional — an absent reader counts as focused, the quiet side.
   */
  hasFocus?: () => boolean
}

/**
 * Applies the durable preferences to one classified event. The session you
 * are reading stays quiet by default; `currentNotificationMode` widens that
 * (`unfocused` also alerts once another application is in front, `always`
 * alerts regardless). Every other session alerts whenever you are away from
 * it: the kind's effective sound plays when sound is enabled, and a system
 * notification shows when browser notifications are enabled.
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
    const isCurrent = this.deps.isCurrent(event.sessionId)
    const mode = settings.currentNotificationMode
    // "Away" from the session you are reading: a backgrounded window counts
    // for every mode, another application in front only for 'unfocused', and
    // 'always' is never quiet. Focus is read only when the mode needs it.
    const away = this.deps.isHidden() || (mode === 'unfocused' && this.deps.hasFocus?.() === false)
    if (isCurrent && !away && mode !== 'always') return

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
    this.deps.showBrowser(title, body, `${NOTIFICATION_TAG_PREFIX}:${event.kind}`, event.sessionId)
  }
}
