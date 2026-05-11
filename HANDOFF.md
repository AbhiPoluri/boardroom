# Boardroom — Session Handoff

Last touched: 2026-05-09. Schema is at **v20**. Pick this up cold.

---

## TL;DR

Boardroom is now an agentic OS where personas can run on **multiple runtimes**, not just claude. This session added: hermes integration, real auto-merge plans, persistent claude session continuity, bounded persona-context dumps, a fix for the wakePersona race that piled chained subtasks onto one agent, and a UI redesign that stops the prompt block from covering live agent output.

The system has now been stress-tested end-to-end on:
1. A docs plan (Maya → Iris → Theo → Ren → Jules → 365-line `NBA-PLAN.md`)
2. An implementation plan (Theo × 5 tickets → working Next.js parlay app at `/tmp/nba-parlay`)
3. A live-data upgrade plan (Maya researches → Theo proposes → Theo implements → live ESPN-backed app)
4. An all-hermes 5-persona standup plan (314s, all 5 distinct agents, real outputs, cross-referencing)

If anything looks janky on resume — **DO NOT rip things out assuming bugs**. Check the "Known issues / pending" section first.

---

## What this session shipped (since the prior 2026-05-08 handoff)

### Plan engine + auto-merge

- **Sequential plans now actually accumulate file edits.** New `plans.auto_merge` column (v19). When true, `onSubtaskCompleted` approves + merges each subtask's PR before opening the next subtask. Without this, every persona's branch was created from the same base main and chained doc/code edits silently lost prior work. Default is false (`auto_merge` is opt-in per plan).
- **Plan-creation API rejects bad persona_ids up front.** `POST /api/plans` looks up every `subtasks[].persona_id` via `getPersonaById`; 400s with an explicit "did a shell modifier mangle them?" hint. This catches zsh's `:t` / `:r` / `:e` modifier expansion (`$PROJ:theo` → `$PROJ_t + heo`) which previously stranded plans mid-flight.
- **wakePersona race fix.** `syncPersonaFromAgent`'s `done` case now clears `persona.current_agent_id` BEFORE calling `onSubtaskCompleted`. Previously, the plan engine called `wakePersona` for the next subtask synchronously, found the stale agent_id still set, took the resume path, reused the same worktree+branch, and never created per-subtask PRs. With the fix, every plan subtask gets its own fresh agent → its own commit → its own PR.

### Persistent claude sessions

- **Schema v18: `personas.claude_session_id`.** First task on claude mints a UUID; subsequent tasks pass `--resume <id>`.
- **Cross-cwd session resume.** Each task spawns in a fresh worktree (different cwd), and claude indexes session JSONL files by cwd-slug — so naive `--resume` couldn't find them. The spawner now searches `~/.claude/projects/*` for the session file and copies it to the new worktree's project dir before launching `--resume`. Falls back to `--session-id <same-id>` (fresh conversation, stable id) if the source file is missing.
- **Reset-session endpoint.** `POST /api/personas/[id]/reset-session` nulls `claude_session_id` AND clears any `error` status on the persona. Used by the "reset session" button on the persona detail page — one click recovers a stuck persona whose session resume failed.

### Multi-runtime personas (hermes, etc.)

- **Schema v20: `personas.agent_type`.** Default `claude`. Valid values: `claude | hermes | codex | opencode`.
- **AgentType union extended** in `types/index.ts`.
- **Spawner branch added** for hermes alongside codex/opencode in the PTY path. Invocation: `hermes -m <model> --yolo -z '<prompt>'`. Filters out Claude-only model aliases (`sonnet`, `haiku`, `opus`) so they don't leak into hermes's provider router.
- **wakePersona honors `persona.agent_type`** and skips the claude-session machinery entirely for non-claude runtimes.
- **PATCH `/api/personas/[id]`** accepts `agent_type` (validated).
- **Persona edit UI** has a "runtime" select above model. Model field is a Claude-alias picker for claude, free-text input for hermes (paste `google/gemini-2.5-flash`, `deepseek/deepseek-chat`, etc.).

### Bounded persona-context dumps (this is where token cost lived)

Old behavior: the team-activity + persona-history blocks compounded linearly. After 5 tasks, a heavy persona's prompt would balloon and provider tiers (especially OpenRouter `:free`) would 429 on long-context.

New behavior in `lib/personas.ts`:

