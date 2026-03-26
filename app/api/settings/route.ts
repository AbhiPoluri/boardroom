import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { getRateLimitConfig } from '@/lib/rate-limit-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getRateLimitConfig();

  // Also surface raw DB overrides so the UI knows what's persisted
  const dbRateLimit = getSetting('rateLimit');
  const dbMaxAgents = getSetting('maxAgents');

  return NextResponse.json({
    rateLimit: config.rateLimit,
    maxAgents: config.maxAgents,
    // Let the UI know whether these are coming from DB or env/default
    source: {
      rateLimit: dbRateLimit !== null ? 'db' : process.env.BOARDROOM_RATE_LIMIT ? 'env' : 'default',
      maxAgents: dbMaxAgents !== null ? 'db' : process.env.BOARDROOM_MAX_AGENTS ? 'env' : 'default',
    },
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { rateLimit?: unknown; maxAgents?: unknown };

    if (body.rateLimit !== undefined) {
      const val = parseInt(String(body.rateLimit), 10);
      if (isNaN(val) || val < 1) {
        return NextResponse.json({ error: 'rateLimit must be a positive integer' }, { status: 400 });
      }
      setSetting('rateLimit', String(val));
    }

    if (body.maxAgents !== undefined) {
      const val = parseInt(String(body.maxAgents), 10);
      if (isNaN(val) || val < 1) {
        return NextResponse.json({ error: 'maxAgents must be a positive integer' }, { status: 400 });
      }
      setSetting('maxAgents', String(val));
    }

    const config = getRateLimitConfig();
    return NextResponse.json({ rateLimit: config.rateLimit, maxAgents: config.maxAgents });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
