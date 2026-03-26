import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted — use a factory that returns fresh fns each time
vi.mock('@/lib/db', () => ({
  getSetting: vi.fn().mockReturnValue(null),
  setSetting: vi.fn(),
}));

// Import AFTER the mock declaration so we get the mocked version
import { getSetting } from '@/lib/db';
import { getRateLimitConfig } from '@/lib/rate-limit-config';

const mockGetSetting = vi.mocked(getSetting);

describe('getRateLimitConfig', () => {
  beforeEach(() => {
    mockGetSetting.mockReturnValue(null);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('defaults', () => {
    it('returns default rateLimit (10) when no env var or DB setting', () => {
      const config = getRateLimitConfig();
      expect(config.rateLimit).toBe(10);
    });

    it('returns default maxAgents (20) when no env var or DB setting', () => {
      const config = getRateLimitConfig();
      expect(config.maxAgents).toBe(20);
    });
  });

  describe('env var overrides', () => {
    it('uses BOARDROOM_RATE_LIMIT env var when no DB setting', () => {
      vi.stubEnv('BOARDROOM_RATE_LIMIT', '50');
      mockGetSetting.mockReturnValue(null);

      const config = getRateLimitConfig();

      expect(config.rateLimit).toBe(50);
    });

    it('uses BOARDROOM_MAX_AGENTS env var when no DB setting', () => {
      vi.stubEnv('BOARDROOM_MAX_AGENTS', '5');
      mockGetSetting.mockReturnValue(null);

      const config = getRateLimitConfig();

      expect(config.maxAgents).toBe(5);
    });

    it('ignores BOARDROOM_RATE_LIMIT=0 and falls back to default', () => {
      vi.stubEnv('BOARDROOM_RATE_LIMIT', '0');
      mockGetSetting.mockReturnValue(null);

      const config = getRateLimitConfig();

      // envRateLimit is 0, which is not > 0, so falls back to default
      expect(config.rateLimit).toBe(10);
    });
  });

  describe('DB setting overrides env var', () => {
    it('DB rateLimit takes priority over env var', () => {
      vi.stubEnv('BOARDROOM_RATE_LIMIT', '50');
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'rateLimit') return '99';
        return null;
      });

      const config = getRateLimitConfig();

      expect(config.rateLimit).toBe(99);
    });

    it('DB maxAgents takes priority over env var', () => {
      vi.stubEnv('BOARDROOM_MAX_AGENTS', '5');
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'maxAgents') return '42';
        return null;
      });

      const config = getRateLimitConfig();

      expect(config.maxAgents).toBe(42);
    });

    it('DB rateLimit takes priority over defaults', () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'rateLimit') return '7';
        return null;
      });

      const config = getRateLimitConfig();

      expect(config.rateLimit).toBe(7);
    });
  });

  describe('invalid values fall back to defaults', () => {
    it('DB rateLimit of "abc" falls back to default', () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'rateLimit') return 'abc';
        return null;
      });

      const config = getRateLimitConfig();

      expect(config.rateLimit).toBe(10);
    });

    it('DB maxAgents of "0" falls back to default (< 1 is invalid)', () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'maxAgents') return '0';
        return null;
      });

      const config = getRateLimitConfig();

      expect(config.maxAgents).toBe(20);
    });

    it('DB rateLimit of "-5" falls back to default', () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'rateLimit') return '-5';
        return null;
      });

      const config = getRateLimitConfig();

      expect(config.rateLimit).toBe(10);
    });

    it('invalid BOARDROOM_RATE_LIMIT env var falls back to default', () => {
      vi.stubEnv('BOARDROOM_RATE_LIMIT', 'not-a-number');
      mockGetSetting.mockReturnValue(null);

      const config = getRateLimitConfig();

      // parseInt('not-a-number') = NaN, NaN > 0 is false, falls back to default
      expect(config.rateLimit).toBe(10);
    });
  });
});
