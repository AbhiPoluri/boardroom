import { NextRequest, NextResponse } from 'next/server';
import { setMemory, getMemory, getMemoryByCategory, deleteMemory } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const category = req.nextUrl.searchParams.get('category');

  if (key) {
    const value = getMemory(key);
    return NextResponse.json({ key, value });
  }
  if (category) {
    const memories = getMemoryByCategory(category);
    return NextResponse.json({ memories });
  }

  // Return all categories
  const prefs = getMemoryByCategory('preferences');
  const outcomes = getMemoryByCategory('outcomes');
  const context = getMemoryByCategory('context');
  return NextResponse.json({ preferences: prefs, outcomes, context });
}

export async function POST(req: NextRequest) {
  let key: string, value: string, category: string | undefined;
  try {
    const body = await req.json();
    key = body.key;
    value = body.value;
    category = body.category;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!key || !value) return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  if (key.length > 256) return NextResponse.json({ error: 'key too long (max 256)' }, { status: 400 });
  if (value.length > 65536) return NextResponse.json({ error: 'value too long (max 65536)' }, { status: 400 });
  setMemory(key, value, category || 'general');
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  try {
    const { key } = await req.json();
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
    deleteMemory(key);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'key required in request body' }, { status: 400 });
  }
}
