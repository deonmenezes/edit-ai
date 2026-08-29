import { describe, expect, test } from "vitest"
import { foldEvents } from "./transcript"

const base = { id: "e1", thread_id: "main", created_at: "2026-01-01T00:00:00Z" }

describe("foldEvents", () => {
  test("merges streamed deltas into one assistant message", () => {
    const t = foldEvents([
      { ...base, type: "model.message", content: "" },
      { ...base, type: "model.message.delta", content: "Removed " },
      { ...base, type: "model.message.delta", content: "the silences." },
    ])
    expect(t.items).toHaveLength(1)
    const item = t.items[0]!
    expect(item.kind).toBe("assistant")
    if (item.kind === "assistant") expect(item.text).toBe("Removed the silences.")
  })

  test("assembles tool calls from delta fragments", () => {
    const t = foldEvents([
      { ...base, type: "model.message", content: "" },
      {
        ...base,
        type: "model.message.delta",
        tool_calls: [{ index: 0, id: "call-1", function: { name: "remove_", arguments: '{"min_' } }],
      },
      {
        ...base,
        type: "model.message.delta",
        tool_calls: [{ index: 0, function: { name: "silences", arguments: 'duration":0.5}' } }],
      },
    ])
    const item = t.items[0]!
    expect(item.kind).toBe("assistant")
    if (item.kind === "assistant") {
      expect(item.toolCalls[0]!.name).toBe("remove_silences")
      expect(item.toolCalls[0]!.args).toBe('{"min_duration":0.5}')
    }
  })

  test("a pending approval carries the tool name and arguments", () => {
    const t = foldEvents([
      {
        ...base,
        id: "msg-1",
        type: "model.message",
        tool_calls: [{ id: "call-1", function: { name: "remove_silences", arguments: '{"min_duration":0.5}' } }],
      },
      {
        ...base,
        id: "appr-1",
        type: "tool.approval_required",
        tool_calls: [{ id: "call-1", source_event_id: "msg-1" }],
      },
    ])
    expect(t.approvals).toEqual([
      { threadId: "main", toolCallId: "call-1", name: "remove_silences", args: '{"min_duration":0.5}' },
    ])
  })

  test("a question exposes its options", () => {
    const t = foldEvents([
      {
        ...base,
        id: "msg-2",
        type: "model.message",
        tool_calls: [
          { id: "call-2", function: { name: "ask_user_question", arguments: '{"question":"Which clip?","options":["intro","b-roll"]}' } },
        ],
      },
      { ...base, id: "req-1", type: "tool.response_required", tool_calls: [{ id: "call-2", source_event_id: "msg-2" }] },
    ])
    expect(t.questions[0]).toMatchObject({ question: "Which clip?", options: ["intro", "b-roll"] })
  })

  test("sub-agent threads are tracked separately from main", () => {
    const t = foldEvents([
      { ...base, id: "th-1", type: "thread.created", thread_id: "sub-a", title: "transcribe_c1" },
      { ...base, id: "m-1", type: "model.message", thread_id: "sub-a", content: "Done." },
      { ...base, id: "th-2", type: "thread.done", thread_id: "sub-a" },
    ])
    const thread = t.items.find((i) => i.kind === "thread")
    expect(thread).toMatchObject({ title: "transcribe_c1", done: true })
    const msg = t.items.find((i) => i.kind === "assistant")
    expect(msg?.kind === "assistant" && msg.threadId).toBe("sub-a")
  })

  test("a turn that errors leaves a note", () => {
    const t = foldEvents([
      { ...base, id: "d-1", type: "turn.done", thread_id: null, state: { status: "error", message: "Request failed (429)" } },
    ])
    expect(t.items[0]).toMatchObject({ kind: "note" })
  })
})
