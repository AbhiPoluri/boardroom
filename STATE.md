# Boardroom — State of the Project

Last touched: 2026-05-12. This is where I left it.

If you're future-me, or anyone picking this up cold: **the system works
end-to-end for the autonomous-goal flow, but it's a personal project, not
hardened for daily-driver use.** Don't take the README's confidence at
face value — read this file before assuming anything.

---

## TL;DR

Boardroom is an agentic OS. You type a goal into the floating orchestrator
chat, the orchestrator (Claude) breaks it into a plan, personas
(claude/hermes/codex/opencode runtimes) execute subtasks in isolated git
worktrees, PRs auto-merge, and when the plan finishes the orchestrator
gets re-invoked with the results to decide if the goal is met — looping
until done or you click stop.

The core architecture is sound. The polish is uneven. Most of the recent
bugs were "agents can't see each other / each other's state" plumbing,
which is fixed. The remaining rough edges are mostly UX and the
fundamental flakiness of running 4 different CLIs as agents.

---

## What's solid

- **Orchestrator chat → plan → execution loop.** Type "build me X", the
  orchestrator (claude) calls `create_plan` with `continuation_goal` and
  `auto_merge=true`, subtasks spawn into worktrees, PRs auto-merge as they
  land, the plan widget shows live progress, and when the plan completes
  the orchestrator is re-invoked on the result to decide next steps.
  Depth-capped at 10 to prevent runaway loops.
- **Multi-runtime spawner.** claude / hermes / codex / opencode all
  supported. Each persona picks one. claude uses stream-json (real-time
  tokens); the others go through PTY with idle-detection + `[DONE]` marker.
- **Persistent claude sessions per persona.** First task mints a session
  UUID, subsequent tasks `--resume` it. Cross-worktree session-file
  copying so resume works across fresh worktrees.
- **Conflict resolver.** Merge conflicts on auto-merge spawn a resolver
  agent automatically; state surfaces in `/review` with a retry button.
- **Persona safety rails.** Every persona system prompt forbids
  pkill/killall, rm -rf outside worktree, force-pushes, etc. Bumped to v4
  after Theo killed the dev server via `pkill -9 node`.
- **Hermes session-file tailing.** `hermes -z` swallows intermediate
  output, but we poll `~/.hermes/sessions/session_*.json` and surface
  reasoning + tool calls + results as PTY chunks. Semi-realtime visibility
  without modifying hermes.
- **HMR-safe singletons.** Dispatcher and spawner state pinned on
  globalThis so Turbopack hot-reload doesn't strand them.
- **Custom pages (Slice 3).** `/custom/[slug]` — agents can author
  markdown or analytics pages at runtime. Live LinkedIn analytics demo
  is at `/custom/linkedin-analytics`.
- **Themes work.** Pre-hydration script prevents FOUC; light/dark/
  midnight/emerald/claude all render coherently. Custom themes too.
- **Tutorial + guided tour.** `/tutorial` has animated content; "Start
  tour" launches a spotlight overlay that walks through every real page.

## What's flaky

- **Free-tier hermes models hallucinate JSON.** They'll occasionally
  write malformed `[HANDOFF]` blocks or call `create_task` with the wrong
  persona slug. Don't trust hermes for structured-output work; use
  claude personas where reliability matters. The orchestrator itself is
  always claude, so the top-level loop is reliable.
- **Autonomous loop not battle-tested end-to-end.** Code path looks
  right and small smoke tests pass. I haven't actually watched a full
  multi-iteration goal complete against a real codebase. Expect the
  first real run to surface at least one edge case.
- **Hermes "real-time" output isn't token-level.** Session-file tailing
  catches reasoning/tool-calls/results, but `hermes -z` itself only
  emits its final response at the end. You'll see thinking deltas show
  up batched, not character-by-character. Switching to ACP/MCP server
  mode would fix this — see "where the seams are" below.
- **OpenRouter `:free` SKUs gate long context.** A heavy persona prompt
  (~16k+ tokens) silently 429s on free tiers. Bounded-context dumps
  help but aren't bulletproof. Pay for the model if it matters.
- **24 schema migrations and counting.** Some are coupled (v17→v20 all
  added in one session), some are scaffolding (v22→v23 are slice-3
  iteration). A clean rewrite would be tighter, but the migrations all
  run idempotent and there's no actual bug here.
