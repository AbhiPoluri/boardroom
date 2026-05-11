'use client';

import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useInView, useMotionValue, animate } from 'framer-motion';
import {
  Sparkles, Users, ListTodo, GitPullRequest, BookOpen, Workflow,
  Cpu, Activity, Lightbulb, Layers, ChevronRight, ArrowLeft, Rocket,
  CheckCircle2, Circle, Clock, GitMerge, ArrowRight,
} from 'lucide-react';
import { RuntimeBadge, RUNTIME_STYLE, type PersonaRuntime } from '@/components/RuntimeBadge';

const SECTIONS: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }> = [
  { id: 'welcome',       label: 'Welcome',         icon: Rocket },
  { id: 'personas',      label: 'Personas',        icon: Users },
  { id: 'runtimes',      label: 'Runtimes',        icon: Cpu },
  { id: 'board',         label: 'The board',       icon: ListTodo },
  { id: 'plans',         label: 'Plans',           icon: Layers },
  { id: 'dispatcher',    label: 'Auto dispatcher', icon: Activity },
  { id: 'review',        label: 'Reviewing PRs',   icon: GitPullRequest },
  { id: 'custom-pages',  label: 'Custom pages',    icon: BookOpen },
  { id: 'workflows',     label: 'Workflows',       icon: Workflow },
  { id: 'tips',          label: 'Tips',            icon: Lightbulb },
];

// ─── Scroll progress bar ──────────────────────────────────────────────────
function ScrollProgress({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const { scrollYProgress } = useScroll({ container });
  const width = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  return (
    <motion.div style={{
      position: 'absolute', top: 0, left: 0, height: 2, width,
      background: 'linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 60%, transparent) 100%)',
      zIndex: 5,
    }} />
  );
}

// ─── Section wrapper with fade-up on enter ────────────────────────────────
function AnimatedSection({
  id, title, icon: Icon, lead, children,
}: {
  id: string;
  title: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px 0px -120px 0px' }}
      transition={{ duration: 0.55, ease: [0.2, 0.7, 0.3, 1] }}
      style={{ scrollMarginTop: 24, marginBottom: 80 }}
    >
      <motion.h2
        initial={{ opacity: 0, x: -10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.1, duration: 0.4 }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 26, fontWeight: 600, color: 'var(--fg)',
          marginTop: 0, marginBottom: 14, paddingBottom: 12,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Icon size={20} strokeWidth={1.5} />
        {title}
      </motion.h2>
      {lead && (
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15, duration: 0.4 }}
          style={{ color: 'var(--fg)', fontSize: 16, lineHeight: 1.55, margin: '0 0 18px' }}
        >
          {lead}
        </motion.p>
      )}
      {children}
    </motion.section>
  );
}

