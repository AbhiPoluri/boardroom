import { NextRequest, NextResponse } from 'next/server';
import { loadAgentConfigs, saveAgentConfig, deleteAgentConfig, getAgentConfig } from '@/lib/agent-configs';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get('slug');
    const exportSlug = searchParams.get('export');

    // GET ?slug=xxx — single config
    if (slug) {
      const config = getAgentConfig(slug);
      if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 });
      return NextResponse.json({ config });
    }

    // GET ?export=xxx — download as raw .md file
    if (exportSlug) {
      const config = getAgentConfig(exportSlug);
      if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 });
      const lines = ['---', `name: ${config.name}`, `type: ${config.type}`];
      if (config.model) lines.push(`model: ${config.model}`);
      if (config.description) lines.push(`description: ${config.description}`);
      lines.push('---', '', config.prompt, '');
      return new NextResponse(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="${exportSlug}.md"`,
        },
      });
    }

    // GET — list all
    const configs = loadAgentConfigs();
    return NextResponse.json({ configs });
  } catch (err) {
    console.error('GET /api/agent-configs error:', err);
    return NextResponse.json({ error: 'Failed to load configs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, slug: dupSlug, name, type, model, description, prompt } = body;

    // POST { action: "duplicate", slug: "xxx" } — clone a config
    if (action === 'duplicate') {
      if (!dupSlug) return NextResponse.json({ error: 'slug is required for duplicate' }, { status: 400 });
      const original = getAgentConfig(dupSlug);
      if (!original) return NextResponse.json({ error: 'Config not found' }, { status: 404 });
      const config = saveAgentConfig({
        name: `${original.name}-copy`,
        type: original.type,
        model: original.model,
        description: original.description,
        prompt: original.prompt,
      });
      return NextResponse.json({ config }, { status: 201 });
    }

    // POST — create / update
    if (!name || !prompt) {
      return NextResponse.json({ error: 'name and prompt are required' }, { status: 400 });
    }
    const config = saveAgentConfig({ name, type: type || 'claude', model, description: description || '', prompt });
    return NextResponse.json({ config }, { status: 201 });
  } catch (err) {
    console.error('POST /api/agent-configs error:', err);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { slug } = await req.json();
    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }
    deleteAgentConfig(slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/agent-configs error:', err);
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 });
  }
}
