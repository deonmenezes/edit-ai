import { useCallback, useEffect, useRef, useState } from "react"
import { trueforge, TrueForgeError, type TFEvent, type TurnInput } from "#/lib/trueforge"

export type ToolCall = { id: string; name: string; args: string }

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; threadId: string; text: string; toolCalls: ToolCall[] }
  | { kind: "tool"; id: string; threadId: string; toolCallId: string; name: string; content: string }
  | { kind: "thread"; id: string; threadId: string; title: string; done: boolean }
  | { kind: "note"; id: string; text: string }

export type PendingApproval = { threadId: string; toolCallId: string; name: string; args: string }
export type PendingQuestion = { threadId: string; toolCallId: string; question: string; options: string[] }
export type PendingAuth = { name: string; authUrl: string }

export type AssistantState = {
  status: "idle" | "connecting" | "ready" | "running" | "offline"
  error: string | null
  sessionId: string | null
  items: ChatItem[]
  approvals: PendingApproval[]
  questions: PendingQuestion[]
  auth: PendingAuth[]
}

const STORAGE = "editai.assistant"
const AGENT_NAME = (import.meta.env.VITE_EDITAI_AGENT_NAME as string | undefined) ?? "editai"

type Persisted = { sessionId: string; turnId?: string; seq?: number }

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch {
    return null
  }
}
function save(p: Persisted | null) {
  try {
    if (p) localStorage.setItem(STORAGE, JSON.stringify(p))
    else localStorage.removeItem(STORAGE)
  } catch {
    // storage unavailable
  }
}

/** Folds turn events (live or replayed) into chat items and pending actions. */
class Transcript {
  items: ChatItem[] = []
  events = new Map<string, TFEvent>()
  approvals: PendingApproval[] = []
  questions: PendingQuestion[] = []
  auth: PendingAuth[] = []

  private upsert(item: ChatItem) {
    const i = this.items.findIndex((x) => x.id === item.id)
    if (i === -1) this.items.push(item)
    else this.items[i] = item
  }

  user(id: string, text: string) {
    this.upsert({ kind: "user", id, text })
  }

  clearPending() {
    this.approvals = []
    this.questions = []
    this.auth = []
  }

  private toolCallsOf(ev: TFEvent): ToolCall[] {
    const calls = (ev.tool_calls as Array<Record<string, any>> | undefined) ?? []
    return calls.map((tc) => ({
      id: String(tc.id ?? ""),
      name: String(tc.function?.name ?? tc.tool_info?.name ?? "tool"),
      args: String(tc.function?.arguments ?? ""),
    }))
  }

