import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MCP_REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1/servers';

interface McpServerEntry {
  server: {
    name: string;
    description?: string;
    repository?: { url?: string };
    version?: string;
    packages?: Record<string, { registry_name?: string; name?: string }>;
    remotes?: { type?: string; url?: string }[];
  };
  _meta?: Record<string, unknown>;
}

interface McpRegistryResponse {
  servers: McpServerEntry[];
  next_cursor?: string;
}

// Cache to avoid hammering the registry
let mcpCache: { data: McpRegistryResponse; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get('source') || 'mcp';
  const search = searchParams.get('q') || '';
  const cursor = searchParams.get('cursor') || '';

  if (source === 'mcp') {
    return fetchMcpRegistry(search, cursor);
  }

  return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
}

async function fetchMcpRegistry(search: string, cursor: string) {
  try {
    // Use cache for non-search, non-paginated requests
    if (!search && !cursor && mcpCache && Date.now() - mcpCache.ts < CACHE_TTL) {
      return NextResponse.json(mcpCache.data);
    }

    const params = new URLSearchParams();
    params.set('limit', '50');
    if (search) params.set('search', search);
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`${MCP_REGISTRY}?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `MCP registry returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json() as McpRegistryResponse;

    // Flatten the nested structure for the frontend
    const flat = {
      servers: (data.servers || []).map(entry => ({
        name: entry.server?.name || 'unknown',
        description: entry.server?.description || '',
        repository: entry.server?.repository,
        version: entry.server?.version,
        packages: entry.server?.packages,
        remotes: entry.server?.remotes,
      })),
      next_cursor: data.next_cursor,
    };

    // Cache the default (non-search) result
    if (!search && !cursor) {
      mcpCache = { data: flat as unknown as McpRegistryResponse, ts: Date.now() };
    }

    return NextResponse.json(flat);
  } catch (err) {
    console.error('MCP registry fetch failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch from MCP registry' },
      { status: 502 }
    );
  }
}
