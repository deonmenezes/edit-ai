import { Sliders, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "#/lib/utils"
import { AssistantPanel } from "./assistant-panel"
import type { Clip } from "./data"
import { Properties } from "./properties"
import type { useAssistant } from "./use-assistant"

type Tab = "assistant" | "properties"

type Props = {
  assistant: ReturnType<typeof useAssistant>
  clip: Clip | null
  fps: number
  className?: string
}

export function RightRail({ assistant, clip, fps, className }: Props) {
  const [tab, setTab] = useState<Tab>("assistant")

  // Selecting a clip is a request to inspect it, so bring its properties forward.
  useEffect(() => {
    if (clip) setTab("properties")
  }, [clip])

  const pending = assistant.approvals.length + assistant.questions.length + assistant.auth.length

  return (
    <div className={cn("flex min-h-0 w-[360px] shrink-0 flex-col border-l bg-panel", className)}>
      <div role="tablist" aria-label="Right panel" className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <TabButton id="assistant" active={tab} onSelect={setTab} badge={pending || undefined}>
          <Sparkles className="size-3.5" />
          Assistant
        </TabButton>
        <TabButton id="properties" active={tab} onSelect={setTab} dot={Boolean(clip)}>
          <Sliders className="size-3.5" />
          Properties
        </TabButton>
      </div>
      {tab === "assistant" ? (
        <AssistantPanel assistant={assistant} className="min-h-0 w-full flex-1 border-l-0" />
      ) : (
        <Properties clip={clip} fps={fps} className="min-h-0 w-full flex-1 border-l-0" />
      )}
    </div>
  )
}

function TabButton({
  id,
  active,
  onSelect,
  children,
  badge,
  dot,
}: {
  id: Tab
  active: Tab
  onSelect: (t: Tab) => void
  children: React.ReactNode
  badge?: number
  dot?: boolean
}) {
  const selected = active === id
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        selected && "bg-accent text-foreground",
      )}
    >
      {children}
      {badge ? (
        <span className="ml-0.5 rounded-full bg-[var(--clip-text)] px-1.5 text-[10px] font-medium text-black">{badge}</span>
      ) : dot ? (
        <span className="ml-0.5 size-1.5 rounded-full bg-primary" />
      ) : null}
    </button>
  )
}
