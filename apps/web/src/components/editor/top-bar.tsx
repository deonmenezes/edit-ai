import { Download, Redo2, Share2, Undo2 } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Separator } from "#/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { formatTimecode } from "./data"

type Props = {
  projectName: string
  time: number
  fps: number
}

export function TopBar({ projectName, time, fps }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-panel px-3">
      <a href="/" className="flex items-baseline gap-1.5 rounded-sm px-1 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="font-heading text-[19px] italic leading-none tracking-tight">EditAI</span>
        <span aria-hidden className="mb-0.5 size-1.5 rounded-full bg-primary" />
      </a>
      <Separator orientation="vertical" className="h-5!" />
      <span className="truncate text-sm text-muted-foreground">{projectName}</span>
      <span className="hidden rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
        Draft
      </span>

      <div className="mx-auto hidden items-center gap-0.5 md:flex">
        <IconButton label="Undo" icon={<Undo2 className="size-4" />} />
        <IconButton label="Redo" icon={<Redo2 className="size-4" />} />
      </div>

      <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground md:ml-0">
        {formatTimecode(time, fps)}
      </span>
      <Button variant="outline" size="sm" className="hidden sm:inline-flex">
        <Share2 className="size-4" />
        Share
      </Button>
      <Button size="sm">
        <Download className="size-4" />
        Export
      </Button>
    </header>
  )
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
