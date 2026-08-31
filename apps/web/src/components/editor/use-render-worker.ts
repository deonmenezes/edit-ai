import { useCallback, useEffect, useRef, useState } from "react"
import { renderTimeline, type ExportFormat, type RenderSink } from "#/engine/exporter"
import { AGENT_URL, agentJson } from "#/lib/agent"
import { fireAndForget } from "#/lib/async"
import { isClaimable } from "./exports"
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
 * The agent queues renders; the editor performs them. The decoders and the encoder both live
 * here, so this is the only place that can turn a timeline into a file.
 */
export function useRenderWorker(project: Project) {
  const [state, setState] = useState<RenderState>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const run = useCallback(async (job: ExportRecord) => {
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

      // The timeline as it was when the render was approved. Rendering the live project would
      // silently encode edits made after the user agreed to the export.
      const { project: snapshot } = await agentJson<{ project: Project }>(`/exports/${job.id}/project`)

      const sink: RenderSink = async ({ data, position }) => {
        const res = await fetch(`${AGENT_URL}/exports/${job.id}/chunk?position=${position}`, {
          method: "POST",
          body: data as BodyInit,
          headers: { "content-type": "application/octet-stream" },
        })
        if (!res.ok) throw new Error(`Chunk upload failed with ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }

      await renderTimeline({
        project: snapshot,
        width: job.width,
        height: job.height,
        fps: job.fps,
        format: job.format === "webm" ? ("webm" as ExportFormat) : ("mp4" as ExportFormat),
        sink,
        onProgress: (fraction) => {
          setState((s) => (s && s.id === job.id ? { ...s, progress: fraction } : s))
          if (fraction - lastPosted < PROGRESS_STEP) return
          lastPosted = fraction
          fireAndForget(
            agentJson(`/exports/${job.id}/progress`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ progress: fraction }),
            }),
          )
        },
      })

      await agentJson(`/exports/${job.id}/finish`, { method: "POST" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      fireAndForget(
        agentJson(`/exports/${job.id}/failed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: message }),
        }),
      )
    } finally {
      busy.current = false
      setState(null)
    }
  }, [])

  useEffect(() => {
    if (busy.current) return
    const job = project.exports?.find((e) => isClaimable(e) && !attempted.has(e.id))
    if (!job) return
    attempted.add(job.id)
    fireAndForget(run(job))
  }, [project, run])

  return { state, error }
}
