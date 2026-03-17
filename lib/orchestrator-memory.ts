import { setMemory, getMemory, getMemoryByCategory, deleteMemory } from './db';

export function rememberPreference(key: string, value: string) {
  setMemory(`pref:${key}`, value, 'preferences');
}

export function getPreference(key: string): string | null {
  return getMemory(`pref:${key}`);
}

export function rememberOutcome(key: string, value: string) {
  setMemory(`outcome:${key}`, value, 'outcomes');
}

export function getOutcome(key: string): string | null {
  return getMemory(`outcome:${key}`);
}

export function rememberContext(key: string, value: string) {
  setMemory(`ctx:${key}`, value, 'context');
}

export function getPreferences(): unknown[] {
  return getMemoryByCategory('preferences');
}

export function getOutcomes(): unknown[] {
  return getMemoryByCategory('outcomes');
}

export function buildMemoryContext(): string {
  const prefs = getMemoryByCategory('preferences') as { key: string; value: string }[];
  const outcomes = getMemoryByCategory('outcomes') as { key: string; value: string }[];

  if (prefs.length === 0 && outcomes.length === 0) return '';

  const parts: string[] = ['## Memory'];

  if (prefs.length > 0) {
    parts.push('### Preferences');
    prefs.slice(0, 10).forEach(p => parts.push(`- ${p.key.replace('pref:', '')}: ${p.value}`));
  }

  if (outcomes.length > 0) {
    parts.push('### Past outcomes');
    outcomes.slice(0, 10).forEach(o => parts.push(`- ${o.key.replace('outcome:', '')}: ${o.value}`));
  }

  return parts.join('\n');
}

export { deleteMemory };
