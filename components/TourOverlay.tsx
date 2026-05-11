'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, X, Sparkles } from 'lucide-react';
import { useTour, TOUR_STEPS } from '@/lib/tour-context';

/**
 * Renders two things when a tour is active:
 *  1. A dimmed mask with a "hole" cut around the target element so the rest
 *     of the page fades back. The hole follows scroll + window resizes.
 *  2. A floating tour card at a sensible placement (top/bottom/left/right/
 *     center) showing the step title, body, and prev/next/exit controls.
 */

interface Rect { left: number; top: number; width: number; height: number; }

const PAD = 8;
const CARD_W = 360;
const CARD_GAP = 14;

export function TourOverlay() {
  const { active, currentStep, step, totalSteps, next, prev, exit } = useTour();
  const pathname = usePathname();
  const [rect, setRect] = useState<Rect | null>(null);

  const updateRect = useCallback(() => {
    if (!currentStep?.target) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${currentStep.target}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    // Pull the element into view if it's not already.
    const inView = r.top >= 0 && r.bottom <= window.innerHeight;
    if (!inView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentStep?.target]);

  useEffect(() => {
    if (!active) return;
    setRect(null);
    // Retry a few times so the target has a chance to mount after a route
    // change. Stop once we find it or after a short window.
    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      updateRect();
      if (rect || attempts > 20) clearInterval(iv);
    }, 100);
    return () => clearInterval(iv);
    // updateRect changes when target changes — that's the trigger we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentStep?.id, pathname]);

  useEffect(() => {
    if (!active) return;
    const onScroll = () => updateRect();
    const onResize = () => updateRect();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [active, updateRect]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, prev, exit]);

  if (!active || !currentStep) return null;

  const hasTarget = Boolean(currentStep.target && rect);
  const placement = currentStep.placement ?? (hasTarget ? 'right' : 'center');

  // ── Tour card position ────────────────────────────────────────────────
  let cardStyle: React.CSSProperties = {};
  if (!hasTarget || placement === 'center' || !rect) {
    cardStyle = {
      left: '50%', top: '50%',
      transform: 'translate(-50%, -50%)',
    };
  } else {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    let left = rect.left + rect.width / 2 - CARD_W / 2;
    let top = rect.top + rect.height + CARD_GAP;
    if (placement === 'top')    { top = rect.top - CARD_GAP - 180; left = rect.left + rect.width / 2 - CARD_W / 2; }
    if (placement === 'bottom') { top = rect.top + rect.height + CARD_GAP; left = rect.left + rect.width / 2 - CARD_W / 2; }
    if (placement === 'left')   { left = rect.left - CARD_W - CARD_GAP; top = rect.top + rect.height / 2 - 90; }
    if (placement === 'right')  { left = rect.left + rect.width + CARD_GAP; top = rect.top + rect.height / 2 - 90; }
    // Clamp into viewport.
    left = Math.max(16, Math.min(left, vw - CARD_W - 16));
    top  = Math.max(16, Math.min(top, vh - 220));
    cardStyle = { left, top };
  }

  // ── Spotlight mask via SVG ────────────────────────────────────────────
  // We use an SVG mask so a single rect "cuts out" the highlighted area.
  const holeRect = rect
    ? { x: rect.left - PAD, y: rect.top - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 }
    : null;

  return (
    <>
      {/* dim mask + spotlight hole */}
      <svg
        style={{
          position: 'fixed', inset: 0, width: '100vw', height: '100vh',
          zIndex: 90, pointerEvents: 'none',
        }}
      >
        <defs>
          <mask id="brr-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {holeRect && (
              <motion.rect
                initial={false}
                animate={{
                  x: holeRect.x, y: holeRect.y,
                  width: holeRect.w, height: holeRect.h,
                }}
                transition={{ type: 'spring', stiffness: 280, damping: 30 }}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.62)"
          mask="url(#brr-tour-mask)"
        />
      </svg>

      {/* pulsing ring around target */}
      {holeRect && (
        <motion.div
          initial={false}
          animate={{
            left: holeRect.x, top: holeRect.y,
            width: holeRect.w, height: holeRect.h,
          }}
          transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          style={{
            position: 'fixed', borderRadius: 10,
            border: '2px solid var(--accent)',
            zIndex: 91, pointerEvents: 'none',
            boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent)',
          }}
        >
          <motion.div
            animate={{ scale: [1, 1.04, 1], opacity: [0.6, 0.2, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              position: 'absolute', inset: -8, borderRadius: 14,
              border: '2px solid var(--accent)',
            }}
          />
        </motion.div>
      )}

      {/* tour card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          style={{
            position: 'fixed', zIndex: 100,
            width: CARD_W, padding: 18,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            color: 'var(--fg)',
            ...cardStyle,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600,
            marginBottom: 8,
          }}>
            <Sparkles size={11} />
            tour · step {step + 1} of {totalSteps}
          </div>

          <div style={{
            fontSize: 16, fontWeight: 600, color: 'var(--fg)',
            lineHeight: 1.35, marginBottom: 6,
          }}>
            {currentStep.title}
          </div>

          <div style={{
            fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.55,
            marginBottom: 16,
          }}>
            {currentStep.body}
          </div>

          {/* progress dots */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: 3, flex: 1, borderRadius: 2,
                  background: i <= step ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 200ms',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={prev}
              disabled={step === 0}
              style={{
                ...buttonStyle, color: 'var(--fg-muted)',
                background: 'transparent',
                opacity: step === 0 ? 0.35 : 1,
                cursor: step === 0 ? 'default' : 'pointer',
              }}
            >
              <ArrowLeft size={12} /> back
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={exit}
              style={{
                ...buttonStyle, color: 'var(--fg-muted)',
                background: 'transparent',
              }}
            >
              <X size={12} /> exit
            </button>
            <button
              type="button"
              onClick={next}
              style={{
                ...buttonStyle,
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                border: '1px solid var(--accent)',
              }}
            >
              {step >= totalSteps - 1 ? 'done' : 'next'}
              {step < totalSteps - 1 && <ArrowRight size={12} />}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 12px', borderRadius: 6,
  border: '1px solid var(--border)',
  fontSize: 12, fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
};
