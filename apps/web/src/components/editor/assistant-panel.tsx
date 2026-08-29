import { AlertTriangle, Check, Loader2, RotateCcw, Sparkles, Square, Wrench, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"
import type { ChatItem, PendingApproval, PendingQuestion } from "./transcript"
import type { AssistantState } from "./use-assistant"

type Props = {
  assistant: AssistantState & {
    send: (text: string) => Promise<void>
    decide: (d: { approval: PendingApproval; allow: boolean; reason?: string }[]) => Promise<void>
    answer: (q: PendingQuestion, content: string) => Promise<void>
    continueAfterAuth: () => Promise<void>
    stop: () => Promise<void>
    reset: () => void
  }
  className?: string
}

const STATUS: Record<AssistantState["status"], { label: string; tone: string }> = {
  idle: { label: "Starting", tone: "text-muted-foreground" },
  connecting: { label: "Connecting", tone: "text-muted-foreground" },
  ready: { label: "Ready", tone: "text-[var(--clip-audio)]" },
  running: { label: "Working", tone: "text-primary" },
  offline: { label: "Harness offline", tone: "text-destructive" },
}

export function AssistantPanel({ assistant, className }: Props) {
  const { status, error, items, approvals, questions, auth } = assistant
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [items])

  const badge = STATUS[status]

  return (
    <aside aria-label="Assistant" className={cn("flex min-h-0 w-[360px] shrink-0 flex-col border-l bg-panel", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-medium">Assistant</h2>
        <span className={cn("ml-auto flex items-center gap-1.5 text-[11px]", badge.tone)}>
          {status === "running" && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {badge.label}
        </span>
        {status === "running" ? (
          <Button variant="ghost" size="icon" className="size-7" aria-label="Stop" onClick={() => void assistant.stop()}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="size-7" aria-label="New conversation" onClick={assistant.reset}>
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {items.length === 0 && status !== "offline" && <Empty />}
        {status === "offline" && <Offline />}
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>

      {/* Anything blocking the run is pinned here: an approval must never hide in scrollback. */}
      {(auth.length > 0 || questions.length > 0 || approvals.length > 0) && (
        <div className="flex max-h-[55%] shrink-0 flex-col gap-2 overflow-y-auto border-t bg-well/50 p-3">
          {auth.map((a) => (
            <Card key={a.name} tone="warn" title={`${a.name} needs authorization`}>
              <p className="text-xs text-muted-foreground">Sign in to the connector, then continue the run.</p>
              <div className="mt-2 flex gap-1.5">
                <Button size="xs" onClick={() => window.open(a.authUrl, "_blank", "noopener,width=520,height=680")}>
                  Connect {a.name}
                </Button>
                <Button size="xs" variant="outline" onClick={() => void assistant.continueAfterAuth()}>
                  I have authorized it
                </Button>
              </div>
            </Card>
          ))}

          {questions.map((q) => (
            <Question key={q.toolCallId} question={q} onAnswer={(text) => void assistant.answer(q, text)} />
          ))}

          {approvals.length > 0 && (
            <Approvals approvals={approvals} onDecide={(decisions) => void assistant.decide(decisions)} />
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </aside>
  )
}

function Empty() {
  return (
    <div className="rounded-md border border-dashed p-3">
      <p className="text-sm">Ask for an edit.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The assistant reads this timeline and edits it with tools. Destructive steps stop for your approval first.
      </p>
    </div>
  )
}

function Offline() {
  return (
    <Card tone="warn" title="The harness is not running">
      <p className="text-xs text-muted-foreground">
        Start it with <code className="font-mono">npx @truefoundry/trueforge</code>, then reload this page.
      </p>
    </Card>
  )
}

function Card({
  tone = "plain",
  title,
  children,
}: {
  tone?: "plain" | "warn"
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("rounded-md border p-2.5", tone === "warn" && "border-[var(--clip-text)]/40 bg-[var(--clip-text)]/5")}>
      <div className="mb-1 flex items-center gap-1.5">
        {tone === "warn" && <AlertTriangle className="size-3.5 text-[var(--clip-text)]" aria-hidden />}
        <span className="text-xs font-medium">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Item({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="self-end rounded-md rounded-br-sm bg-primary px-2.5 py-1.5 text-sm text-primary-foreground">
        {item.text}
      </div>
    )
  }

  if (item.kind === "note") {
    return <p className="text-xs text-muted-foreground">{item.text}</p>
  }

  if (item.kind === "thread") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", item.done ? "bg-[var(--clip-audio)]" : "animate-pulse bg-primary")} />
        Sub-agent: {item.title}
        {item.done && " · done"}
      </div>
    )
  }

  if (item.kind === "tool") {
    return (
      <details className="rounded-md border bg-card px-2.5 py-1.5">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground">
          <Check className="size-3 text-[var(--clip-audio)]" aria-hidden />
          <span className="font-mono">{item.name}</span>
          <span className="ml-auto">result</span>
        </summary>
        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
          {item.content.slice(0, 4000)}
        </pre>
      </details>
    )
  }

  const isSub = item.threadId !== "main"
  return (
    <div className={cn(isSub && "border-l-2 border-border pl-2.5")}>
      {item.text && <p className="whitespace-pre-wrap text-sm">{item.text}</p>}
      {item.toolCalls.map((call) => (
        <div key={call.id} className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Wrench className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-mono">{call.name}</span>
            {call.args && call.args !== "{}" && (
              <span className="ml-1 break-all font-mono opacity-70">{call.args.slice(0, 200)}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function Approvals({
  approvals,
  onDecide,
}: {
  approvals: PendingApproval[]
  onDecide: (d: { approval: PendingApproval; allow: boolean; reason?: string }[]) => void
}) {
  return (
    <Card tone="warn" title={approvals.length === 1 ? "Approve this step?" : `Approve ${approvals.length} steps?`}>
      <ul className="mb-2 flex flex-col gap-1.5">
        {approvals.map((a) => (
          <li key={a.toolCallId} className="rounded-sm bg-well p-2">
            <span className="block font-mono text-xs">{a.name}</span>
            {a.args && a.args !== "{}" && (
              <span className="mt-0.5 block break-all font-mono text-[10px] text-muted-foreground">{a.args}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-1.5">
        <Button size="xs" onClick={() => onDecide(approvals.map((approval) => ({ approval, allow: true })))}>
          <Check className="size-3.5" />
          Allow
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onDecide(approvals.map((approval) => ({ approval, allow: false, reason: "The user declined this step." })))}
        >
          <X className="size-3.5" />
          Deny
        </Button>
      </div>
    </Card>
  )
}

function Question({ question, onAnswer }: { question: PendingQuestion; onAnswer: (text: string) => void }) {
  const [text, setText] = useState("")
  return (
    <Card title="The assistant has a question">
      <p className="mb-2 text-sm">{question.question}</p>
      {question.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((option) => (
            <Button key={option} size="xs" variant="outline" onClick={() => onAnswer(option)}>
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) onAnswer(text.trim())
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your answer"
            className="h-7 min-w-0 flex-1 rounded-sm border bg-well px-2 text-xs outline-none focus:border-primary"
          />
          <Button size="xs" type="submit" disabled={!text.trim()}>
            Send
          </Button>
        </form>
      )}
    </Card>
  )
}