- **Plan engine race window.** `wakePersona` race fix (clearing
  `current_agent_id` before `onSubtaskCompleted`) handles 99% of
  cases. Extreme back-to-back plan steps within ~150ms could still
  race; the worktree merge guard has a 3-attempt retry as the
  belt-and-suspenders.

## What's deferred / not built

- **Token-by-token streaming for hermes.** Would require switching
  from `hermes -z` spawn to `hermes mcp serve` / `hermes acp` as a
  long-running server boardroom talks to over a streaming protocol.
  Big refactor on the spawner side. Worth it if hermes becomes
  primary; not worth it if claude personas dominate.
- **UI for editing the orchestrator's system prompt.** Right now it's
  baked into `lib/orchestrator.ts`. Want to tweak how it reasons? Edit
  the file and restart.
- **Token / cost tracking per agent.** `recordTokenUsage` exists in
  the schema but the UI doesn't surface it. Would need a `/costs`
  view.
- **Multi-user / auth.** This is a single-user local app. Don't expose
  it to the internet without putting it behind auth.
- **Trajectory compression for long claude sessions.** After 4-5 plan
  subtasks on the same persona, `--resume` reloads a 50k+ token
  conversation. No compaction loop. Manually `reset-session` from the
  persona detail page when this bites.

## Where the seams are

Places future-me would start looking if I came back.

- **`lib/orchestrator.ts`** — the SYSTEM_PROMPT is where the
  orchestrator's behavior really lives. If the autonomous loop misfires
  (creates wrong plans, doesn't terminate, picks wrong persona), tweak
  the prompt before tweaking the code.
- **`lib/autonomous-loop.ts`** — the continuation logic. Currently
  fires on plan completion, builds a synthetic [autonomous-loop]
  message, re-invokes the orchestrator. Depth cap is 10. If you want
  smarter continuation (e.g. don't continue if all subtasks errored,
  prompt the user instead) this is the file.
- **`lib/spawner.ts`** — biggest file in the repo. Two distinct paths:
  stream-json (claude) and PTY (codex/opencode/hermes). The PTY idle
  handler is delicate; if agents start hanging or exiting prematurely
  again, the idle/DONE-grace tuning is in there.
- **`lib/hermes-progress.ts`** — the session-file watcher. If hermes
  changes its session JSON format in an update, this breaks silently
  (you'd see no progress events but agents still complete). Robust to
  partial-write reads via try/catch but not to schema drift.
- **`lib/personas.ts`** — `buildPersonaPrompt` is where persona
  behavior really lives. `SAFETY_RAILS` + `HANDOFF_PROTOCOL` +
  `ASK_USER_PREAMBLE` are all injected here.
- **`lib/dispatcher.ts`** — auto-pickup loop. 4s tick. If you want a
  different routing strategy (priority-based, skill-weighted, etc.)
  this is one file.
- **`lib/db.ts`** — 1 file, 2700+ lines, every CRUD function and the
  full migration history. Tempting to split; would also be a big
  change-set. Left as-is.

## Run it

```bash
cd ~/boardroom
lsof -ti:7391 | xargs -r kill -9 2>/dev/null
npm run dev
# → http://localhost:7391
```

Active project at handoff: **nba-parlay** (`/tmp/nba-parlay`). All 5
personas (Iris, Jules, Maya, Ren, Theo) are hermes. The "launch test"
project has claude personas if you want to test the more reliable path.

DB file: `~/boardroom/.boardroom.db`. Worktrees in `~/.boardroom/worktrees/`.
Hermes sessions in `~/.hermes/sessions/`.

## One-paragraph honest verdict

The system does what it says — type a goal, watch a team execute it,
walk away. But it's a one-person sandbox, not a production tool. The
parts that matter (planning, execution, auto-merge, autonomous loop)
work; the parts that don't (token streaming for hermes, cost tracking,
auth, polish) are listed above and weren't worth the marginal hour at
the point I stopped. If I come back, the first thing to look at is the
autonomous-loop reliability on a real goal, then either bite the
hermes-as-server refactor or just default all personas to claude and
forget the multi-runtime story.
