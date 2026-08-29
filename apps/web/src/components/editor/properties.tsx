import { useState } from "react"
import { Slider } from "#/components/ui/slider"
import { cn } from "#/lib/utils"
import { CLIP_TONE, formatTimecode, type Clip } from "./data"

type Props = {
  clip: Clip | null
  fps: number
  className?: string
}

export function Properties({ clip, fps, className }: Props) {
  return (
    <aside aria-label="Properties" className={cn("flex min-h-0 w-64 shrink-0 flex-col overflow-hidden border-l bg-panel", className)}>
      <div className="border-b px-4 py-3">
        <h2 className="font-sans text-xs font-medium uppercase tracking-wider text-muted-foreground">Properties</h2>
      </div>
      {clip ? <ClipProperties key={clip.id} clip={clip} fps={fps} /> : <EmptyState />}
    </aside>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-sm">Nothing selected</p>
      <p className="text-xs text-muted-foreground">Click a clip on the timeline to edit its timing, opacity, or volume.</p>
    </div>
  )
}

function ClipProperties({ clip, fps }: { clip: Clip; fps: number }) {
  const [opacity, setOpacity] = useState(100)
  const [scale, setScale] = useState(100)
  const [volume, setVolume] = useState(clip.kind === "audio" && clip.name.startsWith("music") ? 35 : 100)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: CLIP_TONE[clip.kind] }} />
          <span className="truncate text-sm font-medium">{clip.name}</span>
        </div>
        <span className="mt-1 block text-xs capitalize text-muted-foreground">{clip.kind} clip</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs tabular-nums">
        <dt className="text-muted-foreground">Start</dt>
        <dd>{formatTimecode(clip.start, fps)}</dd>
        <dt className="text-muted-foreground">End</dt>
        <dd>{formatTimecode(clip.start + clip.duration, fps)}</dd>
        <dt className="text-muted-foreground">Length</dt>
        <dd>{clip.duration.toFixed(2)}s</dd>
      </dl>

      {clip.kind !== "audio" && (
        <Field label="Opacity" value={`${opacity}%`}>
          <Slider value={[opacity]} min={0} max={100} onValueChange={(v) => setOpacity(pick(v))} aria-label="Opacity" />
        </Field>
      )}
      {clip.kind === "video" && (
        <Field label="Scale" value={`${scale}%`}>
          <Slider value={[scale]} min={50} max={200} onValueChange={(v) => setScale(pick(v))} aria-label="Scale" />
        </Field>
      )}
      {clip.kind !== "text" && (
        <Field label="Volume" value={`${volume}%`}>
          <Slider value={[volume]} min={0} max={100} onValueChange={(v) => setVolume(pick(v))} aria-label="Volume" />
        </Field>
      )}
    </div>
  )
}

function pick(v: number | readonly number[]) {
  return Array.isArray(v) ? (v[0] ?? 0) : (v as number)
}

function Field({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-muted-foreground">{value}</span>
      </div>
      {children}
    </div>
  )
}
