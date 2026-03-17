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
  const { key, value, category } = await req.json();
  if (!key || !value) return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  setMemory(key, value, category || 'general');
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  deleteMemory(key);
  return NextResponse.json({ ok: true });
}