// ─── Live runtime selector widget ─────────────────────────────────────────
function RuntimeSelector() {
  const runtimes: PersonaRuntime[] = ['claude', 'hermes', 'codex', 'opencode'];
  const [selected, setSelected] = useState<PersonaRuntime>('claude');
  const detail = RUNTIME_STYLE[selected];
  return (
    <div style={{
      padding: 20, border: '1px solid var(--border)', borderRadius: 12,
      background: 'var(--bg-raised)', overflow: 'hidden', position: 'relative',
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {runtimes.map(rt => (
          <button
            key={rt}
            type="button"
            onClick={() => setSelected(rt)}
            style={{
              cursor: 'pointer', border: 'none', padding: 0, background: 'transparent',
              opacity: selected === rt ? 1 : 0.55,
              transition: 'opacity 200ms',
            }}
          >
            <RuntimeBadge agentType={rt} />
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={selected}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: 14, borderRadius: 10,
            background: `color-mix(in srgb, ${detail.color} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${detail.color} 35%, transparent)`,
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: detail.color, color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600,
          }}>
            {detail.label[0].toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{detail.tagline}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              agent_type: {detail.label}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─── Animated mini task board ─────────────────────────────────────────────
const BOARD_TASKS = [
  { id: 't1', title: 'Draft release notes', from: 0 },
  { id: 't2', title: 'Refactor merge logic', from: 0 },
  { id: 't3', title: 'Wire LinkedIn page', from: 1 },
  { id: 't4', title: 'Add runtime badges', from: 2 },
];

const COLUMN_LABELS = ['Open', 'In progress', 'Blocked', 'Done'];

function MiniBoard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1800);
    return () => clearInterval(iv);
  }, []);
  // Each task progresses Open(0) → In progress(1) → Done(3), looping.
  const progression = [0, 1, 3];
  const stages = BOARD_TASKS.map((t, i) => {
    const idx = (Math.floor(tick / 1) + i) % progression.length;
    return progression[idx];
  });
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
      padding: 16, border: '1px solid var(--border)', borderRadius: 12,
      background: 'var(--bg-raised)',
    }}>
      {COLUMN_LABELS.map((col, ci) => (
        <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 140 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
            {col}
          </div>
          <AnimatePresence>
            {BOARD_TASKS.filter((_, i) => stages[i] === ci).map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.35, ease: [0.2, 0.7, 0.3, 1] }}
                style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: ci === 3 ? 'color-mix(in srgb, var(--state-ok) 14%, var(--bg))'
                            : ci === 1 ? 'color-mix(in srgb, var(--accent) 14%, var(--bg))'
                            : 'var(--bg)',
                  border: `1px solid ${ci === 3 ? 'var(--state-ok)' : ci === 1 ? 'var(--accent-line)' : 'var(--border)'}`,
                  fontSize: 11, color: 'var(--fg)',
                  fontFamily: 'var(--font-mono)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {ci === 3 ? <CheckCircle2 size={11} style={{ color: 'var(--state-ok)' }} />
                 : ci === 1 ? <Clock size={11} style={{ color: 'var(--accent)' }} />
                 : <Circle size={11} style={{ color: 'var(--fg-muted)' }} />}
                {task.title}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

// ─── Animated plan flow diagram ───────────────────────────────────────────
const PLAN_STEPS = [
  { name: 'Maya',  role: 'researcher',  color: '#B084EB' },
  { name: 'Iris',  role: 'designer',    color: '#E89151' },
  { name: 'Theo',  role: 'implementer', color: '#10A37F' },
  { name: 'Ren',   role: 'writer',      color: '#D29A3F' },
  { name: 'Jules', role: 'coordinator', color: '#6B7280' },
];

function PlanFlow() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setActive(a => (a + 1) % (PLAN_STEPS.length + 1)), 1100);
    return () => clearInterval(iv);
  }, []);
  return (
    <div style={{
      padding: 22, border: '1px solid var(--border)', borderRadius: 12,
      background: 'var(--bg-raised)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, overflow: 'hidden',
    }}>
      {PLAN_STEPS.map((step, i) => {
        const done = i < active;
        const live = i === active;
        return (
          <div key={step.name} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <motion.div
              animate={live ? {
                scale: [1, 1.08, 1],
                boxShadow: [
                  `0 0 0 0 ${step.color}00`,
                  `0 0 0 6px ${step.color}40`,
                  `0 0 0 0 ${step.color}00`,
                ],
              } : { scale: 1, boxShadow: `0 0 0 0 ${step.color}00` }}
              transition={live ? { duration: 1.1, repeat: Infinity } : { duration: 0.3 }}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: done || live ? step.color : 'var(--bg)',
                border: `2px solid ${step.color}`,
                opacity: done || live ? 1 : 0.45,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: done || live ? 'white' : 'var(--fg-muted)',
                fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {done ? <CheckCircle2 size={18} /> : step.name[0]}
            </motion.div>
            <div style={{ marginLeft: 8, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--fg)', fontWeight: 500 }}>{step.name}</div>
              <div style={{ fontSize: 9, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{step.role}</div>
            </div>
            {i < PLAN_STEPS.length - 1 && (
              <motion.div
                animate={{ opacity: done ? 1 : 0.25, x: done ? 0 : -4 }}
                transition={{ duration: 0.3 }}
                style={{ color: step.color, marginRight: 4, flexShrink: 0 }}
              >
                <ArrowRight size={14} />
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Dispatcher pulse visualization ───────────────────────────────────────
function DispatcherPulse() {
  return (
    <div style={{
      padding: 22, border: '1px solid var(--border)', borderRadius: 12,
      background: 'var(--bg-raised)', display: 'flex', alignItems: 'center', gap: 18,
    }}>
      <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '1.5px solid var(--state-ok)',
            }}
            animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
            transition={{
              duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut',
            }}
          />
        ))}
        <div style={{
          position: 'absolute', inset: 18, borderRadius: '50%',
          background: 'var(--state-ok)',
        }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, marginBottom: 4 }}>
          Tick every 4 seconds
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>
          Scans auto-personas → finds open tasks with matching skills → assigns.
        </div>
      </div>
    </div>
  );
}

// ─── Animated PR row ──────────────────────────────────────────────────────
function AnimatedPR() {
  const states = [
    { label: 'pending',  color: 'var(--state-warn)', icon: Clock },
    { label: 'approved', color: 'var(--accent)',     icon: CheckCircle2 },
    { label: 'merged',   color: 'var(--state-ok)',   icon: GitMerge },
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setI(x => (x + 1) % states.length), 1500);
    return () => clearInterval(iv);
  }, [states.length]);
  const s = states[i];
  const Icon = s.icon;
  return (
    <div style={{
      padding: 16, border: '1px solid var(--border)', borderRadius: 10,
      background: 'var(--bg-raised)',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <GitPullRequest size={16} style={{ color: 'var(--fg-muted)' }} />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>
        feat/runtime-badges → main
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={s.label}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={{ duration: 0.2 }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 999,
            background: `color-mix(in srgb, ${s.color} 14%, transparent)`,
            border: `1px solid ${s.color}`, color: s.color,
            fontSize: 10, fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
          }}
        >
          <Icon size={11} />
          {s.label}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─── Typing-marker animation for [DONE] ───────────────────────────────────
function TypingDone() {
  const phrases = ['working...', 'compiling fixes', 'pushing branch', '[DONE]'];
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState('');
  useEffect(() => {
    const target = phrases[idx];
    let i = 0;
    const typeIv = setInterval(() => {
      i++;
      setText(target.slice(0, i));
      if (i >= target.length) {
        clearInterval(typeIv);
        setTimeout(() => setIdx((idx + 1) % phrases.length), 1200);
      }
    }, 60);
    return () => clearInterval(typeIv);
  }, [idx]);
  const isDone = phrases[idx] === '[DONE]';
  return (
    <div style={{
      padding: 14, borderRadius: 8,
      background: 'var(--bg-inset)', border: '1px solid var(--border)',
      fontFamily: 'var(--font-mono)', fontSize: 12,
      color: isDone ? 'var(--state-ok)' : 'var(--fg-secondary)',
      display: 'flex', alignItems: 'center', gap: 6, minHeight: 38,
    }}>
      <span style={{ color: 'var(--fg-muted)' }}>$</span>
      <span>{text}</span>
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.6, repeat: Infinity, repeatType: 'reverse' }}
        style={{ display: 'inline-block', width: 7, height: 14, background: 'currentColor', marginLeft: 1 }}
      />
    </div>
  );
}

// ─── Page kind toggler ────────────────────────────────────────────────────
function PageKindToggle() {
  const [kind, setKind] = useState<'markdown' | 'analytics'>('markdown');
  return (
    <div style={{
      padding: 16, border: '1px solid var(--border)', borderRadius: 12,
      background: 'var(--bg-raised)',
    }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['markdown', 'analytics'] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              cursor: 'pointer',
              padding: '6px 14px', borderRadius: 6,
              fontSize: 11, fontFamily: 'var(--font-mono)',
              border: `1px solid ${kind === k ? 'var(--accent)' : 'var(--border)'}`,
              background: kind === k ? 'var(--accent-soft)' : 'transparent',
              color: kind === k ? 'var(--accent)' : 'var(--fg-muted)',
              transition: 'all 200ms',
            }}
          >
            kind: {k}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={kind}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
        >
          {kind === 'markdown' ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)', lineHeight: 1.7 }}>
              <div style={{ color: 'var(--fg-muted)' }}># Week of May 10</div>
              <div>Shipped slice 3, runtime badges, themes fix.</div>
              <div style={{ color: 'var(--fg-muted)' }}>- bullet</div>
              <div style={{ color: 'var(--fg-muted)' }}>- bullet</div>
            </div>
          ) : (
            <AnimatedStatGrid />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AnimatedStatGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {[
        { l: 'Followers', v: 333, c: 'var(--state-ok)' },
        { l: 'Impressions', v: 120, c: 'var(--state-error)' },
        { l: 'Profile views', v: 132, c: 'var(--fg-secondary)' },
      ].map((s, i) => (
        <motion.div
          key={s.l}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.3 }}
          style={{
            padding: 10, border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg)',
          }}
        >
          <div style={{ fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.l}</div>
          <CountUp from={0} to={s.v} duration={0.9} style={{ fontSize: 20, fontWeight: 600, color: 'var(--fg)' }} />
        </motion.div>
      ))}
    </div>
  );
}

