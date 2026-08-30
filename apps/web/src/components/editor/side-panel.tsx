import { AlertCircle, AudioLines, Captions, Film, Mic, Music, Scissors, Sparkles, Type, Upload, Wand2 } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "#/components/ui/button"
import { ScrollArea } from "#/components/ui/scroll-area"
import { cn } from "#/lib/utils"
import { CLIP_TONE, type Clip, type MediaInfo } from "./data"
import type { ImportState } from "./use-media-import"

type PanelId = "media" | "ai" | "text" | "audio"

const PANELS: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: "media", label: "Media", icon: <Film className="size-4" /> },
  { id: "ai", label: "AI", icon: <Sparkles className="size-4" /> },
  { id: "text", label: "Text", icon: <Type className="size-4" /> },
  { id: "audio", label: "Audio", icon: <Music className="size-4" /> },
]

const AI_ACTIONS = [
  { icon: <Scissors className="size-4" />, title: "Remove silences", body: "Cut every pause longer than 0.6s.", prompt: "Remove all silences longer than 0.6 seconds" },
  { icon: <Captions className="size-4" />, title: "Add captions", body: "Transcribe the voiceover and burn in captions.", prompt: "Add captions from the voiceover track" },
  { icon: <AudioLines className="size-4" />, title: "Cut to the beat", body: "Align cuts on V1 to the beats in music.mp3.", prompt: "Cut the b-roll to the beat of the music" },
  { icon: <Wand2 className="size-4" />, title: "Tighten pacing", body: "Trim dead air and shorten the intro.", prompt: "Tighten the pacing and shorten the intro to 3 seconds" },
]

type Props = {
  clips: Clip[]
  media: Record<string, MediaInfo>
  imports: ImportState[]
  onImport: (files: File[]) => void
  onSuggest: (prompt: string) => void
  className?: string
}

export function SidePanel({ clips, media, imports, onImport, onSuggest, className }: Props) {
  const [panel, setPanel] = useState<PanelId>("media")

  return (
    <aside className={cn("flex shrink-0 border-r bg-panel", className)}>
      <nav aria-label="Panels" className="flex w-14 flex-col items-center gap-1 border-r py-2">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPanel(p.id)}
            aria-pressed={panel === p.id}
            className={cn(
              "flex w-12 flex-col items-center gap-1 rounded-md py-2 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              panel === p.id && "bg-accent text-foreground",
            )}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </nav>

      <ScrollArea className="hidden w-60 md:block">
        <div className="p-3">
          {panel === "media" && <MediaPanel clips={clips} media={media} imports={imports} onImport={onImport} />}
          {panel === "ai" && <AiPanel onSuggest={onSuggest} />}
          {panel === "text" && <TextPanel />}
          {panel === "audio" && <AudioPanel />}
        </div>
      </ScrollArea>
    </aside>
  )
}

function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-sans text-xs font-medium uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  )
}

function MediaPanel({
  clips,
  media,
  imports,
  onImport,
}: {
  clips: Clip[]
  media: Record<string, MediaInfo>
  imports: ImportState[]
  onImport: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const entries = Object.entries(media)
  const usage = (name: string) => clips.filter((c) => c.name === name).length

  return (
    <div>
      <PanelTitle
        action={
          <Button variant="outline" size="xs" onClick={() => input.current?.click()}>
            <Upload className="size-3.5" />
            Import
          </Button>
        }
      >
        Media
      </PanelTitle>
      <input
        ref={input}
        type="file"
        accept="video/*,audio/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          onImport(Array.from(e.target.files ?? []))
          // Clearing lets the same file be picked again after a failed import.
          e.target.value = ""
        }}
      />

      {imports.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {imports.map((i) => (
            <li
              key={i.name}
              className={cn(
                "flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px]",
                i.stage === "failed" ? "border-destructive/50 text-destructive" : "text-muted-foreground",
              )}
            >
              {i.stage === "failed" && <AlertCircle className="size-3 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="shrink-0">{i.stage === "failed" ? (i.error ?? "failed") : i.stage}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-1.5">
        {entries.map(([name, info]) => (
          <li key={name}>
            <div className="flex w-full items-center gap-2.5 rounded-md border bg-card p-2 text-left">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-well"
                style={{ color: CLIP_TONE[info.width ? "video" : "audio"] }}
              >
                {info.width ? <Film className="size-4" /> : <AudioLines className="size-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{name}</span>
                <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                  {info.duration.toFixed(1)}s
                  {info.width && info.height ? ` · ${info.height}p` : ""}
                  {usage(name) > 0 ? ` · ${usage(name)} on timeline` : ""}
                </span>
              </span>
              {!info.file && (
                <span title="No bytes on disk: this cannot be previewed or rendered" className="ml-auto shrink-0 text-muted-foreground">
                  <AlertCircle className="size-3.5" />
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted-foreground">
        {entries.length === 0
          ? "No media yet. Import a video or audio file to start editing."
          : "Drop files anywhere in the editor to import more."}
      </p>
    </div>
  )
}

function AiPanel({ onSuggest }: { onSuggest: (prompt: string) => void }) {
  return (
    <div>
      <PanelTitle>AI actions</PanelTitle>
      <ul className="flex flex-col gap-1.5">
        {AI_ACTIONS.map((a) => (
          <li key={a.title}>
            <button
              type="button"
              onClick={() => onSuggest(a.prompt)}
              className="flex w-full items-start gap-2.5 rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span aria-hidden className="mt-0.5 text-primary">{a.icon}</span>
              <span>
                <span className="block text-sm">{a.title}</span>
                <span className="block text-xs text-muted-foreground">{a.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Pick one to fill the command bar, then edit the request before you run it.</p>
    </div>
  )
}

function TextPanel() {
  const styles = [
    { name: "Title", sample: "Big, centered, two lines max" },
    { name: "Caption", sample: "Bottom third, word by word" },
    { name: "Lower third", sample: "Name and role, left aligned" },
  ]
  return (
    <div>
      <PanelTitle>Text styles</PanelTitle>
      <ul className="flex flex-col gap-1.5">
        {styles.map((s) => (
          <li key={s.name}>
            <button
              type="button"
              className="flex w-full flex-col rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="text-sm">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.sample}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AudioPanel() {
  return (
    <div>
      <PanelTitle>Audio</PanelTitle>
      <div className="flex flex-col gap-1.5">
        <Button variant="outline" className="justify-start">
          <Mic className="size-4" />
          Record voiceover
        </Button>
        <Button variant="outline" className="justify-start">
          <Music className="size-4" />
          Browse music
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Recordings land on the first empty audio track.</p>
    </div>
  )
}
