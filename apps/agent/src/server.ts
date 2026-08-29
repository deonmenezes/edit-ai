import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import cors from "cors"
import express from "express"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ProjectStore } from "./project.ts"
import { buildServer } from "./tools.ts"

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.EDITAI_DATA_DIR ?? join(here, "..", "data")
const PORT = Number(process.env.EDITAI_AGENT_PORT ?? 8941)

const store = new ProjectStore(join(DATA_DIR, "project.json"))
const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: "2mb" }))

app.get("/", (_req, res) => {
  res.type("text/plain").send("EditAI agent server. MCP at POST /mcp. Project at GET /project, live at GET /events.")
})

app.get("/healthz", (_req, res) => res.json({ ok: true, revision: store.revision }))

app.get("/project", (_req, res) => {
  res.json({ project: store.get(), revision: store.revision, changes: store.listChanges(20) })
})

app.post("/project/reset", (_req, res) => {
  store.reset()
  res.json({ project: store.get(), revision: store.revision })
})

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
    const server = buildServer(store, join(DATA_DIR, "exports"))
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
  console.log(`[editai-agent] listening on http://localhost:${PORT}  (MCP: /mcp, project: /project, events: /events)`)
})
