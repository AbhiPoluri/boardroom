import { NextRequest, NextResponse } from 'next/server';
import { loadAgentConfigs, saveAgentConfig, deleteAgentConfig } from '@/lib/agent-configs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
    const { name, type, model, description, prompt } = body;
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
