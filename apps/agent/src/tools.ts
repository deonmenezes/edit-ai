import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { ProjectStore } from "./project.ts"

/**
 * The MCP SDK infers each handler's argument type from its zod shape. That inference is
 * pathological under TypeScript 6: it exhausts the compiler heap on a schema set this
 * size, so tools are registered through a narrow facade and every handler annotates its
 * own arguments instead. Runtime behavior is unchanged; the zod schemas still validate.
 */
type ToolResult = { isError?: boolean; content: { type: "text"; text: string }[] }

type ToolConfig = {
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean>
}

type Registrar = {
  registerTool(name: string, config: ToolConfig, handler: (args: Record<string, never>) => Promise<ToolResult>): void
}

const asRegistrar = (server: McpServer) => server as unknown as Registrar

/** Handlers are annotated individually, so they are adapted to the facade's shape here. */
const handler =
  <A,>(fn: (args: A) => ToolResult) =>
  async (args: Record<string, never>): Promise<ToolResult> =>
    fn(args as A)

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] })

const fail = (err: unknown): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
})

/** Tool errors are returned to the model as data so it can correct itself, not thrown. */
const run = (fn: () => unknown): ToolResult => {
  try {
    return ok(fn())
  } catch (e) {
    return fail(e)
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }

export function buildServer(store: ProjectStore, exportsDir: string) {
  const mcp = new McpServer({ name: "editai", version: "0.1.0" }, { capabilities: { tools: {} } })
  const server = asRegistrar(mcp)

  // ---- read-only: run without approval ------------------------------------

  server.registerTool(
    "get_project",
    {
      title: "Get the project",
      description:
        "The whole timeline: tracks, clips (id, name, kind, trackId, start, duration, sourceOffset, volume), media metadata (transcripts, silences, bpm) and past exports. Call this first. Clip ids change after edits, so read it again before a second round.",
      inputSchema: {},
      annotations: READ,
    },
    handler(() => run(() => store.get())),
  )

  server.registerTool(
    "list_changes",
    {
      title: "List recent changes",
      description: "The most recent edits made to the project, oldest first.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: READ,
    },
    handler(({ limit }: { limit: number }) => run(() => store.listChanges(limit))),
  )

  server.registerTool(
    "transcribe_clip",
    {
      title: "Transcribe a clip",
      description:
        "Speech inside a clip's time range, as timed segments in timeline seconds. Use it to write captions for one clip.",
      inputSchema: { clip_id: z.string().describe("Clip id from get_project, e.g. c3") },
      annotations: READ,
    },
    handler(({ clip_id }: { clip_id: string }) => run(() => store.transcribeClip(clip_id))),
  )

  server.registerTool(
    "find_silences",
    {
      title: "Find silences",
      description:
        "Silent ranges on the voice track, in timeline seconds, at least min_duration long. Read-only: use remove_silences to actually cut them.",
      inputSchema: {
        min_duration: z.number().min(0.1).default(0.5).describe("Seconds"),
        track_id: z.string().default("a1"),
      },
      annotations: READ,
    },
    handler(({ min_duration, track_id }: { min_duration: number; track_id: string }) =>
      run(() => store.findSilences(min_duration, track_id)),
    ),
  )

  server.registerTool(
    "detect_beats",
    {
      title: "Detect beats",
      description: "Beat timestamps in timeline seconds for the music track, derived from its tempo.",
      inputSchema: { track_id: z.string().default("a2") },
      annotations: READ,
    },
    handler(({ track_id }: { track_id: string }) => run(() => store.detectBeats(track_id))),
  )

  // ---- writes: reversible, no approval by default --------------------------

  server.registerTool(
    "split_clip",
    {
      title: "Split a clip",
      description: "Cut a clip in two at a timeline time. Returns both halves.",
      inputSchema: { clip_id: z.string(), at: z.number().describe("Timeline seconds, strictly inside the clip") },
      annotations: WRITE,
    },
    handler(({ clip_id, at }: { clip_id: string; at: number }) => run(() => store.splitClip(clip_id, at))),
  )

  server.registerTool(
    "trim_clip",
    {
      title: "Trim a clip",
      description:
        "Set a clip's new start and/or end on the timeline. Trimming the start keeps the media in sync by moving the source offset.",
      inputSchema: {
        clip_id: z.string(),
        start: z.number().optional().describe("New timeline start, seconds"),
        end: z.number().optional().describe("New timeline end, seconds"),
      },
      annotations: WRITE,
    },
    handler(({ clip_id, start, end }: { clip_id: string; start?: number; end?: number }) =>
      run(() => store.trimClip(clip_id, { start, end })),
    ),
  )

  server.registerTool(
    "move_clip",
    {
      title: "Move a clip",
      description: "Move a clip to a new start time and/or to another track of the same kind.",
      inputSchema: { clip_id: z.string(), start: z.number().optional(), track_id: z.string().optional() },
      annotations: WRITE,
    },
    handler(({ clip_id, start, track_id }: { clip_id: string; start?: number; track_id?: string }) =>
      run(() => store.moveClip(clip_id, { start, trackId: track_id })),
    ),
  )

  server.registerTool(
    "set_volume",
    {
      title: "Set clip volume",
      description: "Volume for a video or audio clip, 0 to 100 percent.",
      inputSchema: { clip_id: z.string(), volume: z.number().min(0).max(100) },
      annotations: WRITE,
    },
    handler(({ clip_id, volume }: { clip_id: string; volume: number }) => run(() => store.setVolume(clip_id, volume))),
  )

  server.registerTool(
    "add_text",
    {
      title: "Add a text clip",
      description: "Add a title or caption on a text track.",
      inputSchema: {
        text: z.string().min(1),
        start: z.number().min(0),
        duration: z.number().min(0.1),
        track_id: z.string().default("t1"),
      },
      annotations: WRITE,
    },
    handler(({ text, start, duration, track_id }: { text: string; start: number; duration: number; track_id: string }) =>
      run(() => store.addTextClip({ text, start, duration, trackId: track_id })),
    ),
  )

  server.registerTool(
    "add_captions",
    {
      title: "Add captions",
      description:
        "Add timed caption clips on the captions track, creating it if needed. Pass segments from transcribe_clip, edited as you see fit.",
      inputSchema: {
        segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().min(1) })).min(1),
        track_label: z.string().default("T2"),
      },
      annotations: WRITE,
    },
    handler(({ segments, track_label }: { segments: { start: number; end: number; text: string }[]; track_label: string }) =>
      run(() => store.addCaptions(segments, track_label)),
    ),
  )

  server.registerTool(
    "undo",
    {
      title: "Undo",
      description: "Revert the most recent change to the project.",
      inputSchema: {},
      annotations: WRITE,
    },
    handler(() => run(() => store.undo())),
  )

  // ---- destructive: the harness pauses for human approval ------------------

  server.registerTool(
    "delete_clip",
    {
      title: "Delete a clip",
      description: "Remove a clip from the timeline, leaving a gap. Destructive: the user is asked to approve first.",
      inputSchema: { clip_id: z.string() },
      annotations: DESTRUCTIVE,
    },
    handler(({ clip_id }: { clip_id: string }) => run(() => store.deleteClip(clip_id))),
  )

  server.registerTool(
    "ripple_delete",
    {
      title: "Ripple delete a range",
      description:
        "Remove a time range from every track and close the gap, shifting later clips left. Destructive: the user is asked to approve first.",
      inputSchema: { start: z.number().min(0), end: z.number().min(0) },
      annotations: DESTRUCTIVE,
    },
    handler(({ start, end }: { start: number; end: number }) => run(() => store.rippleDelete(start, end))),
  )

  server.registerTool(
    "remove_silences",
    {
      title: "Remove silences",
      description:
        "Ripple-delete every silence on the voice track at least min_duration long, across all tracks. Destructive: preview with find_silences and tell the user what will go before calling this.",
      inputSchema: { min_duration: z.number().min(0.1).default(0.5), track_id: z.string().default("a1") },
      annotations: DESTRUCTIVE,
    },
    handler(({ min_duration, track_id }: { min_duration: number; track_id: string }) =>
      run(() => store.removeSilences(min_duration, track_id)),
    ),
  )

  server.registerTool(
    "export_project",
    {
      title: "Export the project",
      description: "Render the timeline to a file. Always asks the user to approve first.",
      inputSchema: {
        format: z.enum(["mp4", "mov", "webm"]).default("mp4"),
        resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"),
      },
      annotations: WRITE,
    },
    handler(({ format, resolution }: { format: string; resolution: string }) =>
      run(() => store.exportProject(format, resolution, exportsDir)),
    ),
  )

  return mcp
}
