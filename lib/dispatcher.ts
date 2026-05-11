/**
 * Auto-pickup dispatcher — assigns open tasks to idle personas with matching
 * skills. Runs as a periodic in-process loop kicked off from instrumentation.ts
 * (or invoked manually via /api/dispatcher/pickup for tests).
 */

import {
  getPersonas,
  findPickupTaskFor,
  getActiveProject,
  Persona,
} from './db';
import { assignTaskToPersona, syncPersonaFromAgent } from './personas';

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;

const DEFAULT_INTERVAL_MS = 4000;

/** When the dispatcher last ran (epoch ms). 0 if it has never ticked. */
export function getDispatcherLastTick(): number { return lastTickAt; }
export function isDispatcherRunning(): boolean { return started; }

function personaSkills(p: Persona): string[] {
  if (!p.skills_json) return [];
  try {
    const arr = JSON.parse(p.skills_json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function isAvailable(p: Persona): boolean {
  return p.autonomy === 'auto' && p.status === 'idle';
}

/** Run a single dispatch pass. Returns the number of pickups made. */
export async function runDispatchPass(): Promise<number> {
  lastTickAt = Date.now();
  const project = getActiveProject();
  if (!project) return 0;
  const personas = getPersonas(project.id).filter(isAvailable);
  if (personas.length === 0) return 0;

  let pickups = 0;
  for (const persona of personas) {
    const task = findPickupTaskFor(personaSkills(persona), project.id);
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
  if (started) return;
  started = true;
  console.log(`[dispatcher] started — tick every ${intervalMs}ms`);
  timer = setInterval(async () => {
    try {
      syncAllPersonas();
      const pickups = await runDispatchPass();
      lastTickAt = Date.now();
      if (pickups > 0) console.log(`[dispatcher] picked up ${pickups} task${pickups === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[dispatcher] tick failed:', err);
    }
  }, intervalMs);
  // Don't keep the Node process alive just for this loop.
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}

export function stopDispatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
