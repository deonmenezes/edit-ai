/**
 * Registers everything EditAI needs in a running TrueForge server, idempotently:
 *   - model providers for every API key present in the environment
 *   - the editai MCP server (this package's /mcp endpoint)
 *   - the Daytona sandbox provider, when DAYTONA_API_KEY is set
 *   - the `editai` agent from agent.json
 *
 * Usage: bun scripts/setup.ts            (see README for the env vars)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const TF = (process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790").replace(/\/$/, "")
const MCP_URL = process.env.EDITAI_MCP_URL ?? `http://localhost:${process.env.EDITAI_AGENT_PORT ?? 8941}/mcp`
const AGENT_NAME = process.env.EDITAI_AGENT_NAME ?? "editai"
/** Catalog connectors to attach alongside the timeline tools. Keyless by default. */
const CONNECTORS = (process.env.EDITAI_CONNECTORS ?? "exa")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean)
const headers: Record<string, string> = { "content-type": "application/json" }
if (process.env.TRUEFORGE_TOKEN) headers.authorization = `Bearer ${process.env.TRUEFORGE_TOKEN}`

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${TF}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let data: any = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {}
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`)
  return { status: res.status, data }
}

type CatalogModel = { model_id: string; name: string; properties?: Record<string, unknown> }
type CatalogProvider = { type: string; models: CatalogModel[] }

async function catalogModels(type: string): Promise<CatalogModel[]> {
  const { data } = await api<{ data: CatalogProvider[] }>("GET", "/catalogs/model-providers")
  return data.data.find((p) => p.type === type)?.models ?? []
}

async function configureProviders() {
  const configured: string[] = []
  const standard: { type: string; env: string }[] = [
    { type: "anthropic", env: "ANTHROPIC_API_KEY" },
    { type: "openai", env: "OPENAI_API_KEY" },
    { type: "google-gemini", env: "GEMINI_API_KEY" },
  ]
  for (const p of standard) {
    const key = process.env[p.env]
    if (!key) continue
    const models = await catalogModels(p.type)
    if (models.length === 0) {
      console.warn(`  skip ${p.type}: no models in the catalog`)
      continue
    }
    await api("PUT", "/settings/model-providers", { manifest: { type: p.type, auth: { api_key: key }, models } })
    configured.push(p.type)
  }
  if (process.env.NVIDIA_API_KEY) {
    await api("PUT", "/settings/model-providers", {
      manifest: {
        type: "custom",
        name: "nvidia",
        base_url: "https://integrate.api.nvidia.com/v1",
        auth: { api_key: process.env.NVIDIA_API_KEY },
        models: [
          { model_id: "moonshotai/kimi-k3", name: "kimi-k3", properties: { context_length: 256000, max_output_tokens: 32000 } },
          { model_id: "deepseek-ai/deepseek-v4-pro-0813", name: "deepseek-v4-pro", properties: { context_length: 128000, max_output_tokens: 32000 } },
          { model_id: "nvidia/nemotron-3-super-120b-a12b", name: "nemotron-3-super", properties: { context_length: 128000, max_output_tokens: 32000 } },
          { model_id: "openai/gpt-oss-120b", name: "gpt-oss-120b", properties: { context_length: 128000, max_output_tokens: 32000 } },
        ],
      },
    })
    configured.push("nvidia (custom, OpenAI-compatible)")
  }
  if (process.env.OPENAI_COMPATIBLE_BASE_URL && process.env.OPENAI_COMPATIBLE_API_KEY && process.env.OPENAI_COMPATIBLE_MODELS) {
    const models = process.env.OPENAI_COMPATIBLE_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    await api("PUT", "/settings/model-providers", {
      manifest: {
        type: "custom",
        name: process.env.OPENAI_COMPATIBLE_NAME ?? "compatible",
        base_url: process.env.OPENAI_COMPATIBLE_BASE_URL,
        auth: { api_key: process.env.OPENAI_COMPATIBLE_API_KEY },
        models: models.map((m) => ({ model_id: m, name: m.replace(/[^a-z0-9._-]/gi, "-").toLowerCase(), properties: {} })),
      },
    })
    configured.push(`${process.env.OPENAI_COMPATIBLE_NAME ?? "compatible"} (custom)`)
  }
  return configured
}

type CatalogServer = { name: string; url: string; description?: string; auth?: { type: string } | null }

async function configureMcp() {
  await api("PUT", "/settings/mcp-servers", {
    manifest: {
      type: "remote",
      name: "editai",
      url: MCP_URL,
      description: "EditAI timeline: read the project, split/trim/move clips, captions, silence removal, export.",
    },
  })
  const { data } = await api<{ data: { name: string }[] }>("GET", "/mcp-servers/editai/tools")
  return data.data.map((t) => t.name)
}

/**
 * Attaches extra MCP servers. Catalog entries are looked up by name; a server with no auth
 * works immediately, one using OAuth (dynamic client registration) is registered here and
 * authorized by the user in chat the first time the agent reaches for it.
 */
async function configureConnectors(): Promise<{ name: string; auth: string }[]> {
  if (CONNECTORS.length === 0) return []
  const { data } = await api<{ data: CatalogServer[] }>("GET", "/catalogs/mcp-servers")
  const attached: { name: string; auth: string }[] = []
  for (const name of CONNECTORS) {
    const entry = data.data.find((c) => c.name === name)
    if (!entry) {
      console.warn(`  skip connector "${name}": not in the catalog`)
      continue
    }
    const authType = entry.auth?.type ?? null
    if (authType === "header") {
      const key = process.env[`${name.toUpperCase().replace(/-/g, "_")}_MCP_HEADER`]
      if (!key) {
        console.warn(`  skip connector "${name}": needs ${name.toUpperCase().replace(/-/g, "_")}_MCP_HEADER (e.g. "Authorization: Bearer ...")`)
        continue
      }
      const sep = key.indexOf(":")
      if (sep === -1 || !key.slice(sep + 1).trim()) {
        console.warn(`  skip connector "${name}": its header env var must be "Header-Name: value"`)
        continue
      }
      const header = key.slice(0, sep).trim()
      const value = key.slice(sep + 1).trim()
      await api("PUT", "/settings/mcp-servers", {
        manifest: {
          type: "remote",
          name,
          url: entry.url,
          description: entry.description ?? name,
          auth: { type: "header", headers: { [header]: value } },
        },
      })
    } else {
      await api("PUT", "/settings/mcp-servers", {
        manifest: {
          type: "remote",
          name,
          url: entry.url,
          description: entry.description ?? name,
          ...(authType === "dcr" ? { auth: { type: "dcr" } } : {}),
        },
      })
    }
    attached.push({ name, auth: authType ?? "none" })
  }
  return attached
}

async function configureSandbox(): Promise<boolean> {
  if (!process.env.DAYTONA_API_KEY) {
    try {
      const { data } = await api<{ data: unknown }>("GET", "/settings/sandbox-providers")
      return Boolean(data?.data)
    } catch {
      return false
    }
  }
  await api("PUT", "/settings/sandbox-providers", {
    manifest: {
      type: "daytona",
      auth: { api_key: process.env.DAYTONA_API_KEY },
      exec_timeout_ms: 600000,
      auto_stop_interval_in_minutes: 15,
      auto_archive_interval_in_minutes: 60,
      auto_delete_interval_in_minutes: 1440,
    },
  })
  return true
}

async function pickModel(): Promise<string> {
  const { data } = await api<{ data: { name: string }[] }>("GET", "/models")
  const names = data.data.map((m) => m.name)
  if (names.length === 0) throw new Error("No models configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or NVIDIA_API_KEY and rerun.")
  const wanted = process.env.EDITAI_MODEL
  if (wanted) {
    if (!names.includes(wanted)) throw new Error(`EDITAI_MODEL=${wanted} is not configured. Available: ${names.join(", ")}`)
    return wanted
  }
  // nemotron-3-super is the NVIDIA model that held up under free-tier quota during testing;
  // kimi-k3 returns 429 on tool-heavy turns.
  const preferred = [
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-5",
    "openai/gpt-5-5",
    "google-gemini/gemini-3-pro",
    "nvidia/nemotron-3-super",
  ]
  return preferred.find((p) => names.includes(p)) ?? names[0]!
}

async function upsertAgent(model: string, sandbox: boolean, connectors: { name: string; auth: string }[]) {
  const manifest = JSON.parse(readFileSync(join(here, "..", "agent.json"), "utf8"))
  manifest.model.name = model
  manifest.config.sandbox.enabled = sandbox
  // Extra connectors are read-only and deferred: they should not enlarge the tool context
  // unless the agent actually reaches for research.
  for (const c of connectors) {
    if (manifest.mcp_servers.some((m: { name: string }) => m.name === c.name)) continue
    manifest.mcp_servers.push({ name: c.name, enable_tools: ["@read-only"], preload: false })
  }
  const { data: list } = await api<{ data: { id: string; name: string }[] }>("GET", "/agents")
  const existing = list.data.find((a) => a.name === AGENT_NAME)
  if (existing) {
    await api("PUT", `/agents/${existing.id}`, { name: AGENT_NAME, manifest }).catch(() => api("PUT", `/agents/${existing.id}`, { manifest }))
    return { id: existing.id, updated: true }
  }
  const { data } = await api<{ data: { id: string } }>("POST", "/agents", { name: AGENT_NAME, manifest })
  return { id: data.data.id, updated: false }
}

// API keys are POSTed to the harness. Over plaintext HTTP that is only acceptable on this machine.
const tfUrl = new URL(TF)
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(tfUrl.hostname)
if (tfUrl.protocol !== "https:" && !isLocal) {
  throw new Error(
    `Refusing to send API keys to ${TF} over plaintext HTTP. Use https:// for a remote TrueForge, ` +
      `or set TRUEFORGE_BASE_URL to a localhost address.`,
  )
}

console.log(`TrueForge: ${TF}`)
await api("GET", "/capabilities").catch(() => {
  throw new Error(`TrueForge is not reachable at ${TF}. Start it with: npx @truefoundry/trueforge`)
})
const providers = await configureProviders()
console.log(`Model providers: ${providers.length ? providers.join(", ") : "none added (no API keys in env)"}`)
const tools = await configureMcp()
console.log(`MCP server "editai" at ${MCP_URL}: ${tools.length} tools (${tools.join(", ")})`)
const connectors = await configureConnectors()
console.log(
  `Extra connectors: ${connectors.length ? connectors.map((c) => `${c.name} (auth: ${c.auth})`).join(", ") : "none"}`,
)
const sandbox = await configureSandbox()
console.log(`Sandbox: ${sandbox ? "Daytona configured, enabled on the agent" : "not configured (set DAYTONA_API_KEY to enable code execution and skills)"}`)
const model = await pickModel()
const agent = await upsertAgent(model, sandbox, connectors)
console.log(`Agent "${AGENT_NAME}" ${agent.updated ? "updated" : "created"} (id ${agent.id}) on model ${model}`)
console.log(`Open ${TF} and pick "${AGENT_NAME}" in the Agents Library, or run the web app.`)
