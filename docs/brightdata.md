# Bright Data integration

Attached to TrueForge as a catalog MCP connector: https://mcp.brightdata.com/mcp

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
