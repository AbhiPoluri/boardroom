# Boardroom

Agent orchestration platform. Spawn, manage, and coordinate AI coding agents from a single dashboard.

## What it does

- **Workspace** — IDE with file browser, multi-tab editor, syntax highlighting, git status, inline diff viewer, PR review
- **Orchestrator** — Chat interface that spawns and coordinates agents across repos
- **Workflows** — Visual DAG pipelines with output passing, evaluator loops, router nodes
- **Fleet** — Monitor all agents with live logs, costs, token usage, branch tracking
- **Skills/Configs** — Reusable agent templates and prompt configs

## Requirements

- **Node.js 20+** — native modules (better-sqlite3, node-pty) require it
- **Git** — agents use worktrees for branch isolation
- **Claude Code CLI** — authenticated with `claude login`
- **Claude Max or Pro** — agents run via CLI subscription, no API key needed

Build tools for native modules (usually pre-installed on macOS):
- Python 3, make, g++ (for `npm install` to compile better-sqlite3 and node-pty)

### Optional

- **Codex CLI** (`npm i -g @openai/codex`) — for `codex` agent type
- **OpenCode CLI** (opencode.ai) — for `opencode` agent type

## Setup

```bash
git clone https://github.com/AbhiPoluri/boardroom.git && cd boardroom
npm install
npm run dev
```

Opens on http://localhost:7391

### Production

```bash
npm run build && npm start
```

Or with Docker:

```bash
BOARDROOM_API_KEY=$(openssl rand -hex 32) docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOARDROOM_API_KEY` | No | empty (no auth) | Protects all API routes. Set for production. |
| `DB_PATH` | No | `.boardroom.db` | SQLite database location |
| `WORKFLOW_SANDBOX_REPO` | No | `~/boardroom-sandbox` | Where workflow agents run |
| `PORT` | No | `3000` | Server port (dev uses 7391) |

**Not needed:** `ANTHROPIC_API_KEY` — the orchestrator and agents use `claude --print` which authenticates via your Claude Code CLI login, not an API key.

## Architecture

```
boardroom/
├── app/                  # Next.js pages + API routes
│   ├── workspace/        # IDE: file browser, editor, diff, PRs
│   ├── workflows/        # Visual pipeline builder + runner
│   ├── orchestrator/     # Chat UI for the orchestrator
│   ├── configs/          # Agent config templates
│   ├── skills/           # Claude Code skills manager
│   ├── cron/             # Scheduled agent jobs
│   ├── costs/            # Token usage + cost tracking
│   ├── logs/             # Live agent log viewer
│   ├── branches/         # Git worktree + branch manager
│   └── api/              # 20+ API endpoints
├── components/           # React components
├── lib/                  # Core logic
│   ├── orchestrator.ts   # Claude CLI orchestration
│   ├── spawner.ts        # Agent process management
│   ├── workflow-runner.ts# DAG execution engine
│   ├── db.ts             # SQLite database
│   └── worktree.ts       # Git worktree operations
└── middleware.ts          # API key auth
```

## Agent Types

| Type | CLI | Description |
|------|-----|-------------|
| `claude` | Claude Code | Full coding agent with tools, file access, git |
| `codex` | OpenAI Codex | `--full-auto` mode |
| `opencode` | OpenCode | `opencode run` for non-interactive |
| `custom` | Shell | Raw shell command execution |
| `test` | Echo | Quick test/debug agent |

## Key Features

- **Cmd+K** command palette for global navigation
- **Git isolation** — each agent gets its own worktree branch
- **Auto push requests** — agents create PRs when they finish
- **Workflow presets** — use saved agent configs in pipeline steps
- **Agent swarm** — orchestrator can spawn parallel agent teams
- **Cost optimizer** — suggestions to reduce token spend
- **Semantic search** — grep-powered code search in workspace
- **Mobile responsive** — icons-only nav on small screens

## License

MIT
