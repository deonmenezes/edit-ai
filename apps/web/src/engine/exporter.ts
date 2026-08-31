import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  WebMOutputFormat,
} from "mediabunny"
import type { Project } from "#/components/editor/data"
import { mixTimeline } from "./audio"
import { clipsAtTime, drawTimelineFrame, sourceTimeFor, type FrameSources } from "./compositor"
import { VideoCache } from "./video-cache"

export type ExportFormat = "mp4" | "webm"
export type ExportQuality = "medium" | "high" | "very_high"

const QUALITY = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, very_high: QUALITY_VERY_HIGH }

/** 8 MiB slices: few enough requests to be cheap, small enough to stay off the heap. */
const CHUNK_SIZE = 8 * 1024 * 1024

/** Where encoded bytes go as they are produced. Positions are revisited, so this is not an append. */
export type RenderSink = (chunk: { data: Uint8Array; position: number }) => Promise<void>

export type RenderOptions = {
  project: Project
  width: number
  height: number
  fps: number
  format?: ExportFormat
  quality?: ExportQuality
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Given, the encode streams out through it and this returns null instead of a Blob. */
  sink?: RenderSink
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return canvas
}

/** mp4 wants AAC, but not every browser build can encode it; Opus in an mp4 is the fallback. */
async function pickAudioCodec(format: ExportFormat, buffer: AudioBuffer): Promise<"aac" | "opus"> {
  if (format === "webm") return "opus"
  if (typeof AudioEncoder === "undefined") return "opus"
  const { supported } = await AudioEncoder.isConfigSupported({
    codec: "mp4a.40.2",
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    bitrate: 192_000,
  })
  return supported ? "aac" : "opus"
}

/**
 * Encode the timeline to a real video file, in the browser.
 *
 * This is the same shape as OpenCut's scene exporter: composite each frame onto a canvas, hand
 * the canvas to a WebCodecs-backed `CanvasSource`, and mux with mediabunny. The audio mixdown is
 * added up front as one buffer rather than per frame, which is what keeps sound in sync with a
 * video track whose frame durations are only nominally constant.
 */
export async function renderTimeline({
  project,
  width,
  height,
  fps,
  format = "mp4",
  quality = "high",
  onProgress,
  signal,
  sink,
}: RenderOptions): Promise<Blob | null> {
  if (project.duration <= 0) throw new Error("There is nothing on the timeline to render.")

  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error("Could not get a 2D context for the render surface.")

  const buffered = sink ? null : new BufferTarget()
  const output = new Output({
    format: format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target:
      buffered ??
      new StreamTarget(
        new WritableStream({
          // Awaited, so the muxer applies backpressure instead of queueing chunks in memory.
          write: (chunk) => sink!({ data: chunk.data, position: chunk.position }),
        }),
        { chunked: true, chunkSize: CHUNK_SIZE },
      ),
  })
  const videoSource = new CanvasSource(canvas, {
    codec: format === "webm" ? "vp9" : "avc",
    bitrate: QUALITY[quality],
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  const audio = await mixTimeline(project)
  let audioSource: AudioBufferSource | null = null
  if (audio) {
    audioSource = new AudioBufferSource({ codec: await pickAudioCodec(format, audio), bitrate: QUALITY[quality] })
    output.addAudioTrack(audioSource)
  }

  await output.start()

  // A cache of its own: the preview's decoders are mid-scrub and must not be dragged along.
  const cache = new VideoCache()
  let finished = false

  try {
    if (audioSource && audio) {
      await audioSource.add(audio)
      audioSource.close()
    }

    // Ceil, not round: a timeline that is not a whole number of frames long must still be
    // covered to its end, and the final frame is shortened so the video lasts exactly as long
    // as the audio rather than up to half a frame more.
    const frameCount = Math.max(1, Math.ceil(project.duration * fps - 1e-9))
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new DOMException("Render cancelled", "AbortError")
      const time = i / fps
      const frames: FrameSources = new Map()
      for (const clip of clipsAtTime(project, time)) {
        if (clip.kind !== "video") continue
        const frame = await cache.getFrameAt(clip.name, sourceTimeFor(clip, time)).catch(() => null)
        // Keyed by clip, not by media: two clips of one file at different offsets are two frames.
        if (frame) frames.set(clip.id, frame.canvas)
      }
      drawTimelineFrame(ctx, { project, time, frames, width, height })
      await videoSource.add(time, Math.min(1 / fps, project.duration - time))
      onProgress?.(i / frameCount)
    }

    videoSource.close()
    await output.finalize()
    finished = true
  } finally {
    cache.clear()
    if (!finished) {
      // An encoder left open after a failure holds hardware and can break the next render.
      videoSource.close()
      audioSource?.close()
      await output.cancel().catch(() => undefined)
    }
  }

  onProgress?.(1)
  if (!buffered) return null

  const bytes = buffered.buffer
  if (!bytes) throw new Error("The encoder produced no output.")
  return new Blob([bytes], { type: format === "webm" ? "video/webm" : "video/mp4" })
}