  apply(ev: TFEvent) {
    const threadId = (ev.thread_id as string | null) ?? "main"
    switch (ev.type) {
      case "model.message": {
        this.events.set(ev.id, ev)
        this.upsert({ kind: "assistant", id: ev.id, threadId, text: String(ev.content ?? ""), toolCalls: this.toolCallsOf(ev) })
        break
      }
      case "model.message.delta": {
        const base = this.events.get(ev.id)
        if (!base) {
          this.events.set(ev.id, { ...ev, type: "model.message" })
          this.upsert({ kind: "assistant", id: ev.id, threadId, text: String(ev.content ?? ""), toolCalls: [] })
          return
        }
        if (typeof ev.content === "string") base.content = String(base.content ?? "") + ev.content
        const deltas = (ev.tool_calls as Array<Record<string, any>> | undefined) ?? []
        if (deltas.length) {
          const calls = ((base.tool_calls as Array<Record<string, any>>) ??= [])
          for (const d of deltas) {
            const idx = typeof d.index === "number" ? d.index : calls.length
            const target = (calls[idx] ??= { id: "", function: { name: "", arguments: "" } })
            if (d.id) target.id = d.id
            if (d.function?.name) target.function.name = (target.function.name ?? "") + d.function.name
            if (d.function?.arguments) target.function.arguments = (target.function.arguments ?? "") + d.function.arguments
            if (d.tool_info) target.tool_info = d.tool_info
          }
        }
        this.upsert({ kind: "assistant", id: ev.id, threadId, text: String(base.content ?? ""), toolCalls: this.toolCallsOf(base) })
        break
      }
      case "tool.response": {
        const callId = String(ev.tool_call_id ?? "")
        const name = this.findCall(callId)?.name ?? "tool"
        this.upsert({ kind: "tool", id: ev.id, threadId, toolCallId: callId, name, content: String(ev.content ?? "") })
        break
      }
      case "thread.created": {
        this.upsert({ kind: "thread", id: `thread:${ev.thread_id}`, threadId, title: String(ev.title ?? "Sub-agent"), done: false })
        break
      }
      case "thread.done": {
        const existing = this.items.find((x) => x.kind === "thread" && x.threadId === threadId)
        this.upsert({ kind: "thread", id: `thread:${ev.thread_id}`, threadId, title: existing?.kind === "thread" ? existing.title : "Sub-agent", done: true })
        break
      }
      case "tool.approval_required": {
        for (const ref of (ev.tool_calls as Array<{ id: string; source_event_id: string }>) ?? []) {
          const call = this.findCall(ref.id, ref.source_event_id)
          this.approvals.push({ threadId, toolCallId: ref.id, name: call?.name ?? "tool", args: call?.args ?? "" })
        }
        break
      }
      case "tool.response_required": {
        for (const ref of (ev.tool_calls as Array<{ id: string; source_event_id: string }>) ?? []) {
          const call = this.findCall(ref.id, ref.source_event_id)
          let question = "The agent needs your input."
          let options: string[] = []
          try {
            const parsed = JSON.parse(call?.args || "{}") as { question?: string; options?: string[] }
            if (parsed.question) question = parsed.question
            if (Array.isArray(parsed.options)) options = parsed.options.map(String)
          } catch {
            // free-form
          }
          this.questions.push({ threadId, toolCallId: ref.id, question, options })
        }
        break
      }
      case "mcp.auth_required": {
        for (const s of (ev.mcp_servers as Array<{ name: string; auth_url: string }>) ?? []) {
          this.auth.push({ name: s.name, authUrl: s.auth_url })
        }
        break
      }
      case "turn.done": {
        const state = ev.state as { status: string; message?: string; reason?: string }
        if (state.status === "error") this.upsert({ kind: "note", id: `${ev.id}:err`, text: `The agent stopped with an error: ${state.message ?? "unknown"}` })
        if (state.status === "cancelled" && state.reason !== "cancelled-for-next-turn") this.upsert({ kind: "note", id: `${ev.id}:cancel`, text: "Turn cancelled." })
        break
      }
      default:
        break
    }
  }

  private findCall(callId: string, sourceEventId?: string): ToolCall | undefined {
    const from = sourceEventId ? this.events.get(sourceEventId) : undefined
    const pools = from ? [from] : [...this.events.values()]
    for (const ev of pools) {
      const call = this.toolCallsOf(ev).find((c) => c.id === callId)
      if (call) return call
    }
    return undefined
  }
}

