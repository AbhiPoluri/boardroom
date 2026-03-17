import { NextRequest, NextResponse } from 'next/server';
import { getSessionTokenUsage, getAllTokenUsage, getTokenUsageByModel, getCacheStats, getSessionTokenUsageFiltered, getTokenVelocity } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Cache rate pricing (per token)
const CACHE_RATES: Record<string, { input: number; cache_read: number }> = {
  sonnet: { input: 3.0 / 1_000_000, cache_read: 0.3 / 1_000_000 },
  opus: { input: 15.0 / 1_000_000, cache_read: 1.5 / 1_000_000 },
  haiku: { input: 0.25 / 1_000_000, cache_read: 0.025 / 1_000_000 },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const since = sinceParam ? parseInt(sinceParam, 10) : undefined;

  const session = since ? getSessionTokenUsageFiltered(since) : getSessionTokenUsage();
  const agentTokens = getAllTokenUsage(since);
  const modelBreakdown = getTokenUsageByModel(since);
  const cacheStats = getCacheStats(since);
  const velocity = getTokenVelocity();

  // Calculate cache savings
  let cacheSavings = 0;
  for (const m of modelBreakdown) {
    const rates = CACHE_RATES[m.model] || CACHE_RATES.sonnet;
    cacheSavings += m.cache_read_tokens * (rates.input - rates.cache_read);
  }

  const cacheHitRate = cacheStats.total_input_tokens > 0
    ? cacheStats.cache_read_tokens / (cacheStats.total_input_tokens + cacheStats.cache_read_tokens)
    : 0;

  return NextResponse.json({
    session,
    agents: agentTokens,
    modelBreakdown,
    cache: {
      read_tokens: cacheStats.cache_read_tokens,
      write_tokens: cacheStats.cache_write_tokens,
      hit_rate: cacheHitRate,
      savings_usd: cacheSavings,
    },
    velocity,
  });
}
