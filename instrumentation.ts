/**
 * Next.js instrumentation hook — runs once on server startup before any
 * request handler is invoked.
 *
 * Syncs ~/.boardroom/config.json values into process.env so that middleware
 * (which runs in Edge Runtime and cannot use the fs module directly) can
 * still read the API key from process.env.BOARDROOM_API_KEY.
 *
 * Env vars that are already set (e.g. from Docker .env) are NOT overwritten —
 * the config file only fills in values that aren't already present.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getConfig } = await import('@/lib/config');
    const cfg = getConfig();

    if (!process.env.BOARDROOM_API_KEY && cfg.apiKey) {
      process.env.BOARDROOM_API_KEY = cfg.apiKey;
    }
    if (!process.env.BOARDROOM_RATE_LIMIT) {
      process.env.BOARDROOM_RATE_LIMIT = String(cfg.rateLimit);
    }
    if (!process.env.BOARDROOM_MAX_AGENTS) {
      process.env.BOARDROOM_MAX_AGENTS = String(cfg.maxAgents);
    }
    if (!process.env.DB_PATH) {
      process.env.DB_PATH = cfg.dbPath;
    }
    if (!process.env.WORKFLOW_SANDBOX_REPO) {
      process.env.WORKFLOW_SANDBOX_REPO = cfg.sandboxRepo;
    }
    if (!process.env.PORT) {
      process.env.PORT = String(cfg.port);
    }
  }
}
