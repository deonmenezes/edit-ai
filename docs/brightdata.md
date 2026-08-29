# Bright Data integration

Connected to TrueForge as an MCP connector: https://mcp.brightdata.com/mcp

Auth: API Key (account API token from Bright Data Settings -> API tokens).
Note: the endpoint advertises OAuth metadata, but the account API token works.

Tools the agent gets: search_engine, search_engine_batch, scrape_as_markdown,
scrape_batch, ask_brightdata_assistant.

## How the agent uses it

Before naming or ordering clips, the agent researches how comparable short-form
videos are titled, then applies those patterns. Live web data feeds the edit
decisions rather than sitting beside them.

Example: for Startup Boston Week footage it scraped conference short-form titles
and extracted recurring structures (number + highlight promise, compressed
recap, access/FOMO, question hook), then titled the clips accordingly.

The agent distinguishes scraped findings from its own suggestions, and says so
when the research fails rather than inventing patterns.
