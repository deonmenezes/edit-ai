import { useEffect, useState } from "react"
import { PROJECT, type Project } from "./data"

export const AGENT_URL = (import.meta.env.VITE_EDITAI_AGENT_URL as string | undefined) ?? "http://localhost:8941"

type State = { project: Project; connected: boolean; revision: number; lastChange: string | null }

/** The timeline the agent edits. Falls back to the built-in sample when the agent server is down. */
export function useProject(): State {
  const [state, setState] = useState<State>({ project: PROJECT, connected: false, revision: 0, lastChange: null })

  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      es = new EventSource(`${AGENT_URL}/events`)
      es.addEventListener("project", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            project: Project
            revision: number
            change: { summary: string } | null
          }
          setState({ project: payload.project, connected: true, revision: payload.revision, lastChange: payload.change?.summary ?? null })
        } catch {
          // ignore
        }
      })
      es.onerror = () => {
        es?.close()
        setState((s) => ({ ...s, connected: false }))
        retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      closed = true
      es?.close()
      if (retry) clearTimeout(retry)
    }
  }, [])

  return state
}

export async function resetProject() {
  await fetch(`${AGENT_URL}/project/reset`, { method: "POST" })
}
