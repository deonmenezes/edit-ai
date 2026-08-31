import { Download, Redo2, Share2, Undo2 } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Separator } from "#/components/ui/separator"
import { cn } from "#/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { AGENT_URL } from "#/lib/agent"
import { formatTimecode, type ExportRecord } from "./data"
import type { RenderState } from "./use-render-worker"

type Props = {
  projectName: string
  time: number
  fps: number
  live: boolean
  lastChange: string | null
  render: RenderState
  lastExport?: ExportRecord
  onExport: () => void
  canExport: boolean
}

export function TopBar({ projectName, time, fps, live, lastChange, render, lastExport, onExport, canExport }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-panel px-3">
      <a href="/" className="flex items-baseline gap-1.5 rounded-sm px-1 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="font-heading text-[19px] italic leading-none tracking-tight">EditAI</span>
        <span aria-hidden className="mb-0.5 size-1.5 rounded-full bg-primary" />
      </a>
      <Separator orientation="vertical" className="h-5!" />
      <span className="truncate text-sm text-muted-foreground">{projectName}</span>
      <span
        title={live ? "Connected to the agent server" : "Not connected: showing the sample timeline"}
        className="hidden items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline-flex"
      >
        <span className={cn("size-1.5 rounded-full", live ? "bg-[var(--clip-audio)]" : "bg-muted-foreground")} />
        {live ? "Live" : "Sample"}
      </span>

      <div className="mx-auto hidden min-w-0 items-center gap-2 md:flex">
        <IconButton label="Undo" icon={<Undo2 className="size-4" />} />
        <IconButton label="Redo" icon={<Redo2 className="size-4" />} />
        {lastChange && <span className="truncate text-xs text-muted-foreground">{lastChange}</span>}
      </div>

      <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground md:ml-0">
        {formatTimecode(time, fps)}
      </span>
      {lastExport?.status === "done" ? (
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" render={<a href={`${AGENT_URL}/exports/${lastExport.id}/file`} download />}>
          <Share2 className="size-4" />
          {formatBytes(lastExport.sizeBytes)}
        </Button>
      ) : null}
      <Button size="sm" onClick={onExport} disabled={!canExport || render !== null}>
        <Download className="size-4" />
        {render ? `Rendering ${Math.round(render.progress * 100)}%` : "Export"}
      </Button>
    </header>
  )
}

function formatBytes(bytes?: number) {
  if (!bytes) return "Download"
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`
}

function IconButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={label} className="size-8 text-muted-foreground" />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
