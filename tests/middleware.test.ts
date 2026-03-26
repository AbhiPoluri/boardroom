import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Import after setting up env so the module picks up mocks
async function importMiddleware() {
  // Reset module cache between tests so env vars are re-read
  vi.resetModules();
  const mod = await import('../middleware');
  return mod.middleware;
}

function makeRequest(pathname: string, headers: Record<string, string> = {}): NextRequest {
  const url = `http://localhost${pathname}`;
  return new NextRequest(url, { headers });
}

describe('middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('public routes', () => {
    it('passes /api/health without API key even when BOARDROOM_API_KEY is set', async () => {
      vi.stubEnv('BOARDROOM_API_KEY', 'secret-key');
      const middleware = await importMiddleware();

      const req = makeRequest('/api/health');
      const res = middleware(req);

      // NextResponse.next() has status 200, not 401
      expect(res.status).not.toBe(401);
    });

    it('passes /api/health without any key when no env var is set', async () => {
      vi.stubEnv('BOARDROOM_API_KEY', '');
      const middleware = await importMiddleware();

      const req = makeRequest('/api/health');
      const res = middleware(req);

      expect(res.status).not.toBe(401);
    });
  });

  describe('non-API routes (pages)', () => {
    it('passes page routes without API key even when BOARDROOM_API_KEY is set', async () => {
      vi.stubEnv('BOARDROOM_API_KEY', 'secret-key');
      const middleware = await importMiddleware();

      for (const pathname of ['/', '/dashboard', '/settings', '/some-page']) {
        const req = makeRequest(pathname);
        const res = middleware(req);
        expect(res.status).not.toBe(401);
      }
    });
  });

  describe('when BOARDROOM_API_KEY is not set (dev mode)', () => {
    it('allows all /api/* requests without a key', async () => {
      vi.stubEnv('BOARDROOM_API_KEY', '');
      const middleware = await importMiddleware();

      const req = makeRequest('/api/agents');
      const res = middleware(req);

      expect(res.status).not.toBe(401);
    });
  });

  describe('when BOARDROOM_API_KEY is set', () => {
    beforeEach(() => {
      vi.stubEnv('BOARDROOM_API_KEY', 'my-secret-key');
    });

    it('returns 401 for /api/* requests with no key', async () => {
      const middleware = await importMiddleware();

      const req = makeRequest('/api/agents');
      const res = middleware(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/unauthorized/i);
    });

    it('returns 401 for /api/* requests with wrong x-api-key', async () => {
      const middleware = await importMiddleware();

      const req = makeRequest('/api/agents', { 'x-api-key': 'wrong-key' });
      const res = middleware(req);

      expect(res.status).toBe(401);
    });

    it('returns 401 for /api/* requests with wrong Bearer token', async () => {
      const middleware = await importMiddleware();

      const req = makeRequest('/api/agents', { authorization: 'Bearer wrong-key' });
      const res = middleware(req);

      expect(res.status).toBe(401);
    });

    it('passes /api/* requests with correct x-api-key header', async () => {
      const middleware = await importMiddleware();

      const req = makeRequest('/api/agents', { 'x-api-key': 'my-secret-key' });
      const res = middleware(req);

      expect(res.status).not.toBe(401);
    });

    it('passes /api/* requests with correct Bearer token', async () => {
      const middleware = await importMiddleware();

      const req = makeRequest('/api/agents', { authorization: 'Bearer my-secret-key' });
      const res = middleware(req);

      expect(res.status).not.toBe(401);
    });

    it('returns 401 when Authorization header is not Bearer scheme', async () => {
      const middleware = await importMiddleware();

      // Non-Bearer auth header — the key falls through to apiKeyHeader (null), so 401
      const req = makeRequest('/api/agents', { authorization: 'Basic my-secret-key' });
      const res = middleware(req);

      expect(res.status).toBe(401);
    });
  });
});
