import { NextResponse } from 'next/server';
import { getDispatcherLastTick, isDispatcherRunning } from '@/lib/dispatcher';
import { getPersonas, getActiveProject } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const project = getActiveProject();
  const personas = project ? getPersonas(project.id) : [];
  const auto = personas.filter(p => p.autonomy === 'auto');
  return NextResponse.json({
    running: isDispatcherRunning(),
    lastTickAt: getDispatcherLastTick(),
    autoPersonas: auto.length,
    idleAuto: auto.filter(p => p.status === 'idle').length,
  });
}
