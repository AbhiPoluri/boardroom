import fs from 'fs';
import path from 'path';
import type { AgentType } from '@/types';

export interface AgentConfig {
  /** Filename without extension */
  slug: string;
  /** Display name from frontmatter */
  name: string;
  type: AgentType;
  model?: string;
  description: string;
  /** The task prompt (body after frontmatter) */
  prompt: string;
  /** Full file path */
  filePath: string;
}

const AGENTS_DIR = path.join(process.cwd(), 'agents');

/** Parse YAML-ish frontmatter from a markdown string */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && val) meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

/** Load all agent configs from the agents/ directory */
export function loadAgentConfigs(): AgentConfig[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];

  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
  const configs: AgentConfig[] = [];

  for (const file of files) {
    const filePath = path.join(AGENTS_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(raw);

    const slug = file.replace(/\.md$/, '');
    configs.push({
      slug,
      name: meta.name || slug,
      type: (meta.type as AgentType) || 'claude',
      model: meta.model || undefined,
      description: meta.description || '',
      prompt: body,
      filePath,
    });
  }

  return configs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Convert a name to a filesystem-safe slug */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Save an agent config as a .md file */
export function saveAgentConfig(opts: { name: string; type: AgentType; model?: string; description: string; prompt: string }): AgentConfig {
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });

  const slug = toSlug(opts.name);
  const filePath = path.join(AGENTS_DIR, `${slug}.md`);

  const lines = [`---`, `name: ${opts.name}`, `type: ${opts.type}`];
  if (opts.model) lines.push(`model: ${opts.model}`);
  lines.push(`description: ${opts.description}`, `---`, '', opts.prompt, '');

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

  return { slug, name: opts.name, type: opts.type, model: opts.model || undefined, description: opts.description, prompt: opts.prompt, filePath };
}

/** Delete an agent config by slug */
export function deleteAgentConfig(slug: string): void {
  const filePath = path.join(AGENTS_DIR, `${slug}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/** Load a single agent config by slug */
export function getAgentConfig(slug: string): AgentConfig | null {
  const filePath = path.join(AGENTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  return {
    slug,
    name: meta.name || slug,
    type: (meta.type as AgentType) || 'claude',
    model: meta.model || undefined,
    description: meta.description || '',
    prompt: body,
    filePath,
  };
}
