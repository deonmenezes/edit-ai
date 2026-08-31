// mcp-ffmpeg-sandbox.mjs
//
// An MCP server that gives an agent a sandboxed media workbench.
// Every ffmpeg/ffprobe invocation runs inside a throwaway Docker container with
// no network, a single mounted workspace, capped memory/CPU, and a hard timeout.
//
//   bun install                    (from the repo root; this is a workspace package)
//   bun run build:image            (docker build -f Dockerfile.sandbox -t editai-sandbox .)
//   bun run start                  (http://localhost:8931/mcp)
//
// `bun run setup` in apps/agent finds it here via /health, registers it with
// TrueForge as the "ffmpeg-sandbox" connector, and attaches it to the agent.

import express from "express";
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 8931);
const IMAGE = process.env.SANDBOX_IMAGE ?? "editai-sandbox";
const WORKSPACE = path.resolve(process.env.WORKSPACE ?? "./workspace");
const TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS ?? 300_000); // 5 min
const MEMORY = process.env.SANDBOX_MEMORY ?? "2g";
const CPUS = process.env.SANDBOX_CPUS ?? "2";

mkdirSync(WORKSPACE, { recursive: true });

// --- guards ---------------------------------------------------------------

// Reject anything that would escape the workspace or reach outside the container.
function assertSafeArgs(args) {
  for (const a of args) {
    if (typeof a !== "string") throw new Error("all args must be strings");
    if (a.includes("..")) throw new Error(`path traversal in arg: ${a}`);
    if (a.startsWith("/") && !a.startsWith("/work/")) {
      throw new Error(`absolute path outside /work: ${a}`);
    }
    if (/^(https?|ftp|rtmp|rtsp|tcp|udp):\/\//i.test(a)) {
      throw new Error("network protocols are not available in the sandbox");
    }
  }
}

// `validatePaths` is off for payloads that are code rather than paths. Inside the container
// only /work is mounted and there is no network, so scanning a Python source string for ".."
// or a URL rejects valid code without adding a boundary: the container is the boundary.
function runInSandbox(binary, args, { validatePaths = true } = {}) {
  if (validatePaths) assertSafeArgs(args);

  const dockerArgs = [
    "run", "--rm",
    "--network", "none",
    "--memory", MEMORY,
    "--cpus", CPUS,
    "--pids-limit", "256",
    "-v", `${WORKSPACE}:/work`,
    "-w", "/work",
    IMAGE,
    binary,
    ...args,
  ];

  return new Promise((resolve) => {
    const child = spawn("docker", dockerArgs, { timeout: TIMEOUT_MS });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: String(err) });
    });
    child.on("close", (code, signal) => {
      resolve({
        ok: code === 0,
        code,
        signal,
        // ffmpeg is chatty; the tail is where the errors live
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
  });
}

function listWorkspace(dir = WORKSPACE, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listWorkspace(full, rel));
    else out.push({ path: rel, bytes: s.size });
  }
  return out;
}

const asText = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

// --- server ---------------------------------------------------------------

function buildServer() {
  const server = new McpServer({ name: "ffmpeg-sandbox", version: "0.1.0" });

  server.tool(
    "list_media",
    "List every file in the sandbox workspace with its size in bytes. Call this first to see what you have to work with.",
    {},
    async () => asText({ workspace: "/work", files: listWorkspace() })
  );

  server.tool(
    "probe_media",
    "Inspect a media file with ffprobe: duration, streams, resolution, codecs. Use this before deciding how to edit.",
    { file: z.string().describe("Path relative to the workspace, e.g. 'source.mp4'") },
    async ({ file }) => {
      const result = await runInSandbox("ffprobe", [
        "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        file,
      ]);
      if (!result.ok) return asText({ error: "ffprobe failed", ...result });
      try {
        return asText(JSON.parse(result.stdout));
      } catch {
        return asText(result);
      }
    }
  );

  server.tool(
    "run_ffmpeg",
    "Run ffmpeg inside an isolated container. Pass the arguments as an array, without the leading 'ffmpeg'. Input and output paths are relative to the workspace. No network access: you cannot pass URLs.",
    {
      args: z.array(z.string()).describe(
        "e.g. ['-i','source.mp4','-ss','12','-t','30','-vf','crop=ih*9/16:ih','clip1.mp4']"
      ),
      purpose: z.string().optional().describe("One line on what this command is meant to do"),
    },
    async ({ args, purpose }) => {
      try {
        // -y so a re-render never blocks waiting on an overwrite prompt
        const result = await runInSandbox("ffmpeg", ["-y", "-hide_banner", ...args]);
        return asText({ purpose, command: `ffmpeg -y ${args.join(" ")}`, ...result });
      } catch (err) {
        return asText({ error: String(err.message ?? err), purpose });
      }
    }
  );

  // Arbitrary Python with the workspace mounted read-write can overwrite or delete source
  // media, which the container cannot prevent. Marking it destructive makes the harness stop
  // and show the script for approval before it runs, the same gate the timeline's
  // delete/ripple tools use.
  server.registerTool(
    "run_python",
    {
      title: "Run Python in the sandbox",
      description:
        "Run a short Python script inside the sandbox for analysis or file wrangling. Same isolation as ffmpeg: no network, workspace only. It can write and delete files in the workspace, so it asks for approval first.",
      inputSchema: { code: z.string().describe("Python source to execute") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ code }) => asText(await runInSandbox("python3", ["-c", code], { validatePaths: false }))
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, workspace: WORKSPACE }));

// Stateless transport: a fresh server instance per request keeps this simple
// and avoids session bookkeeping we do not need.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`ffmpeg sandbox MCP on http://localhost:${PORT}/mcp`);
  console.log(`workspace: ${WORKSPACE}`);
  console.log(`image: ${IMAGE}`);
});