export function useAssistant() {
  const [state, setState] = useState<AssistantState>({
    status: "idle",
    error: null,
    sessionId: null,
    items: [],
    approvals: [],
    questions: [],
    auth: [],
  })
  const transcript = useRef(new Transcript())
  const abort = useRef<AbortController | null>(null)
  const persisted = useRef<Persisted | null>(null)

  const publish = useCallback((patch: Partial<AssistantState> = {}) => {
    const t = transcript.current
    setState((s) => ({ ...s, items: [...t.items], approvals: [...t.approvals], questions: [...t.questions], auth: [...t.auth], ...patch }))
  }, [])

  const consume = useCallback(
    async (stream: AsyncGenerator<{ id: number | null; event: TFEvent }>) => {
      const t = transcript.current
      for await (const { id, event } of stream) {
        if (id != null && persisted.current) {
          persisted.current.seq = id
          save(persisted.current)
        }
        if (event.type === "turn.created" && persisted.current) {
          persisted.current.turnId = String(event.turn_id)
          save(persisted.current)
          t.clearPending()
        }
        t.apply(event)
        publish()
      }
    },
    [publish],
  )

  // Restore a previous session: replay stored turns, then reattach to a running one.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setState((s) => ({ ...s, status: "connecting" }))
      try {
        await trueforge.ping()
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: "offline", error: "TrueForge is not reachable. Start it with `npx @truefoundry/trueforge` and reload." }))
        return
      }
      const stored = load()
      if (!stored) {
        if (!cancelled) setState((s) => ({ ...s, status: "ready" }))
        return
      }
      try {
        await trueforge.getSession(stored.sessionId)
        persisted.current = stored
        const t = transcript.current
        const turns = await trueforge.listTurns(stored.sessionId)
        for (const turn of turns) {
          t.clearPending()
          for (const input of turn.input ?? []) if (input.type === "user.message") t.user(`${turn.id}:user`, input.content)
          if (turn.state.status !== "running") {
            for (const ev of await trueforge.listTurnEvents(stored.sessionId, turn.id)) t.apply(ev)
          }
        }
        if (cancelled) return
        publish({ status: "ready", sessionId: stored.sessionId })
        const last = turns[turns.length - 1]
        if (last?.state.status === "running") {
          publish({ status: "running" })
          abort.current = new AbortController()
          await consume(trueforge.subscribeTurn(stored.sessionId, last.id, stored.turnId === last.id ? (stored.seq ?? 0) : 0, abort.current.signal))
          publish({ status: "ready" })
        }
      } catch (e) {
        if (e instanceof TrueForgeError && e.status === 404) save(null)
        if (!cancelled) setState((s) => ({ ...s, status: "ready", sessionId: null }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [consume, publish])

  const runTurn = useCallback(
    async (input: TurnInput[], userText?: string) => {
      const t = transcript.current
      try {
        let sessionId = persisted.current?.sessionId
        if (!sessionId) {
          const agents = await trueforge.listAgents()
          if (!agents.some((a) => a.name === AGENT_NAME)) {
            publish({ status: "ready", error: `No agent named "${AGENT_NAME}" in TrueForge. Run \`bun run setup\` in apps/agent.` })
            return
          }
          sessionId = (await trueforge.createSession(AGENT_NAME)).id
          persisted.current = { sessionId }
          save(persisted.current)
        }
        if (userText) t.user(`local:${Date.now()}`, userText)
        publish({ status: "running", error: null, sessionId })
        abort.current = new AbortController()
        await consume(trueforge.streamTurn(sessionId, input, abort.current.signal))
        publish({ status: "ready" })
      } catch (e) {
        if ((e as Error).name === "AbortError") return publish({ status: "ready" })
        publish({ status: "ready", error: e instanceof Error ? e.message : String(e) })
      }
    },
    [consume, publish],
  )

  const send = useCallback((text: string) => runTurn([{ type: "user.message", content: text }], text), [runTurn])

  const decide = useCallback(
    (decisions: { approval: PendingApproval; allow: boolean; reason?: string }[]) => {
      const input: TurnInput[] = decisions.map(({ approval, allow, reason }) => ({
        type: "user.tool_approval",
        thread_id: approval.threadId,
        tool_call_id: approval.toolCallId,
        approval: allow ? { status: "allow" } : { status: "deny", reason: reason ?? "Denied by the user" },
      }))
      return runTurn(input)
    },
    [runTurn],
  )

  const answer = useCallback(
    (question: PendingQuestion, content: string) =>
      runTurn([{ type: "user.tool_response", thread_id: question.threadId, tool_call_id: question.toolCallId, content }]),
    [runTurn],
  )

  const continueAfterAuth = useCallback(() => runTurn([]), [runTurn])

  const stop = useCallback(async () => {
    abort.current?.abort()
    if (persisted.current) await trueforge.cancel(persisted.current.sessionId).catch(() => undefined)
    publish({ status: "ready" })
  }, [publish])

  const reset = useCallback(() => {
    abort.current?.abort()
    persisted.current = null
    save(null)
    transcript.current = new Transcript()
    publish({ status: "ready", sessionId: null, error: null })
  }, [publish])

  return { ...state, send, decide, answer, continueAfterAuth, stop, reset }
}
