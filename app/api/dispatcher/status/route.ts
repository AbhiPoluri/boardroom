import { NextResponse } from 'next/server';
import { getDispatcherLastTick, isDispatcherRunning } from '@/lib/dispatcher';
import { getPersonas, getActiveProject } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const project = getActiveProject();
  const personas = project ? getPersonas(project.id) : [];
  const auto = personas.filter(p => p.autonomy === 'auto');
  // "Available" mirrors dispatcher's isAvailable check — idle or offline AND
  // no current_agent_id. "Working" is the only state that means actually
  // busy. Previous logic counted only idle as available, so a persona that
  // finished a task and got synced to offline falsely registered as busy.
  const available = auto.filter(p => !p.current_agent_id && (p.status === 'idle' || p.status === 'offline'));
  const working = auto.filter(p => p.status === 'working' || p.status === 'spawning');
  return NextResponse.json({
    running: isDispatcherRunning(),
    lastTickAt: getDispatcherLastTick(),
    autoPersonas: auto.length,
    idleAuto: available.length,
    workingAuto: working.length,
  });
}
