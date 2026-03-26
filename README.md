# boardroom

**AI Agent Orchestration Platform**

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Commits](https://img.shields.io/badge/commits-100%2B-brightgreen)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

Spawn, orchestrate, and manage AI agents from a single platform. Claude Code, Codex, OpenCode — running in parallel, communicating, and delivering results.

---

## Key Features

- **Multi-Agent Spawning** — Launch Claude Code, Codex, OpenCode, and custom shell agents in parallel across multiple repos
- **Orchestrator Chat** — Describe what you need in plain language; the orchestrator breaks it down and delegates to agents
- **Visual DAG Pipelines** — Drag-and-drop workflow builder with output passing, evaluator loops, and router nodes
- **Git Worktree Isolation** — Every agent gets its own branch via git worktrees — no conflicts, clean separation
- **Auto-Commit & Auto-PR** — Agents commit their work and open pull requests automatically when done
- **Merge Conflict Resolution** — Boardroom detects conflicts and auto-spawns resolver agents to fix them
- **IDE Workspace** — Full in-browser file browser, multi-tab editor, syntax highlighting, diff viewer, and PR review
- **Fleet Monitoring** — Real-time agent status, live logs, cost tracking, and token usage per agent
- **Marketplace** — 100+ skills, MCP server configs, and reusable agent personas
- **Cron Scheduling** — Schedule recurring agent tasks on any cron expression
- **Agent Communication** — Built-in message bus so agents can coordinate and pass results to each other
- **Cost Analytics** — Per-agent token tracking and cost breakdown with optimization suggestions

---

## Quick Start

```bash
git clone https://github.com/AbhiPoluri/boardroom
cd boardroom
npm install
npm run dev
```

Open [http://localhost:7391](http://localhost:7391)

**Prerequisites:**
- Node.js 20+
- Git
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code` then `claude login`

**Optional (for additional agent types):**
- Codex: `npm install -g @openai/codex`
- OpenCode: see [opencode.ai](https://opencode.ai)

**Production build:**
```bash
npm run build && npm start
```

---

## Architecture

Boardroom is a self-hosted Next.js app that manages agent processes directly on your machine.

- **Next.js 16 App Router + TypeScript** — full-stack framework for UI and API routes
- **SQLite (better-sqlite3)** — lightweight persistence for agents, workflows, logs, and costs
- **node-pty** — spawns real terminal sessions for each agent with live I/O streaming
- **Git worktrees** — branch isolation so parallel agents never step on each other
- **SSE (Server-Sent Events)** — real-time streaming of agent output to the browser

```
boardroom/
├── app/
│   ├── workspace/        # IDE: file browser, editor, diff, PR review
│   ├── workflows/        # Visual DAG pipeline builder + runner
│   ├── orchestrator/     # Chat UI for orchestration
│   ├── costs/            # Token usage + cost analytics
│   ├── cron/             # Scheduled agent jobs
│   ├── skills/           # Skills and personas manager
│   └── api/              # 20+ REST API endpoints
├── components/           # Shared React components
├── lib/
│   ├── orchestrator.ts   # Claude CLI orchestration logic
│   ├── spawner.ts        # Agent process lifecycle
│   ├── workflow-runner.ts # DAG execution engine
│   ├── db.ts             # SQLite access layer
│   └── worktree.ts       # Git worktree operations
└── middleware.ts          # API key authentication
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BOARDROOM_API_KEY` | _(none)_ | API authentication — set this in production |
| `BOARDROOM_RATE_LIMIT` | `10` | Max requests per minute per client |
| `BOARDROOM_MAX_AGENTS` | `20` | Max concurrent agents |
| `WORKFLOW_SANDBOX_REPO` | `~/boardroom-sandbox` | Default repo for workflow agent execution |
| `DB_PATH` | `.boardroom.db` | SQLite database file location |
| `PORT` | `3000` | Server port (dev uses 7391) |

No `ANTHROPIC_API_KEY` needed — agents authenticate via your Claude Code CLI login.

---

## Docker

```bash
docker compose up
```

Or with a generated API key for production:

```bash
BOARDROOM_API_KEY=$(openssl rand -hex 32) docker compose up -d
```

The `docker-compose.yml` mounts your local `~/.config/claude` directory so agents can use your existing Claude Code login inside the container.

---

## API

Full interactive docs available at [http://localhost:7391/api-docs](http://localhost:7391/api-docs) when the server is running.

Key endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/agents` | Spawn a new agent |
| `GET` | `/api/agents` | List all agents and their status |
| `DELETE` | `/api/agents/:id` | Stop and remove an agent |
| `POST` | `/api/workflows/run` | Execute a workflow pipeline |
| `GET` | `/api/costs` | Get token usage and cost breakdown |
| `POST` | `/api/orchestrator/chat` | Send a message to the orchestrator |
| `GET` | `/api/logs/:agentId` | Stream live agent logs via SSE |

---

## Testing

```bash
npm test
npm run test:coverage
```

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with tests
4. Open a pull request against `main`

Please keep PRs focused — one feature or fix per PR. For large changes, open an issue first to discuss the approach.

---

## License

MIT — see [LICENSE](./LICENSE)
