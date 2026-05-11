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

    // Reap ghost agents whose recorded PIDs are dead — happens after a restart
    // where the row was left as 'running'. Must run before the dispatcher tick
    // so its persona sync sees the corrected status on first pass.
    try {
      const { reapGhostAgents } = await import('@/lib/spawner');
      reapGhostAgents();
    } catch (err) {
      console.error('[instrumentation] ghost-agent reap failed:', err);
    }

    // Prune cancelled tasks older than 24h so the OS board doesn't accumulate
    // dead rows over time. Plans cancel-cascade their subtasks → those pile up
    // fast. Anything cancelled within the last 24h is kept so the user can
    // still see what they cancelled in the recent-activity timeline.
    try {
      const { deleteCancelledTasks } = await import('@/lib/db');
      const { removed } = deleteCancelledTasks({ olderThanMs: 24 * 60 * 60 * 1000 });
      if (removed > 0) console.log(`[instrumentation] pruned ${removed} cancelled task(s) older than 24h`);
    } catch (err) {
      console.error('[instrumentation] cancelled-task prune failed:', err);
    }

    // Kick off the auto-pickup dispatcher loop. Idempotent — safe on hot reload.
    try {
      const { startDispatcher } = await import('@/lib/dispatcher');
      startDispatcher();
    } catch (err) {
      console.error('[instrumentation] dispatcher start failed:', err);
    }

    // Push system-prompt updates to existing personas one time per version.
    // Bump PROMPT_REFRESH_VERSION when prompt language changes again.
    const PROMPT_REFRESH_VERSION = '3';
    try {
      const { getSetting, setSetting, getActiveProject } = await import('@/lib/db');
      const last = getSetting('prompt_refresh_version');
      if (last !== PROMPT_REFRESH_VERSION) {
        const project = getActiveProject();
        if (project) {
          const { refreshStarterPersonaPrompts } = await import('@/lib/personas');
          const { refreshPackPersonaPrompts } = await import('@/lib/persona-packs');
          const a = refreshStarterPersonaPrompts(project.id);
          const b = refreshPackPersonaPrompts(project.id);
          if (a + b > 0) console.log(`[prompts] refreshed ${a + b} persona system prompts to v${PROMPT_REFRESH_VERSION}`);
        }
        setSetting('prompt_refresh_version', PROMPT_REFRESH_VERSION);
      }
    } catch (err) {
      console.error('[instrumentation] prompt refresh failed:', err);
    }
  }
}
