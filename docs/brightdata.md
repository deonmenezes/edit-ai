# Bright Data integration

Available as a TrueForge catalog MCP connector: https://mcp.brightdata.com/mcp

**Status: attached and authenticated.** Verified against the running harness,
where `bright-data` reports `auth_status.status: "authenticated"` and its five
tools reach the agent. It is header auth, so a clone still needs its own token:
setup skips the connector when `BRIGHT_DATA_MCP_HEADER` is unset, leaving `exa`
as the only research connector. Check rather than assume:

```bash
curl -s localhost:8790/api/v1/settings/mcp-servers | jq '.data[] | {name, auth_status}'
```

Auth: API Key (account API token from Bright Data Settings -> API tokens).
Note: the endpoint advertises OAuth metadata, but the account API token works.

Tools the agent gets: search_engine, search_engine_batch, scrape_as_markdown,
scrape_batch, ask_brightdata_assistant.

## Setup

`bright-data` is in the TrueForge catalog, so it attaches by name through the
same `EDITAI_CONNECTORS` path every other catalog server uses. It is header
auth, so it needs its token in the environment or setup skips it:

```bash
export BRIGHT_DATA_MCP_HEADER="Authorization: Bearer <your-api-token>"
EDITAI_CONNECTORS=exa,bright-data bun run setup
```

Verify it landed, and that the token was accepted rather than merely stored:

```bash
curl -s localhost:8790/api/v1/settings/mcp-servers | jq '.data[] | {name, auth_status}'
```

`bright-data` should report `auth_status.status: "ok"`. A status of
`auth_required` means the header was missing or rejected: the connector is
registered but every tool call will fail at run time.

Like the other extra connectors it attaches read-only and deferred, so it costs
no context until the agent reaches for it.

## How the agent uses it

Before naming or ordering clips, the agent researches how comparable short-form
videos are titled, then applies those patterns. Live web data feeds the edit
decisions rather than sitting beside them.

Example: for Startup Boston Week footage it scraped conference short-form titles
and extracted recurring structures (number + highlight promise, compressed
recap, access/FOMO, question hook), then titled the clips accordingly.

The agent distinguishes scraped findings from its own suggestions, and says so
when the research fails rather than inventing patterns.

## When a site changes shape

`scrape_as_markdown` returns rendered text rather than a fixed selector path, so
a layout change degrades the result instead of breaking the call. The agent
treats an empty or obviously truncated scrape as a failed research step and says
the research failed, rather than titling clips from a half-scraped page. That is
the property worth keeping: a site that changes shape costs quality, never
correctness.

## Verified run

The agent reached for it unprompted by any tool preloading, because the
connector attaches deferred: it discovers the tools only when a task needs
research, so they cost no context until then.

```
list_tools      {"mcp_server":"bright-data"}
                -> ask_brightdata_assistant, search_engine, scrape_as_markdown,
                   search_engine_batch, scrape_batch
get_tool_info   {"tool_name":"search_engine","mcp_server":"bright-data"}
call_tool       {"tool_name":"search_engine",
                 "input":{"query":"best short form video hooks 2026"}}
                -> live SERP results
```

The harness wraps the scraped payload in a security notice marking it untrusted
external data rather than instructions, so a page cannot talk the agent into
running a tool call. Scraped text is evidence for a titling decision, never a
command.
