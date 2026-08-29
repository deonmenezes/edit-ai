import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"
import { clipsAt, formatTimecode, type Project } from "./data"

type Props = {
  project: Project
  time: number
  playing: boolean
  onToggle: () => void
  onSeek: (t: number) => void
  className?: string
}

const SCENES: Record<string, string> = {
  "intro.mp4": "linear-gradient(135deg, #2b2440 0%, #17161c 60%, #0e0e10 100%)",
  "b-roll.mp4": "linear-gradient(160deg, #1d3532 0%, #121a1a 55%, #0e0e10 100%)",
  "talking-head.mp4": "linear-gradient(150deg, #3a2a22 0%, #1b1613 55%, #0e0e10 100%)",
}

export function Preview({ project, time, playing, onToggle, onSeek, className }: Props) {
  const active = clipsAt(project, time)
  const video = active.find((c) => c.kind === "video")
  const text = active.find((c) => c.kind === "text")

  return (
    <section aria-label="Preview" className={cn("flex min-w-0 flex-col bg-well", className)}>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-6">
        <div
          className="relative aspect-video max-h-full w-full max-w-[960px] overflow-hidden rounded-md border bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_24px_60px_-20px_rgba(0,0,0,0.9)]"
          style={{ background: video ? SCENES[video.name] : "#000" }}
        >
          {video ? (
            <span className="absolute left-3 top-3 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-white/80">
              {video.name}
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Nothing on V1 at this time
            </span>
          )}
          {text && (
            <span className="absolute inset-x-0 bottom-[14%] px-8 text-center text-[clamp(18px,3.4vw,40px)] font-semibold tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
              {text.name}
            </span>
          )}
          <span className="absolute bottom-2 right-3 font-mono text-[11px] tabular-nums text-white/60">
            {formatTimecode(time, project.fps)}
          </span>
        </div>
      </div>

      <div className="flex h-12 shrink-0 items-center gap-1 border-t bg-panel px-3">
        <Button variant="ghost" size="icon" className="size-8" aria-label="Go to start" onClick={() => onSeek(0)}>
          <SkipBack className="size-4" />
        </Button>
        <Button
          size="icon"
          className="size-8"
          aria-label={playing ? "Pause" : "Play"}
          aria-pressed={playing}
          onClick={onToggle}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Go to end" onClick={() => onSeek(project.duration)}>
          <SkipForward className="size-4" />
        </Button>
        <span className="ml-2 font-mono text-xs tabular-nums">
          {formatTimecode(time, project.fps)}
          <span className="text-muted-foreground"> / {formatTimecode(project.duration, project.fps)}</span>
        </span>
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">16:9 · 1080p · {project.fps} fps</span>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Volume">
          <Volume2 className="size-4" />
        </Button>
      </div>
    </section>
  )
}
