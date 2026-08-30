import type { Clip, Project } from "#/components/editor/data"

export type FrameSources = Map<string, CanvasImageSource>

export type Surface = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Clips live on tracks; a clip on a later track paints over one on an earlier track. */
function byTrackOrder(project: Project) {
  const order = new Map(project.tracks.map((t, i) => [t.id, i]))
  return (a: Clip, b: Clip) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0)
}

export const clipsAtTime = (project: Project, time: number) =>
  project.clips.filter((c) => time >= c.start && time < c.start + c.duration)

/** Where in the source file a clip is at a given timeline time. */
export const sourceTimeFor = (clip: Clip, time: number) => (clip.sourceOffset ?? 0) + (time - clip.start)

/**
 * One frame of the timeline, composited onto a 2D surface.
 *
 * Deliberately Canvas2D rather than the GPU compositor OpenCut uses: EditAI's timeline is
 * stacked video, text and audio with no effects, masks or blend modes, and 2D covers all of
 * it exactly. The trade is that this cannot grow filters without a real compositor.
 */
export function drawTimelineFrame(
  ctx: Surface,
  { project, time, frames, width, height }: { project: Project; time: number; frames: FrameSources; width: number; height: number },
) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  const active = clipsAtTime(project, time).sort(byTrackOrder(project))

  for (const clip of active) {
    if (clip.kind !== "video") continue
    const frame = frames.get(clip.name)
    if (frame) drawCover(ctx, frame, width, height)
  }

  for (const clip of active) {
    if (clip.kind === "text") drawCaption(ctx, clip.name, width, height)
  }
}

/** Fill the frame, cropping the overflowing axis, the way a preview monitor would. */
function drawCover(ctx: Surface, source: CanvasImageSource, width: number, height: number) {
  const sw = sourceWidth(source)
  const sh = sourceHeight(source)
  if (!sw || !sh) return
  const scale = Math.max(width / sw, height / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h)
}

const sourceWidth = (s: CanvasImageSource) =>
  "videoWidth" in s ? s.videoWidth : "naturalWidth" in s ? s.naturalWidth : "width" in s ? Number(s.width) : 0
const sourceHeight = (s: CanvasImageSource) =>
  "videoHeight" in s ? s.videoHeight : "naturalHeight" in s ? s.naturalHeight : "height" in s ? Number(s.height) : 0

function drawCaption(ctx: Surface, text: string, width: number, height: number) {
  const fontSize = Math.round(height * 0.055)
  ctx.save()
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Inter, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"

  const lines = wrap(ctx, text, width * 0.84)
  const lineHeight = fontSize * 1.2
  const baseline = height * 0.86 - (lines.length - 1) * lineHeight

  ctx.shadowColor = "rgba(0,0,0,0.7)"
  ctx.shadowBlur = fontSize * 0.35
  ctx.shadowOffsetY = fontSize * 0.05
  ctx.fillStyle = "#ffffff"
  lines.forEach((line, i) => ctx.fillText(line, width / 2, baseline + i * lineHeight))
  ctx.restore()
}

/** Greedy wrap. A single word wider than the box is left to overflow rather than broken. */
function wrap(ctx: Surface, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = words[0]!
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  return lines
}
