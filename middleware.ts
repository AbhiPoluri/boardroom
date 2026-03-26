import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// API routes that require authentication when BOARDROOM_API_KEY is set
const PROTECTED_PREFIXES = ['/api/'];

// Routes that are always public (health check, static assets)
const PUBLIC_ROUTES = ['/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect API routes
  if (!PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some(r => pathname === r)) {
    return NextResponse.next();
  }

  // If no API key is configured, allow all requests (dev mode)
  const apiKey = process.env.BOARDROOM_API_KEY;
  if (!apiKey) {
    console.warn('[boardroom] WARNING: BOARDROOM_API_KEY not set — all API routes are unprotected');
    return NextResponse.next();
  }

  // Check Authorization header or x-api-key header
  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');

  const providedKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : apiKeyHeader;

  let keyValid = false;
  try {
    keyValid = require('crypto').timingSafeEqual(Buffer.from(providedKey ?? ''), Buffer.from(apiKey));
  } catch {
    keyValid = false;
  }
  if (!keyValid) {
    return NextResponse.json(
      { error: 'Unauthorized. Set Authorization: Bearer <key> or x-api-key header.' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
