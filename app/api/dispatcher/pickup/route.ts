import { NextResponse } from 'next/server';
import { runDispatchPass, syncAllPersonas } from '@/lib/dispatcher';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    syncAllPersonas();
    const pickups = await runDispatchPass();
    return NextResponse.json({ pickups });
  } catch (err) {
    console.error('POST /api/dispatcher/pickup error:', err);
    return NextResponse.json({ error: 'pickup failed' }, { status: 500 });
  }
}
