import type { TFEvent } from "#/lib/trueforge"

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

/**
 * Folds a turn's events into what the panel renders.
 *
 * Model output arrives as an empty `model.message` followed by `model.message.delta`
 * fragments sharing its id, so deltas are merged into the base event. Approvals and
 * questions only carry a reference to the call, so the tool's name and arguments are
 * looked up in the message that emitted it.
 */
export class Transcript {
  items: ChatItem[] = []
  approvals: PendingApproval[] = []
  questions: PendingQuestion[] = []
  auth: PendingAuth[] = []
  private events = new Map<string, TFEvent>()

  private upsert(item: ChatItem) {
    const i = this.items.findIndex((x) => x.id === item.id)
    if (i === -1) this.items.push(item)
    else this.items[i] = item
  }

  user(id: string, text: string) {
    this.upsert({ kind: "user", id, text })
  }

  /** Pending actions belong to a single turn; a new turn clears them. */
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

  private findCall(callId: string, sourceEventId?: string): ToolCall | undefined {
    const from = sourceEventId ? this.events.get(sourceEventId) : undefined
    for (const ev of from ? [from] : [...this.events.values()]) {
      const call = this.toolCallsOf(ev).find((c) => c.id === callId)
      if (call) return call
    }
    return undefined
  }

  apply(ev: TFEvent) {
    const threadId = (ev.thread_id as string | null) ?? "main"
    switch (ev.type) {
      case "model.message": {
        this.events.set(ev.id, { ...ev })
        this.upsert({ kind: "assistant", id: ev.id, threadId, text: String(ev.content ?? ""), toolCalls: this.toolCallsOf(ev) })
        break
      }
      case "model.message.delta": {
        let base = this.events.get(ev.id)
        if (!base) {
          base = { ...ev, type: "model.message", content: "", tool_calls: [] }
          this.events.set(ev.id, base)
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
        this.upsert({
          kind: "tool",
          id: ev.id,
          threadId,
          toolCallId: callId,
          name: this.findCall(callId)?.name ?? "tool",
          content: String(ev.content ?? ""),
        })
        break
      }
      case "thread.created": {
        this.upsert({ kind: "thread", id: `thread:${threadId}`, threadId, title: String(ev.title ?? "Sub-agent"), done: false })
        break
      }
      case "thread.done": {
        const existing = this.items.find((x) => x.kind === "thread" && x.threadId === threadId)
        this.upsert({
          kind: "thread",
          id: `thread:${threadId}`,
          threadId,
          title: existing?.kind === "thread" ? existing.title : "Sub-agent",
          done: true,
        })
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
          let question = "The assistant needs your input."
          let options: string[] = []
          try {
            const parsed = JSON.parse(call?.args || "{}") as { question?: string; options?: string[] }
            if (parsed.question) question = parsed.question
            if (Array.isArray(parsed.options)) options = parsed.options.map(String)
          } catch {
            // a free-form question, answered with text
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
        if (state.status === "error") {
          this.upsert({ kind: "note", id: `${ev.id}:err`, text: `The assistant stopped with an error: ${state.message ?? "unknown"}` })
        }
        if (state.status === "cancelled" && state.reason !== "cancelled-for-next-turn") {
          this.upsert({ kind: "note", id: `${ev.id}:cancel`, text: "Turn cancelled." })
        }
        break
      }
      default:
        break
    }
  }
}

/** Convenience for tests and replay: fold a whole list of events at once. */
export function foldEvents(events: TFEvent[]): Transcript {
  const t = new Transcript()
  for (const ev of events) t.apply(ev)
  return t
}
