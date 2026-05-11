'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Sparkles, Users, ListTodo, GitPullRequest, BookOpen, Workflow, Wrench,
  Cpu, Activity, Lightbulb, Layers, ChevronRight, ArrowLeft, Rocket,
} from 'lucide-react';
import { RuntimeBadge, RUNTIME_STYLE } from '@/components/RuntimeBadge';

const SECTIONS: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }> = [
  { id: 'welcome',       label: 'Welcome',         icon: Rocket },
  { id: 'personas',      label: 'Personas',        icon: Users },
  { id: 'runtimes',      label: 'Runtimes',        icon: Cpu },
  { id: 'board',         label: 'The board',       icon: ListTodo },
  { id: 'plans',         label: 'Plans',           icon: Layers },
  { id: 'dispatcher',    label: 'Auto dispatcher', icon: Activity },
  { id: 'review',        label: 'Reviewing PRs',   icon: GitPullRequest },
  { id: 'custom-pages',  label: 'Custom pages',    icon: BookOpen },
  { id: 'workflows',     label: 'Workflows + cron', icon: Workflow },
  { id: 'tips',          label: 'Tips & gotchas',  icon: Lightbulb },
];

export default function TutorialPage() {
  const [active, setActive] = useState('welcome');

  // Highlight the section currently in view so the sidebar tracks scroll.
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          // Pick the highest one currently on screen.
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
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <aside style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-raised)',
        padding: '20px 12px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        <Link href="/" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--fg-muted)',
          fontSize: 12,
          textDecoration: 'none',
          marginBottom: 12,
        }}>
          <ArrowLeft size={12} /> back to OS
        </Link>
        <div style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--fg-muted)',
          padding: '4px 8px',
          marginBottom: 6,
        }}>
          tutorial
        </div>
        {SECTIONS.map(s => {
          const Icon = s.icon;
          const isActive = active === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 13,
                color: isActive ? 'var(--fg)' : 'var(--fg-secondary)',
                background: isActive ? 'var(--bg-hover)' : 'transparent',
                textDecoration: 'none',
                fontWeight: isActive ? 500 : 400,
              }}
            >
              <Icon className="w-3 h-3" strokeWidth={1.75} />
              {s.label}
            </a>
          );
        })}
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', padding: '32px 48px', maxWidth: 880 }}>
        <Section id="welcome" title="Welcome to Boardroom" icon={Rocket}>
          <Lead>
            Boardroom is an agentic operating system. You build a team of <em>personas</em> — named workers with skills and a runtime — and hand them tasks or multi-step plans. They run in real worktrees, push real branches, open real PRs, and you review them through the <code>/review</code> queue.
          </Lead>
          <P>
            This tutorial walks through every concept you'll touch, in roughly the order you'll touch them. Use the sidebar to jump around — nothing here builds on the previous section so much that you can't skim.
          </P>
          <Callout title="Five-minute version">
            <ol style={listStyle}>
              <li>Install a starter pack in the onboarding modal → you get a team of personas.</li>
              <li>From <Link href="/" style={linkStyle}>the OS home</Link>, type a task into the composer and assign a persona.</li>
              <li>The persona spawns a real CLI agent in a worktree. When it exits with <code>[DONE]</code>, an auto-PR opens.</li>
              <li>Approve it in <Link href="/review" style={linkStyle}>/review</Link>. The branch merges back into main.</li>
              <li>For anything bigger, use <Link href="/planning" style={linkStyle}>/planning</Link> to chain N tasks across N personas.</li>
            </ol>
          </Callout>
        </Section>

        <Section id="personas" title="Personas" icon={Users}>
          <Lead>A persona is a saved bundle of: name, role, color, skills, system prompt, autonomy (manual or auto), and a runtime (claude / hermes / codex / opencode).</Lead>
          <P>
            Manage them on <Link href="/personas" style={linkStyle}>/personas</Link>. Each persona owns its own conversation context — when it wakes for a new task, it sees its own prior work (bounded to ~1500 chars) plus a peek at what the rest of the team has been doing (~800 chars).
          </P>
          <ul style={listStyle}>
            <li><b>Autonomy = manual</b>: persona only runs when you explicitly assign or wake them.</li>
            <li><b>Autonomy = auto</b>: dispatcher picks up matching open tasks for them every 4 seconds.</li>
            <li><b>Skills</b>: free-form tags; the dispatcher matches them against a task's required_skills.</li>
            <li><b>Reset session</b>: button on the persona detail page — useful if a stuck claude session won't resume.</li>
          </ul>
        </Section>

        <Section id="runtimes" title="Runtimes" icon={Cpu}>
          <Lead>Each persona runs on one of four CLIs. The runtime badge next to a persona's name tells you which.</Lead>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            margin: '12px 0',
          }}>
            {(Object.keys(RUNTIME_STYLE) as Array<keyof typeof RUNTIME_STYLE>).map(rt => {
              const { color, label, tagline } = RUNTIME_STYLE[rt];
              return (
                <div key={rt} style={{
                  padding: 14,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-raised)',
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 8,
                }}>
                  <div style={{ marginBottom: 8 }}>
                    <RuntimeBadge agentType={rt} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
                    {tagline}
                  </div>
                </div>
              );
            })}
          </div>
          <Callout title="When to pick what">
            <ul style={listStyle}>
              <li><b>Claude</b> — default; best for code, planning, anything with Anthropic tools. Persistent session resumes across tasks.</li>
              <li><b>Hermes</b> — routes through OpenRouter; great for cheap research / writing personas. Avoid <code>:free</code> SKUs for long-context plans.</li>
              <li><b>Codex / Opencode</b> — OpenAI Codex CLI and the open-source agent CLI; both run via PTY and exit on the <code>[DONE]</code> marker.</li>
            </ul>
          </Callout>
        </Section>

        <Section id="board" title="The task board" icon={ListTodo}>
          <Lead>The OS home page is a four-column kanban: Open · In Progress · Blocked · Done. New tasks land in Open.</Lead>
          <ul style={listStyle}>
            <li>Type into the floating composer at the bottom (or hit <kbd style={kbdStyle}>/</kbd>) to draft a task.</li>
            <li>Assign to a persona before you submit, or leave unassigned for the dispatcher to pick up.</li>
            <li>Click any task card to drill into its full history, result, and any push request it opened.</li>
            <li>Cancel a task to mark it <code>cancelled</code>; cancelled tasks older than 24h auto-prune at server boot.</li>
          </ul>
        </Section>

        <Section id="plans" title="Plans" icon={Layers}>
          <Lead>A plan is an ordered set of subtasks across personas. Use them when one task isn't enough — e.g. "Research → Design → Implement → Review → Ship".</Lead>
          <P>
            Build plans on <Link href="/planning" style={linkStyle}>/planning</Link>. Two execution modes:
          </P>
          <ul style={listStyle}>
            <li><b>Sequential</b>: each subtask waits for the previous one. Combined with <code>auto_merge: true</code>, each step's PR merges before the next persona spawns — so chained edits accumulate into one final result.</li>
            <li><b>Parallel</b>: all subtasks dispatch at once. Use when steps are independent (research splits, multi-faceted reviews).</li>
          </ul>
          <Callout title="zsh modifier gotcha">
            When you create plans via the CLI, <em>never</em> inline persona ids in shell args. zsh's <code>:t</code> / <code>:r</code> / <code>:e</code> modifiers will silently mangle <code>$PROJ:theo</code> into <code>$PROJ_t + heo</code>. Always use a heredoc'd JSON file + <code>curl -d @file</code>. The plan API will 400 with an explicit hint if you forget.
          </Callout>
        </Section>

        <Section id="dispatcher" title="The auto-pickup dispatcher" icon={Activity}>
          <Lead>Every 4 seconds the dispatcher looks at every persona whose autonomy is set to auto, finds the first open task whose required skills match, and assigns it.</Lead>
          <ul style={listStyle}>
            <li>The dispatcher status pill is bottom-left of the OS home — green = ticking.</li>
            <li>Skills are case-insensitive substring matches. A persona with skills <code>["research","summarize"]</code> will pick up a task tagged <code>research</code>.</li>
            <li>Skill matching is greedy: first match wins. Order your persona skills accordingly.</li>
            <li>Set a persona back to manual autonomy if you don't want it auto-grabbing things.</li>
          </ul>
        </Section>

        <Section id="review" title="Reviewing PRs" icon={GitPullRequest}>
          <Lead>When an agent finishes a task in an isolated worktree, it auto-pushes its branch and opens a push request. <Link href="/review" style={linkStyle}>/review</Link> is the queue.</Lead>
          <ul style={listStyle}>
            <li><b>Batch approve / reject</b>: check multiple PRs and act on them with one click. Sequential merges with aggregated toast.</li>
            <li><b>Resolver banner</b>: when a merge hits a conflict, a resolver agent spawns. You see its running / done / failed state inline and can retry from the UI.</li>
            <li><b>Revert merge</b>: backs out a merged PR by running <code>git revert -m 1</code> on the canonical merge commit and flipping the PR row to rejected.</li>
            <li><b>VS Code / Cursor deep-links</b>: file pills in the PR detail jump straight to the worktree-relative absolute path.</li>
          </ul>
        </Section>

        <Section id="custom-pages" title="Custom pages (Slice 3)" icon={BookOpen}>
          <Lead>Agents can author their own pages at <code>/custom/[slug]</code>. Two kinds today, more coming.</Lead>
          <ul style={listStyle}>
            <li><b>markdown</b>: plain markdown rendered server-side via a zero-dep renderer. No script eval, safe.</li>
            <li><b>analytics</b>: JSON payload that lays out stat cards (with trend arrows), tables, bullets, and free text. See <Link href="/custom" style={linkStyle}>/custom</Link> for the index, or the <Link href="/custom/linkedin-analytics" style={linkStyle}>linkedin-analytics</Link> demo page for a real example.</li>
          </ul>
          <Callout title="Authoring from a persona">
            Personas can POST to <code>/api/custom-pages</code> from inside their worktree:
            <pre style={preStyle}>{`curl -X POST http://localhost:7391/api/custom-pages \\
  -H 'content-type: application/json' \\
  -d '{"slug":"weekly-roundup","title":"Week of May 10","kind":"markdown",
       "content":"# This week\\n- Shipped slice 3..."}'`}</pre>
          </Callout>
        </Section>

        <Section id="workflows" title="Workflows + cron" icon={Workflow}>
          <Lead>Recurring multi-step jobs live in <Link href="/workflows" style={linkStyle}>/workflows</Link>. They wrap plans with cron schedules.</Lead>
          <ul style={listStyle}>
            <li>Each scheduled run spawns a fresh plan execution at the configured cadence.</li>
            <li>Humanized cron labels show the schedule in plain English alongside the cron expression.</li>
            <li>Common pattern: a nightly research workflow that drops a fresh report into a custom page.</li>
          </ul>
        </Section>

        <Section id="tips" title="Tips & gotchas" icon={Lightbulb}>
          <ul style={listStyle}>
            <li><b>OpenRouter <code>:free</code> models</b>: gate long-context requests behind paid usage. If a hermes persona silently hangs, switch its model to a non-free SKU.</li>
            <li><b>Persistent claude sessions</b>: <code>--resume</code> reloads the whole prior conversation. After 4–5 plan subtasks the input alone can exceed 50k tokens; reset the session if you're starting a different thread.</li>
            <li><b>Worktree cruft</b>: <code>/tmp/&lt;repo&gt;/.git/worktrees/</code> accumulates dirs from interrupted runs. <code>git worktree prune</code> in the repo cleans it up.</li>
            <li><b>Ghost agents</b>: rows that say running but whose PID is dead get reaped at server boot. Force a sweep by restarting the dev server.</li>
            <li><b>[ASK_USER] / [HANDOFF] / [DONE]</b>: signal markers personas emit in prose. <code>[DONE]</code> terminates the agent; <code>[ASK_USER]</code> flips status to needs_input and queues a pending question.</li>
          </ul>
          <P>
            That's the tour. <Link href="/" style={linkStyle}>Back to the OS home <ChevronRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /></Link>
          </P>
        </Section>
      </main>
    </div>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 24, marginBottom: 56 }}>
      <h2 style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 22,
        fontWeight: 600,
        color: 'var(--fg)',
        marginTop: 0,
        marginBottom: 16,
        paddingBottom: 10,
        borderBottom: '1px solid var(--border)',
      }}>
        <Icon size={18} strokeWidth={1.5} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--fg)', fontSize: 16, lineHeight: 1.55, margin: '0 0 14px' }}>
      {children}
    </p>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--fg-secondary)', fontSize: 14, lineHeight: 1.65, margin: '0 0 12px' }}>
      {children}
    </p>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14,
      border: '1px solid var(--accent-line)',
      background: 'var(--accent-soft)',
      borderRadius: 8,
      marginTop: 12,
      marginBottom: 4,
    }}>
      <div style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'var(--accent)',
        fontWeight: 600,
        marginBottom: 6,
      }}>
        <Sparkles size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
        {title}
      </div>
      <div style={{ color: 'var(--fg-secondary)', fontSize: 13, lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
}

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  color: 'var(--fg-secondary)',
  fontSize: 14,
  lineHeight: 1.75,
};

const linkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
};

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--bg-raised)',
  color: 'var(--fg)',
  fontSize: 11,
  fontFamily: 'var(--font-mono, monospace)',
};

const preStyle: React.CSSProperties = {
  marginTop: 8,
  marginBottom: 0,
  padding: 10,
  background: 'var(--bg-inset)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'var(--font-mono, monospace)',
  color: 'var(--fg)',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
};