1. **Failure-recap filter** (`isLikelyFailureRecap`) — drops any past `result` text starting with `API call failed`, `Process exited with error`, `Spawn failed`, `Merge failed`, `Cannot merge`, `HTTP 4xx/5xx`, or `Error:`. Failure messages no longer self-poison subsequent prompts.
2. **Title dedupe** — pulls a wider 10-task net, keeps the first occurrence of each lowercased title, stops at 5. Three reruns of "smoke test" collapse to one entry.
3. **Single hard total budget** — `gatherPersonaHistory` capped at 1500 chars TOTAL (not per-entry). Most-recent task gets 600 chars of body; older entries get one-line headlines via `recapHeadline()` (first non-empty, non-header, non-`[DONE]` line, 200 chars). Loop bails when the budget's spent.
4. **Same shape for `gatherTeamActivity`** at 800-char total budget, 150-char headlines.

Empirically: Theo's prompt went from 5–7k chars (gating) to 1837 chars (passing) on the same hermes provider.

### Spawner flags trim CLI overhead

`claude -p` now invoked with three additional flags:
- `--tools "Read,Edit,Write,Bash,Glob,Grep,WebFetch"` — restricts to the small set personas use; cuts ~5–10k tokens of unused tool JSONSchemas (NotebookEdit, MCP bridges, computer-use bridges, etc.) from the system prompt.
- `--disable-slash-commands` — strips ~3–5k tokens of skill/command descriptions personas can't invoke in `-p` mode anyway.
- `--exclude-dynamic-system-prompt-sections` — moves cwd/env/git status into the first user message so the cached system prompt is stable across worktrees, improving cache-hit rates on resume.

Combined: ~6–10k tokens saved per claude spawn on a heavy plugin/skill load.

### Hermes hang fix

