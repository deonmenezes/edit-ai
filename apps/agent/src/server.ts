import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import cors from "cors"
import express from "express"
import { createReadStream, existsSync, statSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mimeFor, parseRange, readBody, safeMediaName, saveUpload, writeChunkAt } from "./media.ts"
import { ProjectStore } from "./project.ts"
import { buildServer } from "./tools.ts"

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.EDITAI_DATA_DIR ?? join(here, "..", "data")
const MEDIA_DIR = join(DATA_DIR, "media")
const EXPORTS_DIR = join(DATA_DIR, "exports")
const PORT = Number(process.env.EDITAI_AGENT_PORT ?? 8941)

/** Where an in-flight encode accumulates before it is moved to its final name. */
const renderPath = (id: string) => join(EXPORTS_DIR, `${id}.render`)

const store = new ProjectStore(join(DATA_DIR, "project.json"), MEDIA_DIR)
const app = express()
app.use(cors({ origin: true }))

/** Uploads stream straight to disk, so they must not be buffered by the JSON parser first. */
const isUpload = (url: string) => /^\/(media\/[^/]+|exports\/[^/]+\/chunk)$/.test(url.split("?")[0]!)
app.use((req, res, next) => (req.method === "POST" && isUpload(req.url) ? next() : express.json({ limit: "8mb" })(req, res, next)))

const fail = (res: express.Response, status: number, err: unknown) =>
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) })

app.get("/", (_req, res) => {
  res.type("text/plain").send("EditAI agent server. MCP at POST /mcp. Project at GET /project, live at GET /events, media at GET /media.")
})

app.get("/healthz", (_req, res) => res.json({ ok: true, revision: store.revision }))

app.get("/project", (_req, res) => {
  res.json({ project: store.get(), revision: store.revision, changes: store.listChanges(20) })
})

app.post("/project/reset", (req, res) => {
  store.reset({ empty: req.body?.empty === true })
  res.json({ project: store.get(), revision: store.revision })
})

// ---- media ----------------------------------------------------------------

app.get("/media", (_req, res) => res.json({ media: store.get().media, dir: MEDIA_DIR }))

/**
 * The editor measures media with WebCodecs and posts the bytes here, so the server needs
 * no decoder of its own. Metadata rides in the query string; the body is the file.
 */
app.post("/media/:name", async (req, res) => {
  try {
    const name = safeMediaName(req.params.name)
    const q = req.query as Record<string, string | undefined>
    const duration = Number(q.duration)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("A positive ?duration= in seconds is required.")
    const sizeBytes = await saveUpload(req, MEDIA_DIR, name)
    const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v))
    const info = store.registerMedia(name, {
      duration,
      file: name,
      sizeBytes,
      width: num(q.width),
      height: num(q.height),
      fps: num(q.fps),
      hasAudio: q.hasAudio === undefined ? undefined : q.hasAudio === "true",
    })
    res.json({ media: info, name })
  } catch (err) {
    fail(res, 400, err)
  }
})

app.post("/media/:name/analysis", (req, res) => {
  try {
    res.json({ media: store.setMediaAnalysis(safeMediaName(req.params.name), req.body ?? {}) })
  } catch (err) {
    fail(res, 400, err)
  }
})

app.get("/media/:name", (req, res) => {
  try {
    const name = safeMediaName(req.params.name)
    const file = join(MEDIA_DIR, name)
    if (!existsSync(file)) return fail(res, 404, new Error(`No media file named "${name}".`))
    const { size } = statSync(file)
    res.setHeader("Content-Type", mimeFor(name))
    res.setHeader("Accept-Ranges", "bytes")
    // Range support keeps a decoder from pulling the whole file to read one atom.
    const range = parseRange(req.headers.range, size)
    if (range === "unsatisfiable") {
      res.setHeader("Content-Range", `bytes */${size}`)
      return res.status(416).end()
    }
    if (range) {
      res.status(206)
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
      res.setHeader("Content-Length", String(range.end - range.start + 1))
      return createReadStream(file, { start: range.start, end: range.end }).pipe(res)
    }
    res.setHeader("Content-Length", String(size))
    createReadStream(file).pipe(res)
  } catch (err) {
    fail(res, 400, err)
  }
})

// ---- renders --------------------------------------------------------------

/** The Export button queues the same job the agent's export_project tool does. */
app.post("/exports", (req, res) => {
  try {
    const format = String(req.body?.format ?? "mp4")
    const resolution = String(req.body?.resolution ?? "1080p")
    res.json({ export: store.requestExport(format, resolution, EXPORTS_DIR) })
  } catch (err) {
    fail(res, 400, err)
  }
})

