import { NextRequest, NextResponse } from 'next/server';
import { getConfig, saveConfig, getDefaults } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = getConfig();

  return NextResponse.json({
    // Never expose the actual key value — just whether it's set
    apiKeySet: !!(cfg.apiKey && cfg.apiKey.length > 0),
    rateLimit: cfg.rateLimit,
    maxAgents: cfg.maxAgents,
    dbPath: cfg.dbPath,
    sandboxRepo: cfg.sandboxRepo,
    port: cfg.port,
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const partial: Record<string, unknown> = {};

    // apiKey — allow empty string to clear it
    if ('apiKey' in body) {
      const val = String(body.apiKey ?? '');
      partial.apiKey = val || undefined;
    }

    if (body.rateLimit !== undefined) {
      const val = parseInt(String(body.rateLimit), 10);
      if (isNaN(val) || val < 1) {
        return NextResponse.json({ error: 'rateLimit must be a positive integer' }, { status: 400 });
      }
      partial.rateLimit = val;
    }

    if (body.maxAgents !== undefined) {
      const val = parseInt(String(body.maxAgents), 10);
      if (isNaN(val) || val < 1) {
        return NextResponse.json({ error: 'maxAgents must be a positive integer' }, { status: 400 });
      }
      partial.maxAgents = val;
    }

    if (body.dbPath !== undefined) {
      const val = String(body.dbPath).trim();
      if (!val) return NextResponse.json({ error: 'dbPath cannot be empty' }, { status: 400 });
      partial.dbPath = val;
    }

    if (body.sandboxRepo !== undefined) {
      const val = String(body.sandboxRepo).trim();
      if (!val) return NextResponse.json({ error: 'sandboxRepo cannot be empty' }, { status: 400 });
      partial.sandboxRepo = val;
    }

    if (body.port !== undefined) {
      const val = parseInt(String(body.port), 10);
      if (isNaN(val) || val < 1 || val > 65535) {
        return NextResponse.json({ error: 'port must be between 1 and 65535' }, { status: 400 });
      }
      partial.port = val;
    }

    // Handle "reset to defaults" — body contains { reset: true }
    if (body.reset === true) {
      const defaults = getDefaults();
      saveConfig({
        apiKey: undefined,
        rateLimit: defaults.rateLimit,
        maxAgents: defaults.maxAgents,
        dbPath: defaults.dbPath,
        sandboxRepo: defaults.sandboxRepo,
        port: defaults.port,
      });
      const cfg = getConfig();
      return NextResponse.json({
        apiKeySet: !!(cfg.apiKey && cfg.apiKey.length > 0),
        rateLimit: cfg.rateLimit,
        maxAgents: cfg.maxAgents,
        dbPath: cfg.dbPath,
        sandboxRepo: cfg.sandboxRepo,
        port: cfg.port,
      });
    }

    saveConfig(partial as Parameters<typeof saveConfig>[0]);

    const cfg = getConfig();
    return NextResponse.json({
      apiKeySet: !!(cfg.apiKey && cfg.apiKey.length > 0),
      rateLimit: cfg.rateLimit,
      maxAgents: cfg.maxAgents,
      dbPath: cfg.dbPath,
      sandboxRepo: cfg.sandboxRepo,
      port: cfg.port,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
