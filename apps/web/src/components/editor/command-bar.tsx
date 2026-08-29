import { ArrowUp, Loader2, Sparkles } from "lucide-react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"

const CHIPS = ["Remove the silences", "Caption every video clip", "Cut the intro to 3 seconds", "Duck the music under the voiceover"]

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  busy: boolean
  disabled?: boolean
  className?: string
}

export function CommandBar({ value, onChange, onSubmit, busy, disabled, className }: Props) {
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = value.trim()
    if (!text || busy || disabled) return
    onSubmit(text)
    onChange("")
  }

  return (
    <div className={cn("flex flex-col gap-1.5 border-b bg-panel px-3 py-2", className)}>
      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-well px-3 transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
          {busy ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          ) : (
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          )}
          <span className="sr-only">Tell EditAI what to change</span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={
              disabled ? "Start the harness to use the assistant" : "Tell EditAI what to change, like “cut the intro to 3 seconds”"
            }
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <Button type="submit" size="icon" className="size-6" aria-label="Run" disabled={!value.trim() || busy || disabled}>
            <ArrowUp className="size-3.5" />
          </Button>
        </label>
        <div className="hidden items-center gap-1 xl:flex">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              disabled={disabled}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
}
