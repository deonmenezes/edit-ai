<div align="center">

# EditAI

**An AI harness for video editing. You describe the edit; an agent makes it on your real timeline.**

[**Live site**](https://editai-agent.vercel.app) &middot;
[Quick start](#getting-started) &middot;
[The 19 tools](#the-19-timeline-tools) &middot;
[Add your own MCP](#reaching-past-the-timeline) &middot;
[Review evidence](#code-review-evidence-qodo)

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)
[![Built on TrueForge](https://img.shields.io/badge/harness-TrueForge-7c5cff?style=flat)](https://trueforge.dev)
[![MCP](https://img.shields.io/badge/protocol-MCP-7c5cff?style=flat)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-71%20passing-3aa39b?style=flat)](#tests)
[![Reviewed by Qodo](https://img.shields.io/badge/reviewed%20by-Qodo-e0a63b?style=flat)](#code-review-evidence-qodo)

</div>

---

Say "remove the silences" or "caption every clip", and an agent makes the edit on your real
timeline: it reads the project, decides which cuts to make, and applies them. Anything destructive
stops and asks you first.

The tedious parts of editing are the ones a machine should do. Cutting dead air out of a
twenty-minute take is thirty minutes of scrubbing; here it is one sentence and one approval click.
Captioning every clip means transcribing each one by hand; here a sub-agent handles each clip in
parallel and the captions land on their own track, timed. The agent does the mechanical work, and
you keep the decisions: it proposes, you approve, and every edit is undoable.

**Three layers, one conversation.** Depending on what you ask for, the same agent drives your own
editing UI, the editor in this repo, or the ffmpeg encode underneath it. You do not choose the
layer; the request does.

---

## Watch it work

The one operation worth showing end to end, because the numbers are checkable:

```
you    ▸ remove the silences

agent  → find_silences(min_duration: 0.5, track_id: "a1")
       ← 3 ranges: 3.2-4.1, 9.6-10.4, 16.8-18.0   (2.9s total)

       "Three silent ranges, 2.9s in all. This will cut every track. Remove them?"

you    ▸ [Approve]

agent  → remove_silences(min_duration: 0.5)
       ← duration 24.0s → 21.1s, every track cut, gaps closed

       "Cut 2.9s of dead air across every track. Say undo to put it back."
```

24.0 down to 21.1 is exactly the 2.9 seconds of silence, with picture, sound and captions still in
sync. There is an animated version of this on the [live site](https://editai-agent.vercel.app).

## What you can ask for

| Ask | What the agent actually does | Tools |
| --- | --- | --- |
| *"Remove the silences"* | Finds every silent range on the voice track, tells you what will go, then ripple-deletes it across all tracks, closing the gaps. Verified: 24s → 21.1s. | `find_silences` → `remove_silences` |
| *"Caption every video clip"* | Fans out one sub-agent per clip to transcribe in parallel, merges the results (including sentences that straddle a cut), and lays timed captions on their own track. | `transcribe_clip` ×N → `add_captions` |
| *"Cut this to the beat"* | Reads the tempo off the music track and splits on the beat grid. Both halves stay frame-accurate. | `detect_beats` → `split_clip` |
| *"Trim the intro to 3 seconds"* | Trims the clip and moves its source offset by the same amount, so the picture does not jump. | `trim_clip` |
| *"Duck the music under the voiceover"* | Sets clip volume where the voice track is speaking and restores it where it is not. | `get_project` → `set_volume` |
| *"Grade it warmer and add grain"* | Writes the ffmpeg filter graph, runs it in the media sandbox, then probes the output to confirm it matches the intent. | `probe_media` → `run_ffmpeg` |
| *"Kill the room tone"* | Denoises the voice track in the sandbox, leaving the original file untouched beside it. | `run_ffmpeg` (`afftdn`) |
| *"Put their logo in the corner"* | Searches the live web through Bright Data, scrapes the asset, and brings it into the project. | `search_engine` → `scrape_as_markdown` |
| *"Export it at 1080p"* | Renders, after you approve. | `export_project` |

Motion graphics, transitions and animation work the same way: either as an ffmpeg filter graph in
the media sandbox, or by attaching an MCP server that specialises in them. See
[Reaching past the timeline](#reaching-past-the-timeline).

## How it works

EditAI is built on [TrueForge](https://trueforge.dev), TrueFoundry's open-source agent harness. The
harness runs the agent loop; EditAI supplies the domain.

```
  browser                    harness                     domain
┌──────────────┐   HTTP    ┌──────────────┐   MCP    ┌──────────────────┐
│  editor UI   │◄─────────►│  TrueForge   │◄────────►│  @editai/agent   │
│  (apps/web)  │  + SSE    │  agent loop  │          │  19 timeline     │
│  decode      │           │  approvals   │          │  tools           │
│  composite   │           │              │          │  project store   │
│  encode      │           │              │          │  media on disk   │
│  timeline ◄──┼───────────┼──────────────┼── SSE ───┤  render queue    │
└──────┬───────┘           └──────┬───────┘          └────────┬─────────┘
       │                          │ MCP                       │
       │  media bytes + rendered mp4 (HTTP)                    │
       └───────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼              ▼
            ┌──────────────┐ ┌─────────┐ ┌──────────────┐
            │ ffmpeg       │ │ bright- │ │ anything     │
            │ sandbox      │ │ data    │ │ else that    │
            │ (container)  │ │ (web)   │ │ speaks MCP   │
            └──────────────┘ └─────────┘ └──────────────┘
```

**The editor is the renderer.** Decoding and encoding happen in the browser through
[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), wrapped by
[mediabunny](https://mediabunny.dev): the agent queues a render, the editor claims it, composites
every frame onto a canvas, muxes it, and posts the file back. The agent then sees a real path and a
real byte count, which is what lets it check its own work.

The engine follows [OpenCut](https://github.com/opencut-app/opencut-classic), whose renderer this is
ported from: the same frame cache (a forward iterator with a prefetched next frame, falling back to a
real seek only when the target is behind the decoder or too far ahead of it) and the same
`Output`/`CanvasSource`/`AudioBufferSource` muxing. The one deliberate departure is compositing in
Canvas2D rather than OpenCut's wgpu compositor: EditAI stacks video, text and audio with no effects
or masks, which 2D covers exactly, and it drops a wasm dependency. Effects would need the real thing.

The editor never calls a model. It creates a session, streams turn events, renders tool calls and
sub-agent threads, and answers the harness when it pauses. The timeline redraws from the agent
server's event stream, so an edit the agent makes shows up in the UI as it happens.

| Capability | Where it lives |
| --- | --- |
| MCP tools, your own and the catalog's | `apps/agent/src/tools.ts`; `setup.ts` also attaches catalog servers, including OAuth ones (verified against Linear) and keyless web search |
| Human approvals before destructive edits | MCP `destructiveHint` annotations → `require_approval_for_tools` → the approval card in `apps/web/src/components/editor/assistant-panel.tsx` |
| Sub-agents | Enabled on the agent; per-clip fan-out for captioning, rendered as threads in the UI |
| Sessions that survive a reload | `apps/web/src/components/editor/use-assistant.ts` replays turns and re-attaches to a running one |
| Live web research | `bright-data` connector: `search_engine` and `scrape_as_markdown`, attached deferred so it costs no context until a task needs it (see [docs/brightdata.md](docs/brightdata.md)) |
| Any model provider | `apps/agent/scripts/setup.ts` registers whichever API keys are present, including any OpenAI-compatible endpoint |
| Sandboxed execution | Two layers: the harness sandbox (Daytona) for general code, and `packages/ffmpeg-sandbox` for media work |
| Domain know-how | `skills/video-editing/SKILL.md`, loaded by the agent whenever a task touches ffmpeg |

## The 19 timeline tools

The timeline is exposed to the agent as **19 [MCP](https://modelcontextprotocol.io) tools**, not as
a prompt describing a timeline. The agent calls real functions against real state.

| Tool | Kind | Arguments | What it does |
| --- | --- | --- | --- |
| `get_project` | read | | Tracks, clips, media metadata, exports. Call it first; ids change after edits. |
| `list_media` | read | | Imported files with their measured duration, resolution and frame rate, and whether the bytes are on disk. |
| `list_changes` | read | `limit` | Recent edits, oldest first. |
| `transcribe_clip` | read | `clip_id` | Speech inside one clip, as timed segments in timeline seconds. |
| `find_silences` | read | `min_duration`, `track_id` | Silent ranges measured from the decoded audio. Preview only. |
| `detect_beats` | read | `track_id` | Beat timestamps from the tempo estimated off the track's onsets. |
| `split_clip` | write | `clip_id`, `at` | Cuts a clip in two. Returns both halves. |
| `trim_clip` | write | `clip_id`, `start?`, `end?` | New in/out points, keeping media in sync via `sourceOffset`. |
| `move_clip` | write | `clip_id`, `start?`, `track_id?` | New start time, or another track of the same kind. |
| `set_volume` | write | `clip_id`, `volume` | Clip volume, 0 to 100. |
| `add_clip` | write | `name`, `track_id`, `start`, `duration?`, `source_offset?` | Places imported media on a video or audio track. |
| `add_text` | write | `text`, `start`, `duration`, `track_id` | A title or caption on a text track. |
| `add_captions` | write | `segments[]`, `track_label` | Timed captions on the captions track, creating it if needed. |
| `undo` | write | | Reverts the most recent change. |
| `delete_clip` | **destructive** | `clip_id` | Removes a clip, leaving a gap. |
| `ripple_delete` | **destructive** | `start`, `end` | Removes a range from every track and closes the gap. |
| `remove_silences` | **destructive** | `min_duration`, `track_id` | Ripple-deletes every silence over the threshold. |
| `export_project` | **approval** | `format`, `resolution` | Queues a real render. Refuses if any clip's media is missing. |
| `get_export` | read | `export_id` | Render status: pending, rendering with progress, done with the file and its byte size, or failed with the error. |

Every tool validates its input with zod and returns errors to the model **as data**, so a stale clip
id becomes a correction the agent recovers from rather than a failed turn.

The four gated tools are published with MCP's `destructiveHint` annotation, and the agent declares
`require_approval_for_tools: ["@destructive", "export_project"]`. That turns the annotation into a
pause: the harness stops the turn, the editor shows the tool and its arguments, and the run only
continues once a person allows or denies it.

Three semantics worth knowing before you read the code:

- **`sourceOffset` keeps media in sync.** Trimming a clip's start moves its offset into the source
  file by the same amount, so the picture does not jump.
- **Ripple delete is the interesting operation.** Removing a range cuts every track, splits any clip
  straddling the range, and shifts everything after it left. `remove_silences` applies it once per
  silence, from the end backwards, so earlier ranges stay valid.
- **Captions merge across clip boundaries.** Fanning captioning out per clip means a sentence
  spanning a cut is reported twice, clamped to each side; `add_captions` merges those back into one.

See [apps/agent/README.md](apps/agent/README.md) for the full tool reference and timeline semantics.

## Reaching past the timeline

Because everything is MCP, the same agent can reach anything else that speaks MCP: web search, a
motion-graphics server, your issue tracker, an internal API you wrap yourself. **Adding a capability
is a name in a list and a restart, not a release.**

```bash
# keyless, the default
EDITAI_CONNECTORS=exa bun run setup

# header auth
BRIGHT_DATA_MCP_HEADER="Authorization: Bearer <token>" \
  EDITAI_CONNECTORS=exa,bright-data bun run setup

# OAuth: dynamic client registration, nothing to configure here.
# The first time the agent reaches for it, the turn pauses with an authorize
# URL and the editor shows a Connect button. Verified against Linear.
EDITAI_CONNECTORS=exa,linear bun run setup

# your own server, attached the same way
EDITAI_CONNECTORS=exa,bright-data,motion-graphics bun run setup
```

Extra connectors attach **read-only and deferred**, so a connector you rarely use costs nothing in
context until the agent actually reaches for it. The tools go live on the agent's next turn, in the
same conversation.

### Bright Data

**Bright Data** is the one wired up and verified: `search_engine`, `search_engine_batch`,
`scrape_as_markdown`, `scrape_batch` and `ask_brightdata_assistant`, reported by the harness as
`auth_status: authenticated`.

It attaches by name like any catalog connector, `EDITAI_CONNECTORS=exa,bright-data`, with its token
in `BRIGHT_DATA_MCP_HEADER`. With that variable unset, setup **skips** the connector rather than
registering it with an empty header, because a registered connector whose every call fails at run
time is worse than an absent one.

What it is actually for is research that changes an edit, not decoration beside it:

- **Naming and ordering clips.** Before titling, the agent researches how comparable short-form
  videos are titled and applies the structures it finds. On Startup Boston Week footage it scraped
  conference short-form titles, extracted four recurring shapes (number + highlight promise,
  compressed recap, access/FOMO, question hook), and titled the clips to match.
- **Fetching real assets.** "Put their logo in the corner" gets the current logo rather than a
  model's memory of one.

Two properties worth stating, because they are what make live web data safe to act on:

- **Scraped text is evidence, never instruction.** The harness wraps each payload in a notice
  marking it untrusted external data, so a page cannot talk the agent into a tool call.
- **A layout change costs quality, not correctness.** `scrape_as_markdown` returns rendered text
  rather than a selector path, and the agent treats an empty or truncated scrape as a failed
  research step it reports, rather than titling clips from half a page.

Setup details, the auth gotcha and a verified run are in [docs/brightdata.md](docs/brightdata.md).

## Where the code runs

Generated code never runs on the host. Two layers cover the two kinds of work.

**Harness sandbox (Daytona).** `setup.ts` registers the provider when `DAYTONA_API_KEY` is present,
and the agent's `exec` tool then runs in a remote sandbox. Verified end to end against the running
harness:

```
sandbox.created   sandbox_id: v1:daytona:default.e17058ee-...
exec              python3 -c "print(sum(int(x)**2 for x in range(1,101)))"
tool.response     {"success":true,"response":{"exitCode":0,"result":"338350\n"}}
```

**Media sandbox (`packages/ffmpeg-sandbox`).** ffmpeg and ffprobe are not safe to point at
agent-supplied arguments on the host, so every invocation runs in a throwaway container:
`--network none`, capped memory and CPU, `--pids-limit 256`, a non-root user, a single mounted
workspace, and a hard timeout. It exposes four tools:

| Tool | What it does |
| --- | --- |
| `list_media` | What is in the workspace |
| `probe_media` | Duration, resolution, codecs, fps |
| `run_ffmpeg` | Runs ffmpeg with an argument array |
| `run_python` | Glue work, parsing, arithmetic |

`run_python` is annotated `destructiveHint: true`, so the harness shows the script and waits for
approval before it runs: a script with the workspace mounted read-write can delete the source media,
and the container is not a defence against that.

The split is deliberate. The harness sandbox is for computation the agent should not estimate; the
media sandbox is for work that must reach the media files.

## Getting started

You need [Bun](https://bun.sh) and Node 22.14+ (for the harness). Docker is needed only for the
media sandbox.

```bash
git clone https://github.com/deonmenezes/edit-ai.git
cd edit-ai
bun install

# 1. the harness (separate terminal)
npx @truefoundry/trueforge@latest        # http://localhost:8790

# 2. the timeline tools
cd apps/agent && bun run start           # http://localhost:8941

# 3. wire them together (any one model key is enough)
ANTHROPIC_API_KEY=sk-... bun run setup

# 4. the editor
cd ../.. && bun run dev:web              # http://localhost:5173
```

Then bring in footage. Drop any video or audio file onto the editor, or use **Import** in the Media
panel: the browser measures it with WebCodecs, uploads the bytes to the agent, and analyzes the audio
so silences, the waveform and tempo come from your file. No footage handy?

```bash
cd apps/agent && bun scripts/make-samples.ts   # writes data/samples with ffmpeg
```

Then ask for an edit: "Remove the silences", "Caption every video clip", "Export it at 1080p". The
export lands in `apps/agent/data/exports` as a real mp4, and the Export button turns into a download
link once it does.

Without the harness running, the editor still loads with a sample timeline; the assistant panel
says it is offline. That sample timeline names media it has no bytes for, so the preview says so
and export refuses until real files are imported. `setup` is idempotent, so rerun it after changing `agent.json` or adding a key.

### Environment

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | Registers that provider with every model in the TrueForge catalog. |
| `NVIDIA_API_KEY` | Registers NVIDIA NIM as a custom OpenAI-compatible provider. |
| `OPENAI_COMPATIBLE_BASE_URL` + `_API_KEY` + `_MODELS` (+ `_NAME`) | Registers any other OpenAI-compatible endpoint: vLLM, Ollama, a gateway. |
| `DAYTONA_API_KEY` | Configures the harness sandbox and enables it on the agent. |
| `EDITAI_MODEL` | Pins the agent's model instead of picking the best configured one. |
| `EDITAI_CONNECTORS` | Extra MCP servers to attach, comma separated. Defaults to `exa`. |
| `<NAME>_MCP_HEADER` | Credential for a header-auth connector, e.g. `BRIGHT_DATA_MCP_HEADER="Authorization: Bearer ..."`. |
| `TRUEFORGE_BASE_URL` | Defaults to `http://localhost:8790`. |
| `EDITAI_AGENT_PORT` | Defaults to `8941`. |

At least one model key is required. With none set, `setup` stops and tells you. `setup` refuses to
POST keys over plaintext HTTP to anything but localhost.

Copy [`apps/agent/.env.example`](apps/agent/.env.example) to `apps/agent/.env` to start from a
documented set.

## Layout

```
apps/
  web/                  the editor: timeline, preview, assistant panel
    src/engine/         decode, composite, encode: the renderer, ported from OpenCut
      media.ts          probing and upload over range-requested HTTP
      video-cache.ts    the frame cache: forward iterator, prefetch, seek fallback
      audio.ts          decode, timeline mixdown, silence/peak/tempo analysis
      compositor.ts     one frame of the timeline, drawn in Canvas2D
      exporter.ts       mediabunny mux: CanvasSource + AudioBufferSource
  agent/                MCP server exposing the timeline, plus the agent definition
    src/tools.ts        the 19 tools
    src/project.ts      the timeline model: split, trim, ripple delete, captions, renders
    src/media.ts        media names, mime types, streamed uploads
    scripts/setup.ts    registers models, connectors, sandbox and the agent
    scripts/make-samples.ts  generates real sample footage with ffmpeg
packages/
  ffmpeg-sandbox/       containerised ffmpeg/ffprobe/python MCP server
skills/
  video-editing/        ffmpeg recipes and rules the agent loads on demand
docs/
  brightdata.md         connector setup and verification
site/                   the landing page (static, deployed to Vercel)
tests/                  the Qodo verdict parser's fixtures and tests
.github/workflows/      CI, and the Qodo merge gate
```

## Scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `bun run dev`       | Run every app in dev mode             |
| `bun run dev:web`   | Run only the web app                  |
| `bun run build`     | Build every app                       |
| `bun run test`      | Run the Bun test suites               |
| `bun run deploy`    | Build and deploy to Cloudflare        |

## Tests

**71 tests**, all passing.

| Suite | Count | Covers |
| --- | --- | --- |
| `apps/agent/test/project.test.ts` | 43 | Split and trim invariants, ripple-delete arithmetic across tracks, silence removal, transcript windowing, caption merging, undo, media registration and clip placement bounds, and the render lifecycle: one claim per job, lease expiry so an abandoned render is retryable, the queued-timeline snapshot, a finished render that a late report cannot reopen, HTTP suffix-range parsing, and the path-escape guards on media names and render targets. |
| `apps/web/src/engine/audio.test.ts` | 10 | Silence detection against injected gaps and sub-threshold room tone, the peak envelope, and tempo recovered from a synthetic click track. |
| `apps/web/src/engine/compositor.test.ts` | 8 | Which clips are live at a time, source-time mapping through `sourceOffset`, and which clips reach the audio mix. |
| `apps/web/.../transcript.test.ts` | 6 | Transcript windowing and caption rendering in the editor. |
| `tests/test_qodo_verdict.py` | 8 | The merge gate's verdict parser, against the real Qodo comment bodies that broke it. |

```bash
bun run test                    # the Bun suites (agent + web)
cd apps/agent && bun test       # the timeline model
python3 -m pytest tests/        # the Qodo verdict parser
```

## Code review evidence (Qodo)

Every pull request here is reviewed by [Qodo](https://qodo.ai). **Eight findings across three
reviews: seven were real and are fixed, one was checked and rejected with a proof.**

### The merge gate

Qodo posts its verdict as an issue comment. It publishes no check run, no commit status and no
approving review, so GitHub's own auto-merge has nothing to gate on.
[`.github/workflows/qodo-automerge.yml`](.github/workflows/qodo-automerge.yml) is that missing gate.

It listens for edited comments as well as created ones, because Qodo posts a placeholder and then
edits the verdict into that same comment: a gate watching only for new comments never sees a verdict
at all. On an edited event `comment.user` is still the bot even when a person did the editing, so
the sender is checked too.

It fails closed in every direction, because the first draft did not and Qodo said so:

- It reads only the **structured counter chips**, never the prose. Qodo quotes findings and diff
  hunks verbatim, so the words "no issues found" appear inside reviews that are *not* clean, and any
  substring test on the comment body is forgeable by the pull request's own content.
- It **binds the verdict to the commit** Qodo footers in the comment and refuses to merge when that
  is no longer the head, since a review applies to one revision and `issue_comment` runs give a job
  no link to the pull request head.
- It treats a **failure to read check state as an error**, not as an absence of failures.
- It merges with **`--match-head-commit`**, so a push racing the merge is rejected by GitHub instead
  of slipping in.

### PR #3, first review

[PR #3](https://github.com/deonmenezes/edit-ai/pull/3) raised three issues. All three were real and
all three are fixed:

1. **Duplicate clip ids after repeated ripple deletes** (`apps/agent/src/project.ts`). The
   right-hand half of a split clip took the id `${c.id}r`, so a clip cut more than once produced the
   same id twice. Reproduced on the sample project: `removeSilences` left three clips sharing `c6r`
   and three sharing `c7r`, which breaks clip lookup, deletion and React keys. Ids are now allocated
   from the set of ids in use. Covered by three regression tests.
2. **Export announced before the file existed.** `exportProject` committed the record, which
   notifies SSE subscribers synchronously, and only then wrote the file. The write now happens first.
3. **The session-restore effect leaked its stream on unmount**, calling `setState` on a gone
   component and leaving the connection open. Its cleanup now aborts the controller.

The first finding is the one that mattered: the test suite had missed it, because the existing
ripple-delete test asserted the buggy `c1r` id as if it were correct.

### PR #3, follow-up review

A second review of the updated PR raised three more. Two were real and fixed; one was checked and
rejected:

- **Real:** a header-auth connector whose env var had no `: value` registered an empty header and
  failed silently. It now reports the expected format instead.
- **Real:** `setup.ts` POSTs API keys to the harness, so it now refuses to do that over plaintext
  HTTP to anything but localhost.
- **False positive:** the reviewer called the source-media bound in `trimClip`
  (`end - (c.start - c.sourceOffset)`) wrong and predicted a clip could be extended to 28s instead of
  18s. The expression expands to `c.sourceOffset + (end - c.start)`, which is the correct source
  time, and the code accepts exactly up to the limit and rejects one frame past it. Two tests now pin
  that boundary so the correct form is not "fixed" into a broken one later.

### PR #2 review

[PR #2](https://github.com/deonmenezes/edit-ai/pull/2) raised two, both real and both fixed:

- **`run_python` could delete the source media.** The tool passed agent-supplied code straight to
  `python3 -c`, and the argument guard could not catch it: `import shutil; shutil.rmtree('/work')`
  contains no `..` and no leading `/`, so it passed. The container is no defence either, since the
  workspace is exactly what it is meant to reach. The tool is now registered with
  `destructiveHint: true`, so the harness stops and shows the script for approval first, the same
  gate the timeline's `delete_clip` and `ripple_delete` use.
- **The path guard rejected valid code.** Scanning a Python source string for `..` or a URL rejected
  correct programs without adding a boundary. Path validation now applies only to path-like
  arguments; for code payloads the container is the boundary.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19, Vite, Tailwind CSS v4, shadcn/ui
- [TrueForge](https://trueforge.dev) agent harness, [MCP](https://modelcontextprotocol.io) tools
- [mediabunny](https://mediabunny.dev) over WebCodecs for decode, mux and encode, with the frame
  cache and export pipeline ported from [OpenCut](https://github.com/opencut-app/opencut-classic)
- Cloudflare Workers (via Wrangler), Bun + Turborepo monorepo
- Landing page: hand-written static HTML in `site/`, deployed to Vercel

## Known limits

Worth stating plainly, because the demo does not make them obvious:

- **Transcripts are still fixtures.** Silences, the waveform and tempo are now measured from the
  decoded audio, but `transcribe_clip` reads transcript segments stored on the media rather than
  running ASR. Wiring a real recognizer in is the next gap to close.
- **Rendering needs the editor open.** The agent queues a render and the browser performs it, so
  `export_project` from a headless session waits for a page to claim the job. A claim carries a
  60-second lease, so a tab that closes mid-render releases the job rather than stranding it, but
  something still has to pick it up. A server-side ffmpeg worker consuming the same queue would fix
  it without changing any tool signature.
- **Compositing is Canvas2D.** Video, text and audio composite correctly; effects, transitions,
  masks and blend modes have nowhere to live. Those need OpenCut's wgpu compositor, not this one.
- **Codecs are the browser's.** Import refuses anything Chrome cannot decode, and mp4 audio falls
  back to Opus where AAC encoding is unavailable.
- Motion graphics have no dedicated timeline tool yet. Today they go through the ffmpeg sandbox or
  an attached MCP server.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup and
guidelines, and open an issue first for anything larger than a bug fix. Every PR is reviewed by Qodo
before it can merge.

## License

[MIT](LICENSE)
