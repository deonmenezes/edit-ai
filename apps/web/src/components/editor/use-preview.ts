import { useCallback, useEffect, useRef, useState } from "react"
import { audioContext, mixTimeline } from "#/engine/audio"
import { clipsAtTime, drawTimelineFrame, sourceTimeFor, type FrameSources } from "#/engine/compositor"
import { videoCache } from "#/engine/video-cache"
import type { Project } from "./data"

/** Preview resolution. Lower than the export on purpose: scrubbing should stay responsive. */
export const PREVIEW_WIDTH = 1280
export const PREVIEW_HEIGHT = 720

/** Past this much drift the audio node is restarted rather than left to run away. */
const RESYNC_SECONDS = 0.3

/** Only the parts of the project that change the mixdown. */
function audioSignature(project: Project) {
  return project.clips
    .filter((c) => c.kind !== "text")
    .map((c) => `${c.id}:${c.name}:${c.start}:${c.duration}:${c.sourceOffset ?? 0}:${c.volume ?? 100}`)
    .join("|")
}

/** Media a clip needs but the agent does not have bytes for. Nothing can be drawn for these. */
export function missingMedia(project: Project): string[] {
  const names = new Set<string>()
  for (const clip of project.clips) {
    if (clip.kind === "text") continue
    if (!project.media?.[clip.name]?.file) names.add(clip.name)
  }
  return [...names]
}

/**
 * Drives the preview: real decoded frames onto a canvas, and the real timeline mixdown
 * through WebAudio. Both come from the same engine the exporter uses, so what you watch is
 * what gets encoded.
 */
export function usePreview({ project, time, playing }: { project: Project; time: number; playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [decoding, setDecoding] = useState(false)

  // Draw requests are serialised: the decoder is single-threaded per media and the newest
  // requested time is the only one worth painting.
  const drawing = useRef(false)
  const queued = useRef<number | null>(null)

  const draw = useCallback(
    async (at: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      if (drawing.current) {
        queued.current = at
        return
      }
      drawing.current = true
      try {
        const frames: FrameSources = new Map()
        const videoClips = clipsAtTime(project, at).filter((c) => c.kind === "video" && project.media?.[c.name]?.file)
        if (videoClips.length > 0) setDecoding(true)
        for (const clip of videoClips) {
          try {
            const frame = await videoCache.getFrameAt(clip.name, sourceTimeFor(clip, at))
            if (frame) frames.set(clip.name, frame.canvas)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          }
        }
        drawTimelineFrame(ctx, { project, time: at, frames, width: canvas.width, height: canvas.height })
      } finally {
        drawing.current = false
        setDecoding(false)
        const next = queued.current
        queued.current = null
        if (next !== null && next !== at) void draw(next)
      }
    },
    [project],
  )

  useEffect(() => {
    void draw(time)
  }, [draw, time])

  // ---- audio ---------------------------------------------------------------

  const mix = useRef<{ signature: string; buffer: AudioBuffer | null } | null>(null)
  const node = useRef<AudioBufferSourceNode | null>(null)
  /** Context time when playback started, and the timeline time it started from. */
  const anchor = useRef<{ contextTime: number; timelineTime: number } | null>(null)
  const [muted, setMuted] = useState(false)
  const signature = audioSignature(project)

  const stopAudio = useCallback(() => {
    if (node.current) {
      try {
        node.current.stop()
      } catch {
        // already stopped
      }
      node.current.disconnect()
      node.current = null
    }
    anchor.current = null
  }, [])

  const startAudio = useCallback(
    async (from: number) => {
      stopAudio()
      if (muted || project.duration <= 0) return
      const ctx = audioContext()
      if (mix.current?.signature !== signature) {
        mix.current = { signature, buffer: await mixTimeline(project).catch(() => null) }
      }
      const buffer = mix.current?.buffer
      if (!buffer || from >= buffer.duration) return
      if (ctx.state === "suspended") await ctx.resume()
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start(0, from)
      node.current = source
      anchor.current = { contextTime: ctx.currentTime, timelineTime: from }
    },
    [muted, project, signature, stopAudio],
  )

  const timeRef = useRef(time)
  timeRef.current = time

  useEffect(() => {
    if (playing) void startAudio(timeRef.current)
    else stopAudio()
    return stopAudio
  }, [playing, startAudio, stopAudio])

  // A scrub during playback, or an edit landing mid-play, leaves the audio where it was.
  useEffect(() => {
    if (!playing || !anchor.current) return
    const ctx = audioContext()
    const expected = anchor.current.timelineTime + (ctx.currentTime - anchor.current.contextTime)
    if (Math.abs(expected - time) > RESYNC_SECONDS) void startAudio(time)
  }, [playing, time, startAudio])

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      if (!m) stopAudio()
      return !m
    })
  }, [stopAudio])

  useEffect(() => {
    if (playing && !muted && !node.current) void startAudio(timeRef.current)
  }, [muted, playing, startAudio])

  return { canvasRef, error, decoding, muted, toggleMuted, missing: missingMedia(project) }
}
