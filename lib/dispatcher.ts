/**
 * Auto-pickup dispatcher — assigns open tasks to idle personas with matching
 * skills. Runs as a periodic in-process loop kicked off from instrumentation.ts
 * (or invoked manually via /api/dispatcher/pickup for tests).
 */

import {
  getPersonas,
  findPickupTaskFor,
  findAssignedTaskForPersona,
  getActiveProject,
  Persona,
} from './db';
import { assignTaskToPersona, syncPersonaFromAgent } from './personas';

// HMR-safe singleton state. Next.js dev mode (Turbopack) re-instantiates
// modules on edit, which would orphan the setInterval timer and reset
// `started` to false on every reload — making the dispatcher silently die
// after the first save while the old timer keeps running against orphaned
// state. Pinning on globalThis keeps a single source of truth across all
// module reloads.
interface DispatcherState {
  started: boolean;
  timer: ReturnType<typeof setInterval> | null;
  lastTickAt: number;
}
const STATE_KEY = '__brr_dispatcher_state__';
const g = globalThis as unknown as Record<string, DispatcherState>;
const state: DispatcherState = g[STATE_KEY] ?? (g[STATE_KEY] = {
  started: false,
  timer: null,
  lastTickAt: 0,
});

const DEFAULT_INTERVAL_MS = 4000;

/** When the dispatcher last ran (epoch ms). 0 if it has never ticked. */
export function getDispatcherLastTick(): number { return state.lastTickAt; }
export function isDispatcherRunning(): boolean { return state.started; }

function personaSkills(p: Persona): string[] {
  if (!p.skills_json) return [];
  try {
    const arr = JSON.parse(p.skills_json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

// A persona is "available for pickup" when it has no agent running and isn't
// blocked waiting on a user response. `idle` is the post-finish ready state;
// `offline` is the post-sleep state. Both have current_agent_id=null and can
// accept new work — the dispatcher should grab them both. Excludes
// `working`, `needs_input`, and `error` since those have unresolved state.
function isAvailable(p: Persona): boolean {
  if (p.autonomy !== 'auto') return false;
  if (p.current_agent_id) return false;
  return p.status === 'idle' || p.status === 'offline';
}

/** Run a single dispatch pass. Returns the number of pickups made.
 *
 * Two pickup paths per idle auto-persona:
 *   1. Pre-assigned task (status='assigned', persona_id matches) — always
 *      spawned, regardless of skill match. Honors explicit user/orchestrator
 *      assignments from the board or the `create_task` tool.
 *   2. Open-pool match (status='open', required_skills ⊆ persona skills) —
 *      classic skill-based auto-pickup. */
export async function runDispatchPass(): Promise<number> {
  state.lastTickAt = Date.now();
  const project = getActiveProject();
  if (!project) return 0;
  const personas = getPersonas(project.id).filter(isAvailable);
  if (personas.length === 0) return 0;

  let pickups = 0;
  for (const persona of personas) {
    // (1) preassigned to this persona by name — always spawn, no skill check.
    const assigned = findAssignedTaskForPersona(persona.id);
    if (assigned) {
      try {
        await assignTaskToPersona(persona.id, assigned);
        pickups += 1;
        continue;
      } catch (err) {
        console.error('[dispatcher] preassigned pickup failed:', err);
      }
    }
    // (2) skill-matched open task — classic auto-pickup. Now also picks up
    // open tasks pre-tagged with this persona's id (orchestrator hints).
    const task = findPickupTaskFor(persona.id, personaSkills(persona), project.id);
    if (!task) continue;
    try {
      await assignTaskToPersona(persona.id, task);
      pickups += 1;
    } catch (err) {
      console.error('[dispatcher] pickup failed:', err);
    }
  }
  return pickups;
}

/** Sweep agent state changes back onto personas (e.g. agent exited -> persona idle). */
export function syncAllPersonas(): void {
  const project = getActiveProject();
  if (!project) return;
  const personas = getPersonas(project.id);
  for (const p of personas) {
    if (p.current_agent_id) {
      try { syncPersonaFromAgent(p.current_agent_id); } catch {}
    }
  }
}

export function startDispatcher(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (state.started) return;
  // If a previous timer is somehow still around (e.g. from a stale module
  // instance after a partial HMR), clear it before installing a fresh one.
  if (state.timer) {
    try { clearInterval(state.timer); } catch { /* ignore */ }
    state.timer = null;
  }
  state.started = true;
  console.log(`[dispatcher] started — tick every ${intervalMs}ms`);
  state.timer = setInterval(async () => {
    try {
      syncAllPersonas();
      const pickups = await runDispatchPass();
      state.lastTickAt = Date.now();
      if (pickups > 0) console.log(`[dispatcher] picked up ${pickups} task${pickups === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[dispatcher] tick failed:', err);
    }
  }, intervalMs);
  // Don't keep the Node process alive just for this loop.
  if (state.timer && typeof (state.timer as { unref?: () => void }).unref === 'function') {
    (state.timer as { unref: () => void }).unref();
  }
}

export function stopDispatcher(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
}
