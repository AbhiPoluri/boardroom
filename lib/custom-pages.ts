/**
 * Modular UI pages authored by agents (Slice 3 MVP).
 *
 * Markdown content stored in the custom_pages table; rendered by
 * /custom/[slug] using the dep-free Markdown component. Pages are
 * project-scoped — the same slug can exist under different projects.
 *
 * No JSX/MDX evaluation — markdown only, server-rendered as React
 * elements. This avoids the security blast radius of running
 * agent-authored JSX at runtime.
 */

import { getDb } from './db';
import { v4 as uuidv4 } from 'uuid';

export type CustomPageKind = 'markdown' | 'analytics';

export const CUSTOM_PAGE_KINDS: CustomPageKind[] = ['markdown', 'analytics'];

export function isValidKind(k: string): k is CustomPageKind {
  return (CUSTOM_PAGE_KINDS as string[]).includes(k);
}

export interface CustomPage {
  id: string;
  slug: string;
  title: string;
  content: string;
  kind: CustomPageKind;
  project_id: string | null;
  author_persona_id: string | null;
  created_at: number;
  updated_at: number;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function listCustomPages(projectId: string | null): CustomPage[] {
  const db = getDb();
  if (projectId) {
    return db.prepare(
      `SELECT * FROM custom_pages WHERE project_id = ? ORDER BY updated_at DESC`
    ).all(projectId) as CustomPage[];
  }
  return db.prepare(
    `SELECT * FROM custom_pages WHERE project_id IS NULL ORDER BY updated_at DESC`
  ).all() as CustomPage[];
}

export function getCustomPageBySlug(slug: string, projectId: string | null): CustomPage | undefined {
  const db = getDb();
  if (projectId) {
    return db.prepare(
      `SELECT * FROM custom_pages WHERE slug = ? AND project_id = ?`
    ).get(slug, projectId) as CustomPage | undefined;
  }
  return db.prepare(
    `SELECT * FROM custom_pages WHERE slug = ? AND project_id IS NULL`
  ).get(slug) as CustomPage | undefined;
}

export function createCustomPage(input: {
  slug: string;
  title: string;
  content?: string;
  kind?: CustomPageKind;
  project_id?: string | null;
  author_persona_id?: string | null;
}): CustomPage {
  if (!isValidSlug(input.slug)) {
    throw new Error(`Invalid slug "${input.slug}" — must be lowercase letters, digits, hyphens; start with letter/digit; max 80 chars`);
  }
  const db = getDb();
  const now = Date.now();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO custom_pages (id, slug, title, content, kind, project_id, author_persona_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.slug,
    input.title,
    input.content ?? '',
    input.kind ?? 'markdown',
    input.project_id ?? null,
    input.author_persona_id ?? null,
    now,
    now,
  );
  return getCustomPageBySlug(input.slug, input.project_id ?? null)!;
}

export function updateCustomPage(
  slug: string,
  projectId: string | null,
  patch: { title?: string; content?: string; kind?: CustomPageKind },
): CustomPage | undefined {
  const existing = getCustomPageBySlug(slug, projectId);
  if (!existing) return undefined;
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (typeof patch.title === 'string') { fields.push('title = ?'); values.push(patch.title); }
  if (typeof patch.content === 'string') { fields.push('content = ?'); values.push(patch.content); }
  if (patch.kind && isValidKind(patch.kind)) { fields.push('kind = ?'); values.push(patch.kind); }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(existing.id);
  db.prepare(`UPDATE custom_pages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCustomPageBySlug(slug, projectId);
}

export function deleteCustomPage(slug: string, projectId: string | null): boolean {
  const db = getDb();
  const result = projectId
    ? db.prepare(`DELETE FROM custom_pages WHERE slug = ? AND project_id = ?`).run(slug, projectId)
    : db.prepare(`DELETE FROM custom_pages WHERE slug = ? AND project_id IS NULL`).run(slug);
  return result.changes > 0;
}
