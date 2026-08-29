# EditAI

**An AI video editor you talk to.** Say "remove the silences" or "caption every clip", and an agent
makes the edit on your real timeline: it reads the project, decides which cuts to make, and applies
them. Anything destructive stops and asks you first.

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

The tedious parts of editing are the ones a machine should do. Cutting dead air out of a
twenty-minute take is thirty minutes of scrubbing; here it is one sentence and one approval click.
Captioning every clip means transcribing each one by hand; here a sub-agent handles each clip in
parallel and the captions land on their own track, timed. The agent does the mechanical work, and
you keep the decisions: it proposes, you approve, and every edit is undoable.

### What it can do today

| Ask for this | What the agent does |
| --- | --- |
| *"Remove the silences"* | Finds every silent range on the voice track and ripple-deletes it across all tracks, closing the gaps. Verified: 24s → 21.1s, exactly the 2.9s of silence. |
| *"Caption every video clip"* | Fans out one sub-agent per clip to transcribe in parallel, merges the results, and lays timed captions on a new track. |
| *"Cut the intro to 3 seconds"* | Trims the clip, keeping the media in sync by moving its source offset. |
| *"Duck the music under the voiceover"* | Sets clip volume. |
| *"Split this at 15 seconds"* | Cuts a clip in two, both halves still frame-accurate. |
| *"Export it at 1080p"* | Renders, after you approve. |

### The agent tools

The timeline is exposed to the agent as **16 [MCP](https://modelcontextprotocol.io) tools**, not as
a prompt describing a timeline. The agent calls real functions against real state:

- **Read:** `get_project`, `transcribe_clip`, `find_silences`, `detect_beats`, `list_changes`
- **Write:** `split_clip`, `trim_clip`, `move_clip`, `set_volume`, `add_text`, `add_captions`, `undo`
- **Destructive:** `delete_clip`, `ripple_delete`, `remove_silences`
- **Gated:** `export_project`

Every tool validates its input and returns errors to the model as data, so a stale clip id becomes
a correction the agent recovers from rather than a failed turn. The destructive four are published
with MCP's `destructiveHint` annotation, which is what makes the harness stop and ask you before
they run.

Because it is MCP, the same agent can reach anything else that speaks MCP: web search, your issue
tracker, an internal API you wrap yourself. Connectors attach by name and authorize in chat.

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
| Live web research | `bright-data` connector: `search_engine` and `scrape_as_markdown`, attached deferred so it costs no context until a task needs it (see [docs/brightdata.md](docs/brightdata.md)) |
| Any model provider | `apps/agent/scripts/setup.ts` registers whichever API keys are present, including any OpenAI-compatible endpoint |
| Sandboxed execution | Two layers: the harness sandbox (Daytona, configured automatically when `DAYTONA_API_KEY` is set) for general code, and `packages/ffmpeg-sandbox` for media work |

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

## Sandboxed execution

Generated code never runs on the host. Two layers cover the two kinds of work.

**Harness sandbox (Daytona).** `setup.ts` registers the provider when
`DAYTONA_API_KEY` is present, and the agent's `exec` tool then runs in a remote
sandbox. Verified end to end against the running harness:

```
sandbox.created   sandbox_id: v1:daytona:default.e17058ee-...
exec              python3 -c "print(sum(int(x)**2 for x in range(1,101)))"
tool.response     {"success":true,"response":{"exitCode":0,"result":"338350\n"}}
```

**Media sandbox (`packages/ffmpeg-sandbox`).** ffmpeg and ffprobe are not safe to
point at agent-supplied arguments on the host, so every invocation runs in a
throwaway container: `--network none`, capped memory and CPU, `--pids-limit 256`,
a non-root user, a single mounted workspace, and a hard timeout. `run_python`
there is annotated `destructiveHint: true`, so the harness shows the script and
waits for approval before it runs, because a script with the workspace mounted
read-write can delete the source media and the container is not a defence
against that.

The split is deliberate: the harness sandbox is for computation the agent should
not estimate, and the media sandbox is for work that must reach the media files.

## Qodo Code Review Evidence

### Merging on the review

Qodo posts its verdict as an issue comment. It publishes no check run, no commit
status and no approving review, so GitHub's own auto-merge has nothing to gate
on. `.github/workflows/qodo-automerge.yml` is that missing gate: it reads the
verdict Qodo actually emits and merges only when the review is clean, the build
is green and the branch is mergeable.

It refuses to merge on anything it cannot read. A body that matches neither the
all-clear nor three zero counters counts as not clean, so a parsing change on
Qodo's side stalls the merge instead of waving it through.

Every pull request below was reviewed by Qodo before it merged:

| PR | What it added | Qodo reviews | Findings |
| --- | --- | --- | --- |
| [#2](https://github.com/deonmenezes/edit-ai/pull/2) | ffmpeg sandbox MCP server and video-editing skill | 1 | 2 real, both fixed |
| [#3](https://github.com/deonmenezes/edit-ai/pull/3) | EditAI on the TrueForge agent harness | 2 | 6 total: 4 fixed, 1 retracted, 1 rejected with evidence |
| [#9](https://github.com/deonmenezes/edit-ai/pull/9) | Sandbox documentation and verified-run evidence | 1 | 0 bugs, 0 rule violations, 0 requirement gaps |

Reviews on #2 and #3 were run through Qodo Merge before the Qodo GitHub App was
connected, so they appear under the repository owner's account. #9 was reviewed
by the app itself and is posted by `qodo-code-review[bot]`, which is the form
every later PR takes.

### PR #3, first review

[PR #3](https://github.com/deonmenezes/edit-ai/pull/3) was reviewed with Qodo Merge, which raised
three issues. All three were real and all three are fixed in the PR:

1. **Duplicate clip ids after repeated ripple deletes** (`apps/agent/src/project.ts`). The
   right-hand half of a split clip took the id `${c.id}r`, so a clip cut more than once produced
   the same id twice. Reproduced on the sample project: `removeSilences` left three clips sharing
   `c6r` and three sharing `c7r`, which breaks clip lookup, deletion and React keys. Ids are now
   allocated from the set of ids in use. Covered by three regression tests.
2. **Export announced before the file existed.** `exportProject` committed the record, which
   notifies SSE subscribers synchronously, and only then wrote the file. The write now happens
   first.
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
  (`end - (c.start - c.sourceOffset)`) wrong and predicted a clip could be extended to 28s instead
  of 18s. The expression expands to `c.sourceOffset + (end - c.start)`, which is the correct source
  time, and the code accepts exactly up to the limit and rejects one frame past it. Two tests now
  pin that boundary so the correct form is not "fixed" into a broken one later.

### PR #2 review

[PR #2](https://github.com/deonmenezes/edit-ai/pull/2) raised two, both real and both fixed:

- **`run_python` could delete the source media.** The tool passed agent-supplied code straight to
  `python3 -c`, and the argument guard could not catch it: `import shutil; shutil.rmtree('/work')`
  contains no `..` and no leading `/`, so it passed. The container is no defence either, since the
  workspace is exactly what it is meant to reach. The tool is now registered with
  `destructiveHint: true`, so the harness stops and shows the script for approval first, the same
  gate the timeline's `delete_clip` and `ripple_delete` use.
- **The path guard rejected valid code.** Scanning a Python source string for `..` or a URL
  rejected correct programs without adding a boundary. Path validation now applies only to
  path-like arguments; for code payloads the container is the boundary.


## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup and guidelines, and open an issue first for anything larger than a bug fix.

## License

[MIT](LICENSE)
