'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Download, Check } from 'lucide-react';
import { toast } from '@/lib/toast';

interface PackPreview {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  total: number;
  installedCount: number;
  is_default?: boolean;
  personas: Array<{ slug: string; name: string; role: string; color: string }>;
}

const STORAGE_KEY = 'brr-os-onboarded';

/**
 * First-run onboarding modal. Shows once when a user has never installed a
 * persona pack — gives them a head start instead of dropping them into an
 * empty board with no team. Skipped state is persisted in localStorage so it
 * never re-prompts after dismissal. Each install also pins the pack as a
 * default for any new project the user creates later.
 */
export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<PackPreview[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* ignore */ }
    if (dismissed) return;

    fetch('/api/marketplace/packs')
      .then(r => r.json())
      .then(d => {
        const ps: PackPreview[] = d.packs || [];
        setPacks(ps);
        // Skip the modal entirely if the user already has any pack installed
        // — they're past the empty-board first-run state.
        const anyInstalled = ps.some(p => p.installedCount > 0);
        if (!anyInstalled && ps.length > 0) setOpen(true);
        else markDismissed();
      })
      .catch(() => { /* ignore — we'll show next reload */ });
  }, []);

  const markDismissed = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  };

  const handleInstall = async (slug: string) => {
    setInstalling(slug);
    try {
      const r = await fetch(`/api/marketplace/packs/${slug}/install`, { method: 'POST' });
      if (!r.ok) {
        toast.error('install failed');
        return;
      }
      const d = await r.json();
      toast.success(`installed ${d.installed} persona${d.installed === 1 ? '' : 's'}`);
      markDismissed();
      setOpen(false);
      // Reload to refresh persona list everywhere on the page.
      setTimeout(() => window.location.reload(), 400);
    } finally {
      setInstalling(null);
    }
  };

  const handleSkip = () => {
    markDismissed();
    setOpen(false);
  };

  if (!packs) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleSkip(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Pick your starter team
          </DialogTitle>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Personas are named employees with skills and system prompts. Pick a pack to install — you can mix and match more later from the marketplace.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {packs.map(pack => {
            const fully = pack.installedCount === pack.total;
            return (
              <div
                key={pack.slug}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-col gap-2"
                style={{ borderLeft: `3px solid ${pack.accent}` }}
              >
                <div>
                  <h3 className="font-mono text-sm text-zinc-100">{pack.name}</h3>
                  <p className="font-mono text-[10px] text-zinc-400 mt-0.5">{pack.tagline}</p>
                </div>
                <p className="font-mono text-[11px] text-zinc-400 leading-relaxed">{pack.description}</p>
                <div className="flex flex-wrap gap-1">
                  {pack.personas.map(p => (
                    <span
                      key={p.slug}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800/40 border border-zinc-700"
                      title={p.role}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                      {p.name}
                    </span>
                  ))}
                </div>
                <div className="flex justify-end mt-1">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleInstall(pack.slug)}
                    disabled={installing === pack.slug || fully}
                  >
                    {fully ? <><Check className="w-3 h-3" /> installed</>
                      : installing === pack.slug ? 'installing…'
                      : <><Download className="w-3 h-3" /> install {pack.total} personas</>}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between items-center mt-3 pt-3 border-t border-zinc-800">
          <p className="text-[10px] font-mono text-zinc-500">
            One pack pins as your default for any new projects you create.
          </p>
          <Button variant="ghost" size="sm" onClick={handleSkip}>
            skip for now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
