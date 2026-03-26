import { NextResponse } from 'next/server';
import { getAllWorkflows, getCronJobs } from '@/lib/db';
import { loadAgentConfigs } from '@/lib/agent-configs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rawWorkflows = getAllWorkflows() as any[];
  const workflows = rawWorkflows.map((w) => {
    let steps: unknown[] = [];
    let layout = null;
    try { steps = JSON.parse(w.steps_json); } catch {}
    try { if (w.layout_json) layout = JSON.parse(w.layout_json); } catch {}
    return { ...w, steps, layout, steps_json: undefined, layout_json: undefined };
  });

  const cronJobs = getCronJobs();
  const agentConfigs = loadAgentConfigs();

  const payload = { workflows, cronJobs, agentConfigs };
  const body = JSON.stringify(payload, null, 2);
  const filename = `boardroom-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