function CountUp({ from, to, duration, style }: { from: number; to: number; duration: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const mv = useMotionValue(from);
  useEffect(() => {
    const controls = animate(mv, to, { duration, ease: [0.2, 0.7, 0.3, 1] });
    const unsubscribe = mv.on('change', v => {
      if (ref.current) ref.current.textContent = Math.round(v).toString();
    });
    return () => { controls.stop(); unsubscribe(); };
  }, [mv, to, duration]);
  return <span ref={ref} style={style}>{from}</span>;
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function TutorialPage() {
  const [active, setActive] = useState('welcome');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
          setActive(top.target.id);
        }
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: 0 },
    );
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
      <ScrollProgress container={scrollRef} />

      <aside style={{
        width: 220, flexShrink: 0,
        borderRight: '1px solid var(--border)', background: 'var(--bg-raised)',
        padding: '20px 12px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: 'var(--fg-muted)', fontSize: 12, textDecoration: 'none', marginBottom: 12,
        }}>
          <ArrowLeft size={12} /> back to OS
        </Link>
        <div style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6,
          color: 'var(--fg-muted)', padding: '4px 8px', marginBottom: 6,
        }}>
          tutorial
        </div>
        {SECTIONS.map(s => {
          const Icon = s.icon;
          const isActive = active === s.id;
          return (
            <motion.a
              key={s.id}
              href={`#${s.id}`}
              animate={{
                background: isActive ? 'var(--bg-hover)' : 'rgba(0,0,0,0)',
                color: isActive ? 'var(--fg)' : 'var(--fg-secondary)',
              }}
              whileHover={{ x: 2 }}
              transition={{ duration: 0.2 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 6,
                fontSize: 13, textDecoration: 'none',
                fontWeight: isActive ? 500 : 400,
              }}
            >
              <Icon className="w-3 h-3" strokeWidth={1.75} />
              {s.label}
            </motion.a>
          );
        })}
      </aside>

      <main
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '40px 56px', maxWidth: 920 }}
      >
        <AnimatedSection
          id="welcome"
          title="Welcome to Boardroom"
          icon={Rocket}
          lead={<>An <em>agentic OS</em>. Build a team of named workers, hand them tasks, watch them open real PRs you review.</>}
        >
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
            marginTop: 8, marginBottom: 18,
          }}>
            {[
              { n: '1', t: 'Install a starter pack' },
              { n: '2', t: 'Type a task in the composer' },
              { n: '3', t: 'Persona opens a PR' },
              { n: '4', t: 'Approve in /review' },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.05 * i, duration: 0.45 }}
                whileHover={{ y: -2, borderColor: 'var(--accent)' }}
                style={{
                  padding: 16, border: '1px solid var(--border)', borderRadius: 10,
                  background: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                }}>
                  {s.n}
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.4 }}>{s.t}</div>
              </motion.div>
            ))}
          </div>
          <TypingDone />
        </AnimatedSection>

        <AnimatedSection
          id="personas"
          title="Personas"
          icon={Users}
          lead={<>Named workers — each carries a name, color, skills, system prompt, autonomy, and runtime.</>}
        >
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10,
          }}>
            {PLAN_STEPS.slice(0, 4).map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, scale: 0.94 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.06 * i, duration: 0.4 }}
                whileHover={{ y: -3 }}
                style={{
                  padding: 14, border: '1px solid var(--border)', borderRadius: 10,
                  background: 'var(--bg-raised)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: p.color, color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, flexShrink: 0,
                }}>
                  {p.name[0]}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{p.role}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </AnimatedSection>

        <AnimatedSection
          id="runtimes"
          title="Runtimes"
          icon={Cpu}
          lead={<>Click a badge — see which CLI actually runs when the persona wakes.</>}
        >
          <RuntimeSelector />
        </AnimatedSection>

        <AnimatedSection
          id="board"
          title="The task board"
          icon={ListTodo}
          lead={<>Four columns. Cards flow Open → In progress → Done.</>}
        >
          <MiniBoard />
        </AnimatedSection>

        <AnimatedSection
          id="plans"
          title="Plans"
          icon={Layers}
          lead={<>Chain N subtasks across N personas. Sequential plans with auto-merge accumulate edits into one final result.</>}
        >
          <PlanFlow />
          <Callout title="zsh modifier trap" style={{ marginTop: 16 }}>
            Never inline persona ids in shell args — zsh's <code>:t</code> / <code>:r</code> / <code>:e</code> mangle <code>$PROJ:theo</code> into <code>$PROJ_t + heo</code>. Use a heredoc'd JSON file + <code>curl -d @file</code>.
          </Callout>
        </AnimatedSection>

        <AnimatedSection
          id="dispatcher"
          title="Auto-pickup dispatcher"
          icon={Activity}
          lead={<>Set a persona to autonomy=auto. The dispatcher tick will find it work.</>}
        >
          <DispatcherPulse />
        </AnimatedSection>

        <AnimatedSection
          id="review"
          title="Reviewing PRs"
          icon={GitPullRequest}
          lead={<>Every finished task opens a push request. Batch-approve, revert, or let the conflict resolver handle merge conflicts.</>}
        >
          <AnimatedPR />
        </AnimatedSection>

        <AnimatedSection
          id="custom-pages"
          title="Custom pages (Slice 3)"
          icon={BookOpen}
          lead={<>Agents author pages at <code>/custom/[slug]</code>. Two kinds today — markdown or analytics.</>}
        >
          <PageKindToggle />
          <P style={{ marginTop: 14 }}>
            Personas POST to <code>/api/custom-pages</code> with a slug, title, kind, and content payload.
            See the <Link href="/custom/linkedin-analytics" style={linkStyle}>linkedin-analytics</Link> demo for a real example.
          </P>
        </AnimatedSection>

        <AnimatedSection
          id="workflows"
          title="Workflows + cron"
          icon={Workflow}
          lead={<>Wrap a plan in a cron schedule. Each tick spawns a fresh plan run.</>}
        >
          <div style={{
            padding: 18, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-raised)',
            display: 'flex', alignItems: 'center', gap: 18,
          }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              style={{
                width: 50, height: 50, borderRadius: '50%',
                border: '2px solid var(--accent)',
                position: 'relative', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
                width: 2, height: 14, background: 'var(--accent)', borderRadius: 2,
              }} />
            </motion.div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>0 9 * * MON</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>every Monday at 9am — fresh research drop into a custom page</div>
            </div>
          </div>
        </AnimatedSection>

        <AnimatedSection
          id="tips"
          title="Tips"
          icon={Lightbulb}
          lead={<>The small things you'll run into.</>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { k: 'OpenRouter :free models', v: 'Gate long-context behind paid usage. Swap to a non-free SKU if a hermes persona silently hangs.' },
              { k: 'Persistent claude sessions', v: '--resume reloads the whole prior conversation. Reset the session for fresh threads.' },
              { k: 'Worktree cruft', v: 'Run git worktree prune in /tmp/<repo>/.git/worktrees/ periodically.' },
              { k: 'Markers', v: '[DONE] terminates the agent; [ASK_USER] flips status to needs_input; [HANDOFF] passes work.' },
            ].map((t, i) => (
              <motion.div
                key={t.k}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.05 * i, duration: 0.35 }}
                style={{
                  padding: 12, borderLeft: '3px solid var(--accent)',
                  background: 'var(--bg-raised)', borderRadius: '0 8px 8px 0',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 600, marginBottom: 2 }}>{t.k}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>{t.v}</div>
              </motion.div>
            ))}
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 }}
            style={{ marginTop: 24, textAlign: 'center' }}
          >
            <Link href="/" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', borderRadius: 8,
              background: 'var(--accent)', color: 'var(--accent-fg)',
              fontSize: 13, fontWeight: 500, textDecoration: 'none',
            }}>
              Back to the OS <ChevronRight size={14} />
            </Link>
          </motion.div>
        </AnimatedSection>
      </main>
    </div>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ color: 'var(--fg-secondary)', fontSize: 14, lineHeight: 1.65, margin: 0, ...style }}>
      {children}
    </p>
  );
}

function Callout({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.1 }}
      style={{
        padding: 14, border: '1px solid var(--accent-line)',
        background: 'var(--accent-soft)', borderRadius: 8,
        ...style,
      }}
    >
      <div style={{
        fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6,
        color: 'var(--accent)', fontWeight: 600, marginBottom: 6,
      }}>
        <Sparkles size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
        {title}
      </div>
      <div style={{ color: 'var(--fg-secondary)', fontSize: 13, lineHeight: 1.6 }}>
        {children}
      </div>
    </motion.div>
  );
}

const linkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
};
