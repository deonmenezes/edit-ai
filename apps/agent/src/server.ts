import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import cors from "cors"
import express from "express"
import { createReadStream, existsSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mimeFor, safeMediaName, saveUpload } from "./media.ts"
import { ProjectStore } from "./project.ts"
import { buildServer } from "./tools.ts"

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.EDITAI_DATA_DIR ?? join(here, "..", "data")
const MEDIA_DIR = join(DATA_DIR, "media")
const EXPORTS_DIR = join(DATA_DIR, "exports")
const PORT = Number(process.env.EDITAI_AGENT_PORT ?? 8941)

const store = new ProjectStore(join(DATA_DIR, "project.json"), MEDIA_DIR)
const app = express()
app.use(cors({ origin: true }))

/** Uploads stream straight to disk, so they must not be buffered by the JSON parser first. */
const isUpload = (url: string) => /^\/(media\/[^/]+|exports\/[^/]+\/file)$/.test(url.split("?")[0]!)
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
    // Range support keeps a <video> element and a partial re-fetch from pulling the whole file.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "")
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || end < start) {
        res.setHeader("Content-Range", `bytes */${size}`)
        return res.status(416).end()
      }
      res.status(206)
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`)
      res.setHeader("Content-Length", String(end - start + 1))
      return createReadStream(file, { start, end }).pipe(res)
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
    if (!claimed) return res.status(409).json({ error: `Export ${req.params.id} is not pending.`, export: store.getExport(req.params.id) })
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
    res.json({ export: store.failExport(req.params.id, String(req.body?.error ?? "Unknown render error")) })
  } catch (err) {
    fail(res, 400, err)
  }
})

/** The finished encode, streamed to disk and then moved into place. */
app.post("/exports/:id/file", async (req, res) => {
  try {
    const rec = store.getExport(req.params.id)
    const uploaded = join(EXPORTS_DIR, `${rec.id}.upload`)
    const bytes = await saveUpload(req, EXPORTS_DIR, `${rec.id}.upload`)
    res.json({ export: store.completeExport(rec.id, uploaded), bytes })
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
