/**
 * Boardroom config system.
 *
 * Priority order (highest to lowest):
 *   1. ~/.boardroom/config.json
 *   2. Environment variables
 *   3. Hardcoded defaults
 *
 * This lets users avoid setting env vars manually. Docker deployments that
 * already use env vars continue to work — env vars still override defaults.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface BoardroomConfig {
  /** API key for request authentication. Leave empty to disable auth. */
  apiKey?: string;
  /** Max requests per minute per IP (default: 10). Overridden by DB settings. */
  rateLimit: number;
  /** Max concurrent agents allowed (default: 20). Overridden by DB settings. */
  maxAgents: number;
  /** Path to the SQLite database file. Takes effect on next server restart. */
  dbPath: string;
  /** Path to sandbox repo used as default working dir for workflow agents. */
  sandboxRepo: string;
  /** HTTP server port (default: 7391). Takes effect on next server restart. */
  port: number;
}

const CONFIG_DIR = path.join(os.homedir(), '.boardroom');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS: BoardroomConfig = {
  apiKey: undefined,
  rateLimit: 10,
  maxAgents: 20,
  dbPath: path.join(os.homedir(), '.boardroom', 'data.db'),
  sandboxRepo: path.join(os.homedir(), 'boardroom-sandbox'),
  port: 7391,
};

/** Ensure ~/.boardroom/ exists. */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** Read ~/.boardroom/config.json. Returns partial config or null on missing/error. */
function readConfigFile(): Partial<BoardroomConfig> | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as Partial<BoardroomConfig>;
  } catch {
    return null;
  }
}

/**
 * Returns merged config: file values > env var values > defaults.
 * Env vars still work for Docker deployments.
 */
export function getConfig(): BoardroomConfig {
  const file = readConfigFile() ?? {};

  // Env var layer
  const envApiKey = process.env.BOARDROOM_API_KEY;
  const envRateLimit = parseInt(process.env.BOARDROOM_RATE_LIMIT || '0', 10);
  const envMaxAgents = parseInt(process.env.BOARDROOM_MAX_AGENTS || '0', 10);
  const envDbPath = process.env.DB_PATH;
  const envSandboxRepo = process.env.WORKFLOW_SANDBOX_REPO;
  const envPort = parseInt(process.env.PORT || '0', 10);

  return {
    apiKey:
      file.apiKey !== undefined
        ? file.apiKey
        : envApiKey || DEFAULTS.apiKey,

    rateLimit:
      file.rateLimit !== undefined
        ? file.rateLimit
        : envRateLimit > 0
        ? envRateLimit
        : DEFAULTS.rateLimit,

    maxAgents:
      file.maxAgents !== undefined
        ? file.maxAgents
        : envMaxAgents > 0
        ? envMaxAgents
        : DEFAULTS.maxAgents,

    dbPath:
      file.dbPath !== undefined
        ? file.dbPath
        : envDbPath || DEFAULTS.dbPath,

    sandboxRepo:
      file.sandboxRepo !== undefined
        ? file.sandboxRepo
        : envSandboxRepo || DEFAULTS.sandboxRepo,

    port:
      file.port !== undefined
        ? file.port
        : envPort > 0
        ? envPort
        : DEFAULTS.port,
  };
}

/**
 * Merge partial updates into ~/.boardroom/config.json.
 * Creates the file and directory if they don't exist.
 */
export function saveConfig(partial: Partial<BoardroomConfig>): void {
  ensureConfigDir();
  const existing = readConfigFile() ?? {};
  const next = { ...existing, ...partial };
  // Remove undefined values so they fall back to env/defaults cleanly
  for (const key of Object.keys(next) as Array<keyof BoardroomConfig>) {
    if (next[key] === undefined || next[key] === '') {
      delete next[key];
    }
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
}

/** Returns the DEFAULTS object — used by the UI "reset to defaults" button. */
export function getDefaults(): BoardroomConfig {
  return { ...DEFAULTS };
}
