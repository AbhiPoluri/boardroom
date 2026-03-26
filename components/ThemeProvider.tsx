'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type BuiltinTheme = 'dark' | 'light' | 'midnight' | 'emerald';
export type Theme = BuiltinTheme | string; // string = custom theme ID

export interface ThemeColors {
  '--br-bg-primary': string;
  '--br-bg-secondary': string;
  '--br-bg-card': string;
  '--br-bg-hover': string;
  '--br-border': string;
  '--br-text-primary': string;
  '--br-text-secondary': string;
  '--br-text-muted': string;
  '--br-accent': string;
  '--br-accent-hover': string;
  '--br-danger': string;
  '--br-warning': string;
  '--br-info': string;
}

export interface CustomTheme {
  id: string;
  name: string;
  colors: ThemeColors;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themes: Theme[];
  cycleThemes: Theme[];
  setCycleThemes: (ids: Theme[]) => void;
  customThemes: CustomTheme[];
  saveCustomTheme: (t: CustomTheme) => void;
  deleteCustomTheme: (id: string) => void;
  getThemeLabel: (id: Theme) => string;
  getThemeAccent: (id: Theme) => string;
  isBuiltin: (id: Theme) => boolean;
}

const BUILTIN_THEMES: BuiltinTheme[] = ['dark', 'light', 'midnight', 'emerald'];
const STORAGE_KEY = 'boardroom:theme';
const CUSTOM_THEMES_KEY = 'boardroom:custom-themes';
const CYCLE_KEY = 'boardroom:cycle-themes';
const DEFAULT_THEME: Theme = 'dark';

const BUILTIN_LABELS: Record<BuiltinTheme, string> = {
  dark: 'Dark', light: 'Light', midnight: 'Midnight', emerald: 'Emerald',
};

const BUILTIN_ACCENTS: Record<BuiltinTheme, string> = {
  dark: '#10b981', light: '#059669', midnight: '#6366f1', emerald: '#34d399',
};

export const DEFAULT_COLORS: ThemeColors = {
  '--br-bg-primary': '#0a0a0a',
  '--br-bg-secondary': '#18181b',
  '--br-bg-card': '#1c1c1f',
  '--br-bg-hover': '#27272a',
  '--br-border': '#27272a',
  '--br-text-primary': '#fafafa',
  '--br-text-secondary': '#a1a1aa',
  '--br-text-muted': '#71717a',
  '--br-accent': '#10b981',
  '--br-accent-hover': '#059669',
  '--br-danger': '#ef4444',
  '--br-warning': '#eab308',
  '--br-info': '#3b82f6',
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  themes: [...BUILTIN_THEMES],
  cycleThemes: [...BUILTIN_THEMES],
  setCycleThemes: () => {},
  customThemes: [],
  saveCustomTheme: () => {},
  deleteCustomTheme: () => {},
  getThemeLabel: () => '',
  getThemeAccent: () => '',
  isBuiltin: () => true,
});

export function useTheme() {
  return useContext(ThemeContext);
}

function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomThemesToStorage(themes: CustomTheme[]) {
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

function applyCustomThemeVars(colors: ThemeColors) {
  const el = document.documentElement;
  for (const [key, val] of Object.entries(colors)) {
    el.style.setProperty(key, val);
  }
}

function clearCustomThemeVars() {
  const el = document.documentElement;
  for (const key of Object.keys(DEFAULT_COLORS)) {
    el.style.removeProperty(key);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [cycleThemes, setCycleThemesState] = useState<Theme[]>([...BUILTIN_THEMES]);

  useEffect(() => {
    const customs = loadCustomThemes();
    setCustomThemes(customs);

    // Load cycle theme list
    try {
      const savedCycle = localStorage.getItem(CYCLE_KEY);
      if (savedCycle) {
        const parsed = JSON.parse(savedCycle) as Theme[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCycleThemesState(parsed);
        }
      }
    } catch {}


    const saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
    const allIds = [...BUILTIN_THEMES, ...customs.map(c => c.id)];
    const active = allIds.includes(saved) ? saved : DEFAULT_THEME;

    setThemeState(active);

    if (BUILTIN_THEMES.includes(active as BuiltinTheme)) {
      clearCustomThemeVars();
      document.documentElement.setAttribute('data-theme', active);
    } else {
      const custom = customs.find(c => c.id === active);
      if (custom) {
        document.documentElement.setAttribute('data-theme', 'custom');
        applyCustomThemeVars(custom.colors);
      }
    }
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);

    if (BUILTIN_THEMES.includes(newTheme as BuiltinTheme)) {
      clearCustomThemeVars();
      document.documentElement.setAttribute('data-theme', newTheme);
    } else {
      const custom = customThemes.find(c => c.id === newTheme);
      if (custom) {
        document.documentElement.setAttribute('data-theme', 'custom');
        applyCustomThemeVars(custom.colors);
      }
    }
  }, [customThemes]);

  const saveCustomTheme = useCallback((t: CustomTheme) => {
    setCustomThemes(prev => {
      const filtered = prev.filter(c => c.id !== t.id);
      const next = [...filtered, t];
      saveCustomThemesToStorage(next);
      return next;
    });
  }, []);

  const deleteCustomTheme = useCallback((id: string) => {
    setCustomThemes(prev => {
      const next = prev.filter(c => c.id !== id);
      saveCustomThemesToStorage(next);
      return next;
    });
    if (theme === id) {
      setTheme(DEFAULT_THEME);
    }
  }, [theme, setTheme]);

  const setCycleThemes = useCallback((ids: Theme[]) => {
    const valid = ids.length > 0 ? ids : [...BUILTIN_THEMES];
    setCycleThemesState(valid);
    localStorage.setItem(CYCLE_KEY, JSON.stringify(valid));
  }, []);

  const allThemes = [...BUILTIN_THEMES, ...customThemes.map(c => c.id)];

  const getThemeLabel = useCallback((id: Theme) => {
    if (BUILTIN_THEMES.includes(id as BuiltinTheme)) return BUILTIN_LABELS[id as BuiltinTheme];
    const custom = customThemes.find(c => c.id === id);
    return custom?.name || id;
  }, [customThemes]);

  const getThemeAccent = useCallback((id: Theme) => {
    if (BUILTIN_THEMES.includes(id as BuiltinTheme)) return BUILTIN_ACCENTS[id as BuiltinTheme];
    const custom = customThemes.find(c => c.id === id);
    return custom?.colors['--br-accent'] || '#10b981';
  }, [customThemes]);

  const isBuiltin = useCallback((id: Theme) => BUILTIN_THEMES.includes(id as BuiltinTheme), []);

  return (
    <ThemeContext.Provider value={{
      theme, setTheme, themes: allThemes, cycleThemes, setCycleThemes,
      customThemes, saveCustomTheme, deleteCustomTheme, getThemeLabel, getThemeAccent, isBuiltin,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
