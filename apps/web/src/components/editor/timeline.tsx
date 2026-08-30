import { Magnet, Scissors, ZoomIn, ZoomOut } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"
import { CLIP_TONE, clamp, formatShort, type Clip, type MediaInfo, type Project } from "./data"

type Props = {
  project: Project
  time: number
  playing: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSeek: (t: number) => void
  className?: string
}

const HEADER_W = 88
const RULER_H = 26
const TRACK_H = 44
const MIN_PPS = 16
const MAX_PPS = 160

export function Timeline({ project, time, playing, selectedId, onSelect, onSeek, className }: Props) {
  const [pps, setPps] = useState(40)
  const [snap, setSnap] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)

  const width = project.duration * pps + 120
  const playheadX = time * pps
  const labelEvery = pps >= 90 ? 1 : pps >= 40 ? 2 : 5

  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const left = el.scrollLeft
    const visible = el.clientWidth - HEADER_W
    if (playheadX < left || playheadX > left + visible - 40) {
      el.scrollTo({ left: Math.max(0, playheadX - 80), behavior: "auto" })
    }
  }, [playheadX, playing])

  const seekFromEvent = (e: React.MouseEvent<HTMLElement>) => {
    const el = scroller.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left - HEADER_W + el.scrollLeft
    let t = clamp(x / pps, 0, project.duration)
    if (snap) t = Math.round(t * project.fps) / project.fps
    onSeek(t)
  }

  const ticks = Array.from({ length: Math.floor(project.duration) + 1 }, (_, i) => i)

  return (
    <section aria-label="Timeline" className={cn("flex min-h-0 flex-1 select-none flex-col bg-background", className)}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Split at playhead">
          <Scissors className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 text-muted-foreground", snap && "bg-accent text-foreground")}
          aria-label="Snap to frames"
          aria-pressed={snap}
          onClick={() => setSnap((s) => !s)}
        >
          <Magnet className="size-3.5" />
        </Button>
        <span className="ml-3 hidden text-[11px] text-muted-foreground sm:inline">
          {project.tracks.length} tracks · {project.clips.length} clips · {project.duration}s
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Zoom out"
            onClick={() => setPps((p) => clamp(p / 1.5, MIN_PPS, MAX_PPS))}
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <input
            type="range"
            aria-label="Timeline zoom"
            min={MIN_PPS}
            max={MAX_PPS}
            value={pps}
            onChange={(e) => setPps(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer accent-primary"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="Zoom in"
            onClick={() => setPps((p) => clamp(p * 1.5, MIN_PPS, MAX_PPS))}
          >
            <ZoomIn className="size-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: HEADER_W + width, minHeight: RULER_H + project.tracks.length * TRACK_H }}>
          {/* ruler */}
          <div
            className="sticky top-0 z-20 flex cursor-pointer select-none border-b bg-background"
            style={{ height: RULER_H }}
            onMouseDown={seekFromEvent}
          >
            <div className="sticky left-0 z-30 shrink-0 border-r bg-panel" style={{ width: HEADER_W }} />
            <div className="relative" style={{ width }}>
              {ticks.map((s) => (
                <div key={s} className="absolute bottom-0 flex flex-col items-start" style={{ left: s * pps }}>
                  {s % labelEvery === 0 && (
                    <span className="mb-0.5 -translate-x-px pl-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {formatShort(s)}
                    </span>
                  )}
                  <span className={cn("block w-px bg-border", s % labelEvery === 0 ? "h-2.5" : "h-1.5")} />
                </div>
              ))}
            </div>
          </div>

          {/* tracks */}
          <div>
            {project.tracks.map((track) => (
              <div key={track.id} className="flex border-b" style={{ height: TRACK_H }}>
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r bg-panel px-3"
                  style={{ width: HEADER_W }}
                >
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: CLIP_TONE[track.kind] }} />
                  <span className="font-mono text-xs">{track.label}</span>
                  <span className="text-[10px] capitalize text-muted-foreground">{track.kind}</span>
                </div>
                <div
                  className="relative"
                  style={{ width }}
                  onMouseDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    onSelect(null)
                    seekFromEvent(e)
                  }}
                >
                  {project.clips
                    .filter((c) => c.trackId === track.id)
                    .map((c) => {
                      const selected = c.id === selectedId
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            onSelect(c.id)
                          }}
                          aria-pressed={selected}
                          title={c.name}
                          className={cn(
                            "absolute top-1.5 bottom-1.5 overflow-hidden rounded-[4px] border-l-[3px] text-left text-xs transition-[box-shadow,filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-ring",
                            selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                          )}
                          style={{
                            left: c.start * pps,
                            width: Math.max(8, c.duration * pps - 2),
                            borderLeftColor: CLIP_TONE[c.kind],
                            background: `color-mix(in oklab, ${CLIP_TONE[c.kind]} 28%, var(--panel))`,
                          }}
                        >
                          <span className="block truncate px-2 leading-[calc(theme(spacing.11)-12px)]">{c.name}</span>
                          {c.kind === "audio" && <Waveform clip={c} media={project.media?.[c.name]} />}
                        </button>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>

          {/* playhead */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-30"
            style={{ left: HEADER_W + playheadX }}
          >
            <span className="absolute -left-[5px] top-0 size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-primary" />
            <span className="absolute top-0 bottom-0 left-0 w-px bg-primary shadow-[0_0_6px_var(--primary)]" />
          </div>
        </div>
      </div>
    </section>
  )
}

function Waveform({ clip, media }: { clip: Clip; media?: MediaInfo }) {
  const bars = 120
  const heights = media?.peaks?.length ? clipPeaks(media.peaks, clip, media.duration, bars) : placeholderPeaks(clip.id, bars)
  return (
    <span aria-hidden className="absolute inset-x-1 bottom-1 flex h-3 items-end gap-px opacity-50">
      {heights.map((h, i) => (
        <span key={i} className="w-px flex-none bg-current" style={{ height: `${Math.max(2, h * 100)}%`, color: "var(--clip-audio)" }} />
      ))}
    </span>
  )
}

/** The measured envelope, windowed to the part of the source this clip actually uses. */
function clipPeaks(peaks: number[], clip: Clip, mediaDuration: number, bars: number): number[] {
  if (mediaDuration <= 0) return placeholderPeaks(clip.id, bars)
  const from = ((clip.sourceOffset ?? 0) / mediaDuration) * peaks.length
  const to = (((clip.sourceOffset ?? 0) + clip.duration) / mediaDuration) * peaks.length
  const span = Math.max(1, to - from)
  return Array.from({ length: bars }, (_, i) => {
    const start = Math.floor(from + (i / bars) * span)
    const end = Math.max(start + 1, Math.floor(from + ((i + 1) / bars) * span))
    let peak = 0
    for (let j = start; j < end && j < peaks.length; j++) peak = Math.max(peak, peaks[j] ?? 0)
    return peak
  })
}

/** Stable stand-in for media that has not been analyzed, so clips still read as audio. */
function placeholderPeaks(seed: string, bars: number): number[] {
  let x = seed.charCodeAt(seed.length - 1) * 9301 + 49297
  return Array.from({ length: bars }, () => {
    x = (x * 9301 + 49297) % 233280
    return 0.2 + (x / 233280) * 0.8
  })
}
