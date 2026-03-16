import { NextResponse } from 'next/server';
import { getSessionTokenUsage, getTokenUsageByAgent, getAllAgents } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = getSessionTokenUsage();
  const agents = getAllAgents();
  const agentTokens: Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }> = {};
  for (const agent of agents) {
    const usage = getTokenUsageByAgent(agent.id);
    if (usage.input_tokens > 0 || usage.output_tokens > 0) {
      agentTokens[agent.id] = usage;
    }
  }
  return NextResponse.json({ session, agents: agentTokens });
}
