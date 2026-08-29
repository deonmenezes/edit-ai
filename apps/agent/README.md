# @editai/agent

The EditAI timeline, exposed to an agent harness.

This package is two things in one small server:

- **An MCP server** (`POST /mcp`) with 16 tools that read and edit a real video timeline.
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

# 3. register models, the MCP server, the sandbox and the agent
ANTHROPIC_API_KEY=sk-... bun run setup

# 4. the editor
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
| `TRUEFORGE_BASE_URL` | Defaults to `http://localhost:8790`. |
| `EDITAI_AGENT_PORT` | Defaults to `8941`. |

At least one model key is required. With none of them set, `setup` stops and tells you.

## The tools

Every tool validates its input with zod and returns errors to the model as data, so a bad clip id
becomes a correction rather than a failed turn.

| Tool | Kind | What it does |
| --- | --- | --- |
| `get_project` | read | The whole timeline: tracks, clips, media metadata, exports. |
| `list_changes` | read | Recent edits. |
| `transcribe_clip` | read | Speech inside one clip, as timed segments. |
| `find_silences` | read | Silent ranges on the voice track. |
| `detect_beats` | read | Beat timestamps from the music track's tempo. |
| `split_clip` | write | Cut a clip in two, keeping media in sync. |
| `trim_clip` | write | New in/out points. |
| `move_clip` | write | New start time or track. |
| `set_volume` | write | Clip volume. |
| `add_text` | write | A title or caption. |
| `add_captions` | write | Timed captions on the caption track. |
| `undo` | write | Revert the last change. |
| `delete_clip` | **destructive** | Remove a clip. |
| `ripple_delete` | **destructive** | Remove a range from every track and close the gap. |
| `remove_silences` | **destructive** | Ripple-delete every silence over a threshold. |
| `export_project` | approval | Render the timeline to a file. |

Destructive tools are published with MCP's `destructiveHint` annotation. The agent's
`require_approval_for_tools: ["@destructive", "export_project"]` turns that annotation into a
pause: the harness stops the turn, the editor shows the tool and its arguments, and the run only
continues once a person allows or denies it.

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

12 tests over the timeline model: split/trim invariants, ripple-delete arithmetic across tracks,
silence removal, transcript windowing, caption merging, and undo.

## Notes

- The store persists to `data/project.json`, which is gitignored. `POST /project/reset` restores the
  sample timeline.
- `export_project` writes a JSON description of the render rather than encoding video. Wiring it to
  ffmpeg is the obvious next step and does not change the agent-facing contract.
- The MCP SDK infers handler argument types from zod shapes. That inference exhausts the TypeScript
  compiler on a schema set this size, so `tools.ts` registers through a narrow facade and annotates
  each handler's arguments explicitly. See the comment at the top of that file.
