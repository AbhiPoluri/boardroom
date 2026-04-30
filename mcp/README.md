# boardroom-mcp

MCP server for **Boardroom** — control your AI agent fleet from Claude Code, Cursor, or any MCP-compatible client.

Once installed, you can talk to Boardroom directly:

> *"spawn a claude agent to refactor the auth middleware in /Users/me/myapp"*
>
> *"list all running agents and their cost"*
>
> *"tell the orchestrator to ship the checkout feature"*

## Install

```bash
cd boardroom/mcp
npm install
npm run build
```

## Configure your client

### Claude Code

```bash
claude mcp add boardroom -- node /absolute/path/to/boardroom/mcp/dist/index.js
```

If your Boardroom instance is protected with `BOARDROOM_API_KEY`, pass it through:

```bash
claude mcp add boardroom \
  -e BOARDROOM_URL=http://localhost:7391 \
  -e BOARDROOM_API_KEY=$BOARDROOM_API_KEY \
  -- node /absolute/path/to/boardroom/mcp/dist/index.js
```

### Cursor / Windsurf / Claude Desktop

Add to your MCP config (`~/.cursor/mcp.json`, `~/Library/Application Support/Claude/claude_desktop_config.json`, etc):

```json
{
  "mcpServers": {
    "boardroom": {
      "command": "node",
      "args": ["/absolute/path/to/boardroom/mcp/dist/index.js"],
      "env": {
        "BOARDROOM_URL": "http://localhost:7391",
        "BOARDROOM_API_KEY": "optional-bearer-token"
      }
    }
  }
}
```

## Tools

| Tool | What it does |
|------|---------------|
| `boardroom_health` | Check the Boardroom server is up. Use first if other tools fail. |
| `boardroom_list_agents` | List the fleet (running, finished, recent) plus token totals. |
| `boardroom_get_agent` | Full record for one agent — logs, cost, branch, parent task. |
| `boardroom_spawn_agent` | Spawn a new Claude / Codex / OpenCode / shell agent on a task. |
| `boardroom_stop_agent` | Stop a running agent (idempotent). |
| `boardroom_tell_orchestrator` | Send a plain-language goal; orchestrator decomposes and routes it. |
| `boardroom_list_workflows` | List saved DAG pipelines or in-flight runs. |
| `boardroom_get_workflow_run` | Status + step results for a specific run. |
| `boardroom_get_token_usage` | Per-agent token usage and total spend. |

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `BOARDROOM_URL` | `http://localhost:7391` | Base URL of your running Boardroom server. |
| `BOARDROOM_API_KEY` | _(none)_ | Bearer token if Boardroom is protected. |

## Requirements

- Node.js 18+
- A running Boardroom instance (`npm run dev` from the repo root, or via Docker)

## License

MIT — same as Boardroom.
