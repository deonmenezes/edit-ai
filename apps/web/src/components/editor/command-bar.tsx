import { ArrowUp, Sparkles } from "lucide-react"
import { useState } from "react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"

const CHIPS = ["Remove silences", "Add captions", "Cut to the beat", "Reframe to 9:16"]

type Props = {
  value: string
  onChange: (v: string) => void
  className?: string
}

export function CommandBar({ value, onChange, className }: Props) {
  const [note, setNote] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = value.trim()
    if (!text) return
    setNote(`Not run: the assistant isn't connected in this build yet. Saved "${text}" for when it is.`)
    onChange("")
  }

  return (
    <div className={cn("flex flex-col gap-1.5 border-b bg-panel px-3 py-2", className)}>
      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-well px-3 transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="sr-only">Tell EditAI what to change</span>
          <input
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              if (note) setNote(null)
            }}
            placeholder="Tell EditAI what to change, like “cut the intro to 3 seconds”"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" className="size-6" aria-label="Run" disabled={!value.trim()}>
            <ArrowUp className="size-3.5" />
          </Button>
        </label>
        <div className="hidden items-center gap-1 lg:flex">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {c}
            </button>
          ))}
        </div>
      </form>
      {note && (
        <p role="status" className="px-1 text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}
