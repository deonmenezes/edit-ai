/** Where the EditAI agent server lives. It owns the project state and the media on disk. */
export const AGENT_URL = (import.meta.env.VITE_EDITAI_AGENT_URL as string | undefined) ?? "http://localhost:8941"

/** Media is served with range support, so decoders can seek without downloading the whole file. */
export const mediaUrl = (name: string) => `${AGENT_URL}/media/${encodeURIComponent(name)}`

export async function agentJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`${init?.method ?? "GET"} ${path} failed with ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
  }
  return (await res.json()) as T
}
