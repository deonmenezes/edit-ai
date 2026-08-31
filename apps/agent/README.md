# @editai/agent

The EditAI timeline, exposed to an agent harness.

This package is two things in one small server:

- **An MCP server** (`POST /mcp`) with 19 tools that read and edit a real video timeline.
- **A live project store** (`GET /project`, `GET /events`) that the web app subscribes to, so
  edits the agent makes appear in the editor as they happen.

The agent loop itself is not here. It runs in [TrueForge](https://trueforge.dev), the open-source
agent harness: model calls, tool routing, approvals, sub-agents, sessions and context management.
This package supplies the domain (a timeline) and the tools; the harness supplies the runtime.

## Quick start

```bash
# 1. the harness (separate terminal, needs Node 22.14+)
npx @truefoundry/trueforge@latest        # http://localhost:8790

# 2. this server
bun install
bun run start                            # http://localhost:8941

# 3. the ffmpeg media workbench (optional, needs Docker; separate terminal)
cd ../../packages/ffmpeg-sandbox
bun run build:image && bun run start     # http://localhost:8931/mcp

# 4. register models, the MCP servers, the sandbox and the agent
ANTHROPIC_API_KEY=sk-... bun run setup

# 5. the editor
cd ../web && bun run dev                 # http://localhost:5173
```

`setup` is idempotent: rerun it after changing `agent.json` or adding a key.

### Environment

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | Registers that provider with every model in the TrueForge catalog. |
| `NVIDIA_API_KEY` | Registers NVIDIA NIM as a custom OpenAI-compatible provider. |
| `OPENAI_COMPATIBLE_BASE_URL` + `_API_KEY` + `_MODELS` (+ `_NAME`) | Registers any other OpenAI-compatible endpoint: vLLM, Ollama, a gateway. |
| `DAYTONA_API_KEY` | Configures the sandbox and enables it on the agent. |
| `EDITAI_MODEL` | Pins the agent's model instead of picking the best configured one. |
| `EDITAI_CONNECTORS` | Extra MCP servers to attach, comma separated. Defaults to `exa` (keyless web search). |
| `<NAME>_MCP_HEADER` | Credential for a header-auth connector, e.g. `GITHUB_MCP_HEADER="Authorization: Bearer ghp_..."`. |
| `FFMPEG_SANDBOX_URL` | Where the ffmpeg workbench serves MCP. Defaults to `http://localhost:8931/mcp`; setup attaches it only when its `/health` answers. |
| `TRUEFORGE_BASE_URL` | Defaults to `http://localhost:8790`. |
| `EDITAI_AGENT_PORT` | Defaults to `8941`. |

At least one model key is required. With none of them set, `setup` stops and tells you.

## The tools

Every tool validates its input with zod and returns errors to the model as data, so a bad clip id
becomes a correction rather than a failed turn.

| Tool | Kind | What it does |
| --- | --- | --- |
| `get_project` | read | The whole timeline: tracks, clips, media metadata, exports. |
| `list_media` | read | Every imported media file: duration, resolution, whether its bytes are on disk. |
| `list_changes` | read | Recent edits. |
| `transcribe_clip` | read | Speech inside one clip, as timed segments. |
| `find_silences` | read | Silent ranges on the voice track. |
| `detect_beats` | read | Beat timestamps from the music track's tempo. |
| `split_clip` | write | Cut a clip in two, keeping media in sync. |
| `trim_clip` | write | New in/out points. |
| `move_clip` | write | New start time or track. |
| `set_volume` | write | Clip volume. |
| `add_clip` | write | Place an imported media file on a track. |
| `add_text` | write | A title or caption. |
| `add_captions` | write | Timed captions on the caption track. |
| `undo` | write | Revert the last change. |
| `delete_clip` | **destructive** | Remove a clip. |
| `ripple_delete` | **destructive** | Remove a range from every track and close the gap. |
| `remove_silences` | **destructive** | Ripple-delete every silence over a threshold. |
| `export_project` | approval | Queue a real render; the editor encodes it with WebCodecs. |
| `get_export` | read | Poll a queued render: progress, then the file and its byte size. |

Destructive tools are published with MCP's `destructiveHint` annotation. The agent's
`require_approval_for_tools: ["@destructive", "export_project"]` turns that annotation into a
pause: the harness stops the turn, the editor shows the tool and its arguments, and the run only
continues once a person allows or denies it.

## Connecting other tools

Beyond the catalog, setup wires in this repo's own media workbench: when
`packages/ffmpeg-sandbox` is running (default `http://localhost:8931/mcp`, override with
`FFMPEG_SANDBOX_URL`), it is registered as the `ffmpeg-sandbox` connector and attached to the
agent with all tools deferred and `@destructive` approval on `run_python`. The `video-editing`
skill routes all raw media work through it. When the server is down, setup skips it with a hint
instead of registering a connector that would fail every call.

`setup.ts` also attaches any server from the TrueForge catalog by name, and handles all three
auth styles:

```bash
EDITAI_CONNECTORS=exa bun run setup                    # keyless, the default
GITHUB_MCP_HEADER="Authorization: Bearer ghp_..." \
  EDITAI_CONNECTORS=exa,github bun run setup           # header auth
EDITAI_CONNECTORS=exa,linear bun run setup             # OAuth
```

OAuth servers use dynamic client registration: nothing to configure here. The first time the
agent reaches for one, the harness registers as a client, the turn pauses with an authorize URL,
and the editor shows a **Connect** button. Verified against Linear.

Extra connectors are attached read-only and deferred, so they cost nothing in context until the
agent actually reaches for them.

## Timeline semantics worth knowing

- **`sourceOffset` keeps media in sync.** Trimming a clip's start moves its offset into the source
  file by the same amount, so the picture does not jump.
- **Ripple delete is the interesting operation.** Removing a range cuts every track, splits any clip
  that straddles the range, and shifts everything after it left. `remove_silences` applies it once
  per silence, from the end backwards so earlier ranges stay valid.
- **Captions merge across clip boundaries.** Fanning captioning out per clip means a sentence that
  straddles a cut is reported twice, clamped to each side; `add_captions` merges those back into one
  caption. This is covered by a test.

## Tests

```bash
bun test
```

43 tests over the timeline model: split/trim invariants, ripple-delete arithmetic across tracks,
silence removal, transcript windowing, caption merging, export lifecycle, and undo.

## Notes

- The store persists to `data/project.json`, which is gitignored. `POST /project/reset` restores the
  sample timeline.
- `export_project` queues a real render. The editor claims the job, encodes it with WebCodecs,
  streams the chunks back, and the file lands in `data/exports/`; the agent polls `get_export`
  for progress and the finished byte size.
- The MCP SDK infers handler argument types from zod shapes. That inference exhausts the TypeScript
  compiler on a schema set this size, so `tools.ts` registers through a narrow facade and annotates
  each handler's arguments explicitly. See the comment at the top of that file.
