import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock DB and rate-limit-config before importing the route
vi.mock('@/lib/db', () => ({
  getSetting: vi.fn().mockReturnValue(null),
  setSetting: vi.fn(),
}));

vi.mock('@/lib/rate-limit-config', () => ({
  getRateLimitConfig: vi.fn().mockReturnValue({ rateLimit: 10, maxAgents: 20 }),
}));

import { GET, PUT } from '@/app/api/settings/route';
import { getSetting, setSetting } from '@/lib/db';
import { getRateLimitConfig } from '@/lib/rate-limit-config';

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);
const mockGetRateLimitConfig = vi.mocked(getRateLimitConfig);

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/settings', { method: 'GET' });
}

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue(null);
    mockGetRateLimitConfig.mockReturnValue({ rateLimit: 10, maxAgents: 20 });
    vi.unstubAllEnvs();
  });

  it('returns current settings with rateLimit and maxAgents', async () => {
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty('rateLimit', 10);
    expect(data).toHaveProperty('maxAgents', 20);
  });

  it('returns source: default when no DB or env override', async () => {
    mockGetSetting.mockReturnValue(null);
    vi.stubEnv('BOARDROOM_RATE_LIMIT', '');
    vi.stubEnv('BOARDROOM_MAX_AGENTS', '');

    const res = await GET();
    const data = await res.json();

    expect(data.source.rateLimit).toBe('default');
    expect(data.source.maxAgents).toBe('default');
  });

  it('returns source: db when settings come from the database', async () => {
    mockGetSetting.mockReturnValue('15'); // both rateLimit and maxAgents return from DB

    const res = await GET();
    const data = await res.json();

    expect(data.source.rateLimit).toBe('db');
    expect(data.source.maxAgents).toBe('db');
  });

  it('returns source: env when env vars are set but no DB override', async () => {
    mockGetSetting.mockReturnValue(null);
    vi.stubEnv('BOARDROOM_RATE_LIMIT', '30');
    vi.stubEnv('BOARDROOM_MAX_AGENTS', '8');

    const res = await GET();
    const data = await res.json();

    expect(data.source.rateLimit).toBe('env');
    expect(data.source.maxAgents).toBe('env');
  });
});

describe('PUT /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRateLimitConfig.mockReturnValue({ rateLimit: 10, maxAgents: 20 });
  });

  it('updates rateLimit in DB and returns new config', async () => {
    mockGetRateLimitConfig.mockReturnValue({ rateLimit: 25, maxAgents: 20 });

    const req = makePutRequest({ rateLimit: 25 });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockSetSetting).toHaveBeenCalledWith('rateLimit', '25');
    expect(data.rateLimit).toBe(25);
  });

  it('updates maxAgents in DB and returns new config', async () => {
    mockGetRateLimitConfig.mockReturnValue({ rateLimit: 10, maxAgents: 5 });

    const req = makePutRequest({ maxAgents: 5 });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockSetSetting).toHaveBeenCalledWith('maxAgents', '5');
    expect(data.maxAgents).toBe(5);
  });

  it('can update both rateLimit and maxAgents in one request', async () => {
    mockGetRateLimitConfig.mockReturnValue({ rateLimit: 50, maxAgents: 10 });

    const req = makePutRequest({ rateLimit: 50, maxAgents: 10 });
    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(mockSetSetting).toHaveBeenCalledWith('rateLimit', '50');
    expect(mockSetSetting).toHaveBeenCalledWith('maxAgents', '10');
  });

  describe('input validation', () => {
    it('rejects negative rateLimit', async () => {
      const req = makePutRequest({ rateLimit: -5 });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/rateLimit/);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('rejects rateLimit of zero', async () => {
      const req = makePutRequest({ rateLimit: 0 });
      const res = await PUT(req);

      expect(res.status).toBe(400);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('rejects non-numeric rateLimit string', async () => {
      const req = makePutRequest({ rateLimit: 'fast' });
      const res = await PUT(req);

      expect(res.status).toBe(400);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('rejects negative maxAgents', async () => {
      const req = makePutRequest({ maxAgents: -1 });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/maxAgents/);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('rejects non-numeric maxAgents string', async () => {
      const req = makePutRequest({ maxAgents: 'many' });
      const res = await PUT(req);

      expect(res.status).toBe(400);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('accepts numeric strings (coerces to number)', async () => {
      mockGetRateLimitConfig.mockReturnValue({ rateLimit: 30, maxAgents: 20 });

      const req = makePutRequest({ rateLimit: '30' });
      const res = await PUT(req);

      expect(res.status).toBe(200);
      expect(mockSetSetting).toHaveBeenCalledWith('rateLimit', '30');
    });
  });

  describe('edge cases', () => {
    it('handles empty body gracefully (no fields updated)', async () => {
      const req = makePutRequest({});
      const res = await PUT(req);

      expect(res.status).toBe(200);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });

    it('returns 400 for malformed JSON body', async () => {
      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{{{',
      });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/invalid request body/i);
    });

    it('ignores unknown fields without crashing', async () => {
      const req = makePutRequest({ unknownField: 'value' });
      const res = await PUT(req);

      expect(res.status).toBe(200);
      expect(mockSetSetting).not.toHaveBeenCalled();
    });
  });
});
