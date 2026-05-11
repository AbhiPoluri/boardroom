'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Project } from '@/components/ProjectSwitcher';

interface UseProjectsResult {
  active: Project | null;
  projects: Project[];
  loading: boolean;
  setActive: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActiveState] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/projects/active'),
      ]);
      if (listRes.ok) {
        const data = await listRes.json();
        setProjects(data.projects || []);
      }
      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveState(data.project || null);
      }
    } catch {
      // network failure — keep prior state, UI degrades gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setActive = useCallback(async (id: string) => {
    const res = await fetch('/api/projects/active', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const data = await res.json();
      setActiveState(data.project || null);
    }
  }, []);

  return { active, projects, loading, setActive, refresh };
}
