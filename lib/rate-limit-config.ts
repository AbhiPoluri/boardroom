import { getSetting } from '@/lib/db';
import { getConfig } from '@/lib/config';

export interface RateLimitConfig {
  rateLimit: number;
  maxAgents: number;
}

/**
 * Returns the current rate limit config.
 * DB values take priority over config file/env vars/defaults.
 */
export function getRateLimitConfig(): RateLimitConfig {
  const cfg = getConfig();

  const dbRateLimit = getSetting('rateLimit');
  const dbMaxAgents = getSetting('maxAgents');

  const rateLimit =
    dbRateLimit !== null
      ? parseInt(dbRateLimit, 10)
      : cfg.rateLimit;

  const maxAgents =
    dbMaxAgents !== null
      ? parseInt(dbMaxAgents, 10)
      : cfg.maxAgents;

  return {
    rateLimit: isNaN(rateLimit) || rateLimit < 1 ? 10 : rateLimit,
    maxAgents: isNaN(maxAgents) || maxAgents < 1 ? 20 : maxAgents,
  };
}