Hermes (and other one-shot CLIs codex / opencode) sometimes don't exit cleanly after emitting their response — they sit blocked on internal cleanup. The PTY-path idle handler was hardcoded for Claude TUI's `/exit` slash command, which is a no-op on hermes/codex/opencode (those don't read stdin in `-p` / `-z` mode).

New PTY idle handler:
- Detects `[DONE]` marker in plain output → `sawDoneMarker = true`.
- Per-runtime idle window: claude TUI = 15s, hermes/codex/opencode = 30s. With `[DONE]` seen: 5s grace window.
- After timeout: claude → `/exit\r`; hermes/codex/opencode → `ptyProc.kill()` (SIGTERM).

Empirically: Maya's hermes hang (6+ minutes after `[DONE]`) is now resolved in 5–12s.

### `/review` improvements

- **Active/all project toggle** in the list header (`?project=all` vs default active-scope).
- **Project name on PR rows** when scope=all (LEFT JOIN `agents → projects`, surfaces `project_name`).
- **Batch-approve / batch-reject** with checkbox per pending PR + footer toolbar (`N selected · approve all · reject all · clear`). Sequential merges, aggregated toast.
- **Revert-merge** action ([lib/worktree.ts:296](lib/worktree.ts:296) `revertMergedBranch`) — finds the canonical merge commit by message, runs `git revert -m 1 --no-edit`, flips PR to `rejected` with `reviewer_comment="reverted: …"`.
- **Resolver state surfaced** on PR detail (`<ResolverBanner>`) — running / done / failed / done_unverified, with a retry button when failed/unverified.
- **Resolver outcome verification** — `isBranchMergedInto()` cross-checks the parent-repo log; if the resolver said "done" but the merge commit isn't on base, status is downgraded to `done_unverified`.
- **Resolver crash safety** — when a `merge-resolver` agent exits non-cleanly, `cleanupHalfMergedRepo()` runs `git merge --abort` + `git revert --abort` defensively in the parent repo.

### `/review` UI quality-of-life

- **Empty-state icons centered** ([app/os.css](app/os.css) `.brr-os-empty` now `display: flex` column).
- **Author name → /agents/[id] link** with ExternalLink icon in the detail header.
- **File pills as VS Code/Cursor deep-links** — `vscode://file/<absolute path>` (worktree-relative absolute), gracefully falls back to plain spans when worktree is missing.
- **Bell deep-links to most-recent pending PR** (`/review?id=<id>`).

### Other operational fixes

- **Ghost-agent reaper at boot** ([lib/spawner.ts:238](lib/spawner.ts:238) `reapGhostAgents`). Sweeps agents in `running`/`spawning` state whose recorded PIDs are dead; flips them to error.
- **Cancelled-task removal** — `deleteCancelledTasks()` DB helper, `DELETE /api/tasks/cancelled` endpoint, "clear cancelled (N)" button on the task board, automatic 24h-old prune at server boot.
- **Bell + /review project scoping** — `getPushRequests` and `getPendingPushRequestsCount` accept an optional projectId; API defaults to active-project unless `?project=all`.
- **Cross-persona team-activity prompt block** — every task gets a "Team activity" section with the team's last 5 done tasks (now bounded as described above).
- **Persona prompt observability** — `<PromptBlock>` on persona detail shows the full assembled prompt. **Now collapsed by default** (single header row, expandable to 360px scrollable). Was covering live agent output before this session.
- **PR-list duplicate-key bug fixed** — `getBoardTasks` now uses a correlated subquery to pick only the most-recent PR per task's agent (was fanning the join out and triggering React duplicate-key warnings).
- **Multi-project pack defaults** — `getDefaultPackSlugs()`, `addDefaultPackSlug()`, `removeDefaultPackSlug()` settings. Installing a pack pins it as default; new projects auto-install pinned packs.
- **First-run onboarding modal** ([components/OnboardingModal.tsx](components/OnboardingModal.tsx)) — shows once on `/` when no packs are installed; localStorage-gated.

---

## Schema migrations (v17 → v20)

| ver | what | where |
|---|---|---|
| 17 | `push_requests.resolver_agent_id TEXT` — track in-flight conflict resolver per PR | [lib/db.ts:452](lib/db.ts:452) |
| 18 | `personas.claude_session_id TEXT` — persistent claude conversation per persona | [lib/db.ts:461](lib/db.ts:461) |
| 19 | `plans.auto_merge INTEGER DEFAULT 0` — sequential plans auto-merge each subtask's PR | [lib/db.ts:470](lib/db.ts:470) |
| 20 | `personas.agent_type TEXT DEFAULT 'claude'` — per-persona runtime selector | [lib/db.ts:480](lib/db.ts:480) |

Bump `PROMPT_REFRESH_VERSION` in `instrumentation.ts` if you change persona-prompt language and want to push to existing personas.

---

## Active state (what's set up right now)

### Projects + repos
- **`launch test`** project, repo `/tmp/launch-test` — original LAUNCH-PLAN.md test
- **`nba-parlay`** project, repo `/tmp/nba-parlay` — has NBA-PLAN.md, UPGRADE-PLAN.md, TEAM-STANDUP.md, the working Next.js app
- **`workspace`** (default) project bound to `/Users/abhipoluri/boardroom` itself

Active project at handoff: `nba-parlay` (id `bbb4a26d-14fb-4f41-a587-b260de1b3afe`).

### NBA parlay app (real working artifact)
At `/tmp/nba-parlay`:
- Working Next.js 15 + Tailwind + IBM Plex Mono parlay builder
- 12 real NBA players, ESPN-backed live stats (auth-free fallback when balldontlie key unset)
- EV Ribbon + Leg Correlation Matrix components
- `npm run build` passes; `npm run dev` works
- 5 sequential auto_merge plans landed cleanly through Theo's branches

### Persona runtimes in nba-parlay
**All 5 are currently set to `agent_type: hermes`.** User changed this mid-session. Hermes routes through OpenRouter; current model on the user's hermes config is `nvidia/nemotron-3-super-120b-a12b:free` (was `deepseek/deepseek-v4-flash` briefly — that SKU may not exist, OpenRouter routed to a fallback).

OpenRouter `:free` SKUs gate long-context requests behind paid usage. Even with our bounded prompts (1500/800-char total budgets), some persona-history sizes can still trip this. **Workarounds available:** non-`:free` model in `hermes model`, or a non-OpenRouter provider key.

If user complains about 429s post-handoff: that's the OpenRouter free-tier billing gate, not a boardroom bug. The integration is solid.

---

## Known issues / pending work

### Bugs / quirks

1. **TEAM-STANDUP.md has a duplicated "## Tech bet (Theo)" section.** Leftover from an earlier interrupted plan run (`b3658a6` merge). Cosmetic only — would only matter if we re-run that plan. Easy delete.

2. **Persona model field can be empty string `""` for hermes personas** when the user clears it via the UI. Spawner handles correctly (treats as "use hermes default"), but the DB has both `''` and `NULL` as "no override" representations. Could normalize.

3. **First-PR merge race** (open since prior handoff) — when a persona exits, the spawner's auto-PR creation fires immediately, but the `mergeWorktreeBranch` active-agent guard can sometimes still see the agent in 'running' state for a tick. The race-fix (`excludeAgentId` + isolated-worktree filter) handles the common case. Edge case: extremely fast back-to-back plan steps can still occasionally race.

4. **Stuck hermes processes in /tmp/nba-parlay/.git/worktrees/** — there's accumulated cruft from the various test runs. Run `git worktree prune` in `/tmp/nba-parlay` periodically. Ghost-agent reaper handles the DB side.

### Architectural items still open

5. **Modular UI page generation (slice 3 still deferred)** — letting agents author runtime React pages. Big architectural work, not started.

6. **Resolver task-prompt is duplicated in 2 callers** — `app/api/push-requests/route.ts` PATCH + `lib/orchestrator.ts`. Originally I extracted to `lib/conflict-resolver.ts` (the module exists with `buildResolverPrompt` + `spawnConflictResolver`). Both callers DO use the helper now. ✓ Done.

7. **Token-cost knob: trajectory compression for long persistent sessions.** With persistent claude sessions, the `--resume` reloads the entire prior conversation. After 4–5 tasks, that input alone is >50k tokens. Not solved. Two paths: (a) auto-reset sessions every N plan subtasks, (b) call `claude /compact` mid-session externally between tasks.

8. **No UI to clear individual persona task-result text.** If a persona accumulates a giant single-task recap, there's no "trim history" affordance — only "reset session" (which clears claude memory, but task.result rows persist for the team-activity / persona-history blocks). Minor; the failure-filter + dedupe handle the common case.

### Items mentioned but not built

- Persistent claude session continuity (slice 3a) → **DONE** this session.
- Modular UI page generation (slice 3b) → still deferred.
- Onboarding flow → **DONE** this session.

---

## How to resume

### Boot

```bash
cd ~/boardroom
lsof -ti:7391 | xargs -r kill -9 2>/dev/null
npm run dev
```

Server runs at `localhost:7391`. v20 migration runs on first startup.

### Common diagnostics

```bash
# Are any stuck agents in the DB?
python3 -c "
import sqlite3
db = sqlite3.connect('/Users/abhipoluri/boardroom/.boardroom.db')
for r in db.execute(\"SELECT id, name, status, pid FROM agents WHERE status IN ('running','spawning')\"):
    print(r)
"

# Are any persona/hermes/claude processes still alive?
ps auxww | grep -E "[c]laude|[h]ermes --yolo|[c]odex exec|[w]orktrees" | grep -v "claude-opus-4-7"

# Plans currently active?
python3 -c "
import sqlite3
db = sqlite3.connect('/Users/abhipoluri/boardroom/.boardroom.db')
for r in db.execute(\"SELECT id, title, status, project_id, auto_merge FROM plans WHERE status='active'\"):
    print(r)
"
```

### Quick task to a hermes persona

```bash
# JSON-file payload (DO NOT inline persona_ids in zsh — :t/:r modifiers eat them)
cat > /tmp/task.json <<'JSON'
{"action":"assign","persona_id":"<PROJECT_ID>:maya"}
JSON
TASK=$(curl -s -X POST http://localhost:7391/api/tasks -H 'content-type: application/json' \
  -d '{"title":"smoke","description":"Reply OK then [DONE]"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -s -X PATCH "http://localhost:7391/api/tasks/$TASK" -H 'content-type: application/json' -d @/tmp/task.json
```

### Build a plan via JSON file

ALWAYS use a heredoc'd JSON file for plan creation — never inline persona_ids in shell args. zsh's `:t`, `:r`, `:e`, `:l`, `:u` parameter modifiers will silently mangle `$PROJ:theo` into `$PROJ_t + heo`. The plan-creation API now 400s on this, but file-payloads dodge it entirely.

```bash
cat > /tmp/plan.json <<JSON
{
  "title": "...",
  "execution_mode": "sequential",
  "auto_merge": true,
  "project_id": "$PROJ",
  "subtasks": [
    {"title":"...","persona_id":"${PROJ}:maya","description":"..."},
    ...
  ]
}
JSON

PLAN_ID=$(curl -s -X POST http://localhost:7391/api/plans -H 'content-type: application/json' -d @/tmp/plan.json | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -s -X PATCH "http://localhost:7391/api/plans/$PLAN_ID" -H 'content-type: application/json' -d '{"action":"start"}'
```

### Key files cheatsheet

| File | Purpose |
|---|---|
| `lib/db.ts` | SQLite schema + migrations + all CRUD. v20. |
| `lib/spawner.ts` | claude (stream-json) + PTY (codex/opencode/hermes) paths, exit handlers, idle detection, ghost reaper. |
| `lib/personas.ts` | wakePersona, prompt assembly with bounded context (history/team activity/dep context). Failure-filter + dedupe + budget cap. |
| `lib/plans.ts` | startPlan, onSubtaskCompleted, autoMergeFinishedSubtasks, cancelPlan. |
| `lib/conflict-resolver.ts` | `buildResolverPrompt` + `spawnConflictResolver` shared by both PR-approve callers. |
| `lib/dispatcher.ts` | 4s auto-pickup loop. |
| `instrumentation.ts` | Server boot — ghost reaper, cancelled-task prune (>24h), dispatcher start, prompt refresh. |
| `app/api/personas/[id]/route.ts` | PATCH accepts `agent_type` |
| `app/api/personas/[id]/reset-session/route.ts` | clears claude_session_id + 'error' status |
| `app/api/plans/route.ts` | POST validates persona_ids, accepts `auto_merge` |
| `app/api/push-requests/route.ts` | PATCH supports `approve | reject | retry_resolver | revert` |
| `app/api/tasks/cancelled/route.ts` | DELETE bulk-prunes cancelled tasks |
| `app/personas/[id]/page.tsx` | Persona detail; `<PromptBlock>` collapsed-by-default, reset-session button |
| `app/personas/page.tsx` | Edit form has runtime + model selectors |
| `app/review/page.tsx` | Master-detail PR queue with batch-approve, revert, resolver banner |
| `components/OnboardingModal.tsx` | First-run pack picker |

---

## Watch out for

- **zsh modifier expansion** (`$VAR:t`, `:r`, `:e`, `:l`, `:u`) — silently mangles persona_ids in shell args. The plan API now 400s on unknown ids; always use heredoc'd JSON files for `curl -d @file` payloads.

- **Hermes one-shot mode (`-z`) hangs sometimes after emitting `[DONE]`.** PTY idle handler now SIGTERMs after 5s grace post-`[DONE]` for non-claude runtimes. If you see a hermes process stuck for >30s, the SIGTERM should fire. If it doesn't, check the spawner exit handler.

- **Hot-reload pitfalls.** Changes to `lib/personas.ts`, `lib/spawner.ts`, `lib/db.ts` MAY require a server restart. Turbopack misses module reloads occasionally — when behavior doesn't match code, kill `:7391` and re-run `npm run dev`.

- **Persistent claude sessions input-cost compounding.** Each `--resume` reloads the entire prior conversation. After 4–5 plan subtasks on the same persona, a single resume can be 50k+ input tokens. The wakePersona race fix means each plan subtask now gets a FRESH agent (skipping resume for plan-driven flows would be a sensible future optimization).

- **Persona project scoping** — personas are filtered by `project_id`. Switching projects = different roster. Active project at handoff: nba-parlay.

- **`[ASK_USER]`, `[HANDOFF]`, `[DONE]` markers are described in PROSE in prompts**, not via copy-pasteable JSON examples. Don't add examples back — early versions had personas regurgitating example payloads as actual signals.

- **OpenRouter `:free` model SKUs gate long-context** behind extra usage entitlement. The model can technically handle 200k+ tokens; the `:free` billing tier rejects anything above ~16k input. Prompt-bound budgets help but if user hits 429s, the answer is to switch to a non-`:free` model.

- **Test cleanup**: `/tmp/nba-parlay/.git/worktrees/` accumulates worktree dirs from interrupted/old runs. Run `git worktree prune` periodically. The boardroom DB's ghost-agent reaper handles status rows but not worktree files.

---

## What works (verified end-to-end this session)

- ✅ Multi-persona sequential plan with auto_merge, all five personas, hermes runtime, real outputs cross-referencing each other (TEAM-STANDUP.md test, 5m14s)
- ✅ NBA parlay Next.js app builds + runs, fed by live ESPN data
- ✅ Persistent claude sessions across separate tasks (Maya recalled "Slate" from a prior task)
- ✅ Auto-merge plans accumulating into a single doc (NBA-PLAN.md, 365 lines, 5 sections)
- ✅ Hermes integration ends-to-end (spawn, PTY capture, exit, recap, auto-PR, auto-merge)
- ✅ Bounded prompts (5 personas × ~1500 chars each, no provider 429s)
- ✅ wakePersona race fix (5 distinct agents per 5-step plan, separate branches, separate PRs)
- ✅ Reset-session button recovers stuck personas (Iris)
- ✅ Failure-filter strips 429s out of next prompts
- ✅ Hermes hang fix (5–12s exit instead of 6+ minute hang)
- ✅ PromptBlock collapsed-by-default doesn't cover live output (53px collapsed vs 436px expanded)

Pick up by reading the `nba-parlay` repo's `NBA-PLAN.md` + `UPGRADE-PLAN.md` + `TEAM-STANDUP.md` to see what the system has produced.
