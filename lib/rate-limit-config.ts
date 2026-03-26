import { getSetting } from '@/lib/db';

const DEFAULT_RATE_LIMIT = 10;  // requests per minute
const DEFAULT_MAX_AGENTS = 20;  // concurrent agents

export interface RateLimitConfig {
  rateLimit: number;
  maxAgents: number;
}

/**
 * Returns the current rate limit config.
 * DB values take priority over env vars; env vars take priority over hardcoded defaults.
 */
export function getRateLimitConfig(): RateLimitConfig {
  const envRateLimit = parseInt(process.env.BOARDROOM_RATE_LIMIT || '0', 10);
  const envMaxAgents = parseInt(process.env.BOARDROOM_MAX_AGENTS || '0', 10);

  const dbRateLimit = getSetting('rateLimit');
  const dbMaxAgents = getSetting('maxAgents');

  const rateLimit =
    dbRateLimit !== null
      ? parseInt(dbRateLimit, 10)
      : envRateLimit > 0
      ? envRateLimit
      : DEFAULT_RATE_LIMIT;

  const maxAgents =
    dbMaxAgents !== null
      ? parseInt(dbMaxAgents, 10)
      : envMaxAgents > 0
      ? envMaxAgents
      : DEFAULT_MAX_AGENTS;

  return {
    rateLimit: isNaN(rateLimit) || rateLimit < 1 ? DEFAULT_RATE_LIMIT : rateLimit,
    maxAgents: isNaN(maxAgents) || maxAgents < 1 ? DEFAULT_MAX_AGENTS : maxAgents,
  };
}
