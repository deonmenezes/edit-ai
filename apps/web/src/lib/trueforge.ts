/**
 * Minimal browser client for the TrueForge HTTP API (wire format, snake_case).
 * Requests go through the Vite dev proxy at /tf (see vite.config.ts).
 */
export const TF_BASE = (import.meta.env.VITE_TRUEFORGE_PROXY as string | undefined) ?? "/tf"
const API = `${TF_BASE}/api/v1`

export type TFEvent = {
  type: string
  id: string
  thread_id: string | null
  created_at?: string
  [key: string]: unknown
}

export type TurnInput =
  | { type: "user.message"; content: string }
  | { type: "user.tool_approval"; thread_id: string; tool_call_id: string; approval: { status: "allow" } | { status: "deny"; reason: string } }
  | { type: "user.tool_response"; thread_id: string; tool_call_id: string; content: string }

export type Turn = {
  id: string
  input?: TurnInput[]
  state: { status: "running" | "done" | "cancelled" | "error"; required_actions?: TFEvent[]; message?: string; reason?: string }
}

export class TrueForgeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new TrueForgeError(res.status, `${method} ${path} failed with ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

export const trueforge = {
  async ping() {
    return api<{ data: unknown }>("GET", "/capabilities")
  },
  async listAgents() {
    return (await api<{ data: { id: string; name: string }[] }>("GET", "/agents")).data
  },
  async createSession(agentName: string) {
    return (await api<{ data: { id: string } }>("POST", "/sessions", { agent: { name: agentName } })).data
  },
  async getSession(id: string) {
    return (await api<{ data: { id: string } }>("GET", `/sessions/${id}`)).data
  },
  async listTurns(sessionId: string) {
    const turns: Turn[] = []
    let token: string | undefined
    do {
      const page = await api<{ data: Turn[]; next_page_token?: string | null }>(
        "GET",
        `/sessions/${sessionId}/turns?limit=25${token ? `&page_token=${encodeURIComponent(token)}` : ""}`,
      )
      turns.push(...page.data)
      token = page.next_page_token ?? undefined
    } while (token)
    return turns
  },
  async getTurn(sessionId: string, turnId: string) {
    return (await api<{ data: Turn }>("GET", `/sessions/${sessionId}/turns/${turnId}`)).data
  },
  async listTurnEvents(sessionId: string, turnId: string) {
    const events: TFEvent[] = []
    let token: string | undefined
    do {
      const page = await api<{ data: TFEvent[]; next_page_token?: string | null }>(
        "GET",
        `/sessions/${sessionId}/turns/${turnId}/events?order=asc&limit=100${token ? `&page_token=${encodeURIComponent(token)}` : ""}`,
      )
      events.push(...page.data)
      token = page.next_page_token ?? undefined
    } while (token)
    return events
  },
  async cancel(sessionId: string) {
    await api("POST", `/sessions/${sessionId}/cancel`, {})
  },
  /** POST a turn and stream its events. */
  streamTurn(sessionId: string, input: TurnInput[], signal?: AbortSignal) {
    return sse(`${API}/sessions/${sessionId}/turns`, { method: "POST", body: JSON.stringify({ input, stream: true }), signal })
  },
  /** Reconnect to a running turn. */
  subscribeTurn(sessionId: string, turnId: string, afterSequenceNumber: number, signal?: AbortSignal) {
    const q = afterSequenceNumber > 0 ? `?after_sequence_number=${afterSequenceNumber}` : ""
    return sse(`${API}/sessions/${sessionId}/turns/${turnId}/subscribe${q}`, { method: "GET", signal })
  },
}

export type SSEItem = { id: number | null; event: TFEvent }

async function* sse(url: string, init: { method: string; body?: string; signal?: AbortSignal }): AsyncGenerator<SSEItem> {
  const res = await fetch(url, {
    method: init.method,
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: init.body,
    signal: init.signal,
  })
  if (!res.ok || !res.body) throw new TrueForgeError(res.status, `${init.method} ${url} failed with ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let id: number | null = null
      const data: string[] = []
      for (const raw of chunk.split("\n")) {
        const line = raw.replace(/\r$/, "")
        if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || null
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
      }
      if (data.length === 0) continue
      try {
        yield { id, event: JSON.parse(data.join("\n")) as TFEvent }
      } catch {
        // ignore malformed frames
      }
    }
  }
}
