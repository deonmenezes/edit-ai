import { useCallback, useEffect, useRef, useState } from "react"
import { renderTimeline, type ExportFormat } from "#/engine/exporter"
import { AGENT_URL, agentJson } from "#/lib/agent"
import type { ExportRecord, Project } from "./data"

export type RenderState = { id: string; progress: number; resolution: string; format: string } | null

/** Progress is posted through the project store, so report it sparingly. */
const PROGRESS_STEP = 0.02

/**
 * Jobs this page has already tried, shared across every instance of the hook. A ref would be
 * per-mount, and React remounts effects in development, which is enough to claim twice.
 */
const attempted = new Set<string>()

/**
 * The agent queues renders; the editor performs them. The decoders and the encoder both
 * live here, so this is the only place that can turn a timeline into a file. A claimed job
 * is remembered for the life of the page so a project update mid-render cannot start it twice.
 */
export function useRenderWorker(project: Project) {
  const [state, setState] = useState<RenderState>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const run = useCallback(async (job: ExportRecord, snapshot: Project) => {
    busy.current = true
    let lastPosted = -1
    try {
      // The server hands a job to exactly one claimer, so a second editor open on the same
      // project renders nothing rather than encoding a duplicate over the top of this one.
      const claim = await fetch(`${AGENT_URL}/exports/${job.id}/claim`, { method: "POST" })
      if (claim.status === 409) return
      if (!claim.ok) throw new Error(`Could not claim ${job.id}: ${claim.status}`)

      setError(null)
      setState({ id: job.id, progress: 0, resolution: job.resolution, format: job.format })

      const blob = await renderTimeline({
        project: snapshot,
        width: job.width,
        height: job.height,
        fps: job.fps,
        format: (job.format === "webm" ? "webm" : "mp4") as ExportFormat,
        onProgress: (fraction) => {
          setState((s) => (s && s.id === job.id ? { ...s, progress: fraction } : s))
          if (fraction - lastPosted < PROGRESS_STEP) return
          lastPosted = fraction
          void agentJson(`/exports/${job.id}/progress`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ progress: fraction }),
          }).catch(() => undefined)
        },
      })

      const res = await fetch(`${AGENT_URL}/exports/${job.id}/file`, {
        method: "POST",
        body: blob,
        headers: { "content-type": blob.type || "application/octet-stream" },
      })
      if (!res.ok) throw new Error(`Upload failed with ${res.status}: ${(await res.text()).slice(0, 200)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      await agentJson(`/exports/${job.id}/failed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: message }),
      }).catch(() => undefined)
    } finally {
      busy.current = false
      setState(null)
    }
  }, [])

  useEffect(() => {
    if (busy.current) return
    const job = project.exports?.find((e) => e.status === "pending" && !attempted.has(e.id))
    if (!job) return
    attempted.add(job.id)
    void run(job, project)
  }, [project, run])

  return { state, error }
}