/** The editor claims the oldest queued render and encodes it. */
app.get("/exports/pending", (_req, res) => res.json({ export: store.pendingExport() }))

/** Claiming is what stops two open editors from encoding the same job twice. */
app.post("/exports/:id/claim", (req, res) => {
  try {
    const claimed = store.claimExport(req.params.id)
    if (!claimed) return res.status(409).json({ error: `Export ${req.params.id} is not claimable.`, export: store.getExport(req.params.id) })
    // A reclaim starts from nothing. Writing a fresh encode over an abandoned one leaves any
    // trailing bytes of the longer attempt behind, which is a corrupt file rather than a retry.
    const partial = renderPath(claimed.id)
    if (existsSync(partial)) unlinkSync(partial)
    res.json({ export: claimed })
  } catch (err) {
    fail(res, 404, err)
  }
})

app.post("/exports/:id/progress", (req, res) => {
  try {
    res.json({ export: store.setExportProgress(req.params.id, Number(req.body?.progress)) })
  } catch (err) {
    fail(res, 400, err)
  }
})

app.post("/exports/:id/failed", (req, res) => {
  try {
    // A half-written render is not worth keeping; the retry starts from an empty file.
    const partial = renderPath(req.params.id)
    if (existsSync(partial)) unlinkSync(partial)
    res.json({ export: store.failExport(req.params.id, String(req.body?.error ?? "Unknown render error")) })
  } catch (err) {
    fail(res, 400, err)
  }
})

/** The timeline as it was when the render was queued. Workers render this, not the live project. */
app.get("/exports/:id/project", (req, res) => {
  try {
    res.json({ project: store.exportSnapshot(req.params.id) })
  } catch (err) {
    fail(res, 404, err)
  }
})

/**
 * One slice of the encode, written at its byte offset.
 *
 * The muxer emits chunks as it goes and revisits earlier offsets to finish the index, so this
 * takes a position rather than appending. Uploading as it encodes is what keeps a long render
 * off the browser's heap.
 */
const CHUNK_LIMIT = 32 * 1024 * 1024

app.post("/exports/:id/chunk", async (req, res) => {
  try {
    const rec = store.getExport(req.params.id)
    const position = Number((req.query as Record<string, string | undefined>).position)
    if (!Number.isInteger(position) || position < 0) throw new Error("A non-negative integer ?position= is required.")
    const data = await readBody(req, CHUNK_LIMIT)
    if (data.length === 0) throw new Error("Chunk was empty.")
    writeChunkAt(renderPath(rec.id), position, data)
    res.json({ ok: true, position, bytes: data.length })
  } catch (err) {
    fail(res, 400, err)
  }
})

/** The encode is complete: move what the chunks built into place. */
app.post("/exports/:id/finish", (req, res) => {
  try {
    const rec = store.getExport(req.params.id)
    res.json({ export: store.completeExport(rec.id, renderPath(rec.id)) })
  } catch (err) {
    fail(res, 400, err)
  }
})

app.get("/exports/:id/file", (req, res) => {
  try {
    const rec = store.getExport(req.params.id)
    if (rec.status !== "done" || !existsSync(rec.file)) return fail(res, 404, new Error(`Export ${rec.id} has no file yet.`))
    res.setHeader("Content-Type", mimeFor(rec.file))
    res.setHeader("Content-Disposition", `attachment; filename="${rec.file.split("/").pop()}"`)
    createReadStream(rec.file).pipe(res)
  } catch (err) {
    fail(res, 404, err)
  }
})

// ---- live -----------------------------------------------------------------

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  send("project", { project: store.get(), revision: store.revision, change: null })
  const unsubscribe = store.subscribe((project, change) => send("project", { project, revision: store.revision, change }))
  const ping = setInterval(() => res.write(": ping\n\n"), 15000)
  req.on("close", () => {
    clearInterval(ping)
    unsubscribe()
  })
})

app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer(store, EXPORTS_DIR)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on("close", () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error("[editai-mcp] request failed:", err instanceof Error ? err.message : err)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null })
    }
  }
})

app.all("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST" }, id: null })
})

app.listen(PORT, () => {
  console.log(`[editai-agent] listening on http://localhost:${PORT}  (MCP: /mcp, project: /project, media: /media, events: /events)`)
  console.log(`[editai-agent] media dir: ${MEDIA_DIR}`)
})
