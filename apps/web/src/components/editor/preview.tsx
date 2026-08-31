import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"
import { clipsAt, formatTimecode, type Project } from "./data"
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, usePreview } from "./use-preview"

type Props = {
  project: Project
  time: number
  playing: boolean
  onToggle: () => void
  onSeek: (t: number) => void
  className?: string
}

export function Preview({ project, time, playing, onToggle, onSeek, className }: Props) {
  const { canvasRef, error, decoding, muted, toggleMuted, missing } = usePreview({ project, time, playing })
  const active = clipsAt(project, time)
  const video = active.find((c) => c.kind === "video")
  const empty = project.clips.length === 0

  return (
    <section aria-label="Preview" className={cn("flex min-w-0 flex-col bg-well", className)}>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-6">
        <div className="relative aspect-video max-h-full w-full max-w-[960px] overflow-hidden rounded-md border bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_24px_60px_-20px_rgba(0,0,0,0.9)]">
          <canvas
            ref={canvasRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="h-full w-full"
            aria-label="Program monitor"
          />

          {video && (
            <span className="absolute left-3 top-3 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-white/80">
              {video.name}
            </span>
          )}
          {empty && (
            <span className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
              Nothing on the timeline. Import footage from the Media panel, then ask the assistant to cut it.
            </span>
          )}
          {!empty && missing.length > 0 && (
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center text-sm text-white/70">
              No media on disk for {missing.slice(0, 3).join(", ")}
              {missing.length > 3 ? ` and ${missing.length - 3} more` : ""}. Import the real files to see and render them.
            </span>
          )}
          {decoding && (
            <span className="absolute right-3 top-3 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-white/60">
              decoding
            </span>
          )}
          {error && (
            <span className="absolute inset-x-3 bottom-8 rounded-sm bg-destructive/80 px-2 py-1 text-center text-[11px] text-white">
              {error}
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
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          onClick={toggleMuted}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>
      </div>
    </section>
  )
}
