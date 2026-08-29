# EditAI

AI-powered video editor for the web.

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

An editor where you describe the change and an agent makes it: "remove the silences", "caption
every clip", "cut the intro to three seconds". The agent edits the real timeline through tools, and
anything destructive stops for your approval first.

## How it works

EditAI is built on [TrueForge](https://trueforge.dev), an open-source agent harness. The harness
runs the agent loop; EditAI supplies the domain.

```
  browser                    harness                     domain
┌──────────────┐   HTTP    ┌──────────────┐   MCP    ┌──────────────────┐
│  editor UI   │◄─────────►│  TrueForge   │◄────────►│  @editai/agent   │
│  (apps/web)  │  + SSE    │  agent loop  │          │  16 timeline     │
│              │           │  approvals   │          │  tools           │
│  timeline ◄──┼───────────┼──────────────┼── SSE ───┤  project store   │
└──────────────┘           └──────────────┘          └──────────────────┘
```

The editor never calls a model. It creates a session, streams turn events, renders tool calls and
sub-agent threads, and answers the harness when it pauses. The timeline redraws from the agent
server's event stream, so an edit the agent makes shows up in the UI as it happens.

| Capability | Where it lives |
| --- | --- |
| MCP tools, your own and the catalog's | `apps/agent/src/tools.ts`; `setup.ts` also attaches catalog servers, including OAuth ones (verified against Linear) and keyless web search |
| Human approvals before destructive edits | MCP `destructiveHint` annotations → `require_approval_for_tools` → the approval card in `apps/web/src/components/editor/assistant-panel.tsx` |
| Sub-agents | Enabled on the agent; per-clip fan-out for captioning, rendered as threads in the UI |
| Sessions that survive a reload | `apps/web/src/components/editor/use-assistant.ts` replays turns and re-attaches to a running one |
| Any model provider | `apps/agent/scripts/setup.ts` registers whichever API keys are present, including any OpenAI-compatible endpoint |
| Sandboxed execution | Configured automatically when `DAYTONA_API_KEY` is set |

## Getting started

You need [Bun](https://bun.sh) and Node 22.14+ (for the harness).

```bash
bun install

# 1. the harness
npx @truefoundry/trueforge@latest        # http://localhost:8790

# 2. the timeline tools
cd apps/agent && bun run start           # http://localhost:8941

# 3. wire them together (any one key is enough)
ANTHROPIC_API_KEY=sk-... bun run setup

# 4. the editor
cd ../.. && bun run dev:web              # http://localhost:5173
```

Then ask for an edit: "Remove the silences", "Caption every video clip".

Without the harness running, the editor still loads with a sample timeline; the assistant panel
says it is offline.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19, Vite, Tailwind CSS v4, shadcn/ui
- [TrueForge](https://trueforge.dev) agent harness, [MCP](https://modelcontextprotocol.io) tools
- Cloudflare Workers (via Wrangler), Bun + Turborepo monorepo

## Layout

```
apps/
  web/     the editor: timeline, preview, assistant panel
  agent/   MCP server exposing the timeline, plus the agent definition
```

See [apps/agent/README.md](apps/agent/README.md) for the tool reference and timeline semantics.

## Scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `bun run dev`       | Run every app in dev mode             |
| `bun run dev:web`   | Run only the web app                  |
| `bun run build`     | Build every app                       |
| `bun run deploy`    | Build and deploy to Cloudflare        |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup and guidelines, and open an issue first for anything larger than a bug fix.

## License

[MIT](LICENSE)
