import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CommandBar } from "#/components/editor/command-bar"
import { Preview } from "#/components/editor/preview"
import { RightRail } from "#/components/editor/right-rail"
import { SidePanel } from "#/components/editor/side-panel"
import { Timeline } from "#/components/editor/timeline"
import { TopBar } from "#/components/editor/top-bar"
import { useAssistant } from "#/components/editor/use-assistant"
import { usePlayback } from "#/components/editor/use-playback"
import { useProject } from "#/components/editor/use-project"

export const Route = createFileRoute("/")({ component: Editor })

function Editor() {
  const { project, connected, lastChange } = useProject()
  const assistant = useAssistant()
  const { time, playing, toggle, seek, nudge } = usePlayback(project.duration)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")

  const selected = project.clips.find((c) => c.id === selectedId) ?? null

  // A clip the agent deleted should not stay selected.
  useEffect(() => {
    if (selectedId && !project.clips.some((c) => c.id === selectedId)) setSelectedId(null)
  }, [project, selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      if (e.code === "Space") {
        e.preventDefault()
        toggle()
      } else if (e.key === "Home") {
        seek(0)
      } else if (e.key === "End") {
        seek(project.duration)
      } else if (e.key === "ArrowLeft") {
        nudge(e.shiftKey ? -1 : -1 / project.fps)
      } else if (e.key === "ArrowRight") {
        nudge(e.shiftKey ? 1 : 1 / project.fps)
      } else if (e.key === "Escape") {
        setSelectedId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle, seek, nudge, project.duration, project.fps])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <TopBar projectName={project.name} time={time} fps={project.fps} live={connected} lastChange={lastChange} />

      <div className="flex min-h-0 flex-1">
        <SidePanel clips={project.clips} onSuggest={setPrompt} />
        <Preview project={project} time={time} playing={playing} onToggle={toggle} onSeek={seek} className="flex-1" />
        <RightRail assistant={assistant} clip={selected} fps={project.fps} className="hidden lg:flex" />
      </div>

      <div className="flex h-[clamp(220px,42dvh,320px)] shrink-0 flex-col border-t">
        <CommandBar
          value={prompt}
          onChange={setPrompt}
          onSubmit={(text) => void assistant.send(text)}
          busy={assistant.status === "running"}
          disabled={assistant.status === "offline"}
        />
        <Timeline
          project={project}
          time={time}
          playing={playing}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSeek={seek}
        />
      </div>
    </div>
  )
}
