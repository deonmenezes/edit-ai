import { useCallback, useEffect, useRef, useState } from "react"
import { trueforge, TrueForgeError, type TFEvent, type TurnInput } from "#/lib/trueforge"
import {
  Transcript,
  type ChatItem,
  type PendingApproval,
  type PendingAuth,
  type PendingQuestion,
} from "./transcript"

export type { ChatItem, PendingApproval, PendingAuth, PendingQuestion, ToolCall } from "./transcript"

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
    // storage unavailable (private mode); the session just will not resume
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
