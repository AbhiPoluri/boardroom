'use client';

import { motion } from 'framer-motion';

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.15, duration: 0.6, ease: 'easeOut' as const },
  }),
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.12, duration: 0.5, ease: 'easeOut' as const },
  }),
};

const drawLine = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: { delay: i * 0.2, duration: 0.8, ease: 'easeInOut' as const },
  }),
};

const containers = [
  { label: 'GitHub', icon: '🐙', color: '#6e5494' },
  { label: 'Postgres', icon: '🐘', color: '#336791' },
  { label: 'Playwright', icon: '🎭', color: '#2EAD33' },
  { label: 'Filesystem', icon: '📁', color: '#f59e0b' },
  { label: 'Slack', icon: '💬', color: '#4A154B' },
  { label: 'Jira', icon: '📋', color: '#0052CC' },
];

const stats = [
  { value: '300+', label: 'Verified Servers', accent: false },
  { value: '160x', label: 'Fewer Tokens', accent: true },
  { value: '96%', label: 'Input Reduction', accent: true },
  { value: '🔒', label: 'Container-Isolated Security', accent: false },
];

export default function InfographicPage() {
  return (
    <div
      style={{
        background: '#0a0a0a',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <motion.div
        initial="hidden"
        animate="visible"
        style={{
          width: '100%',
          maxWidth: 1200,
          background: 'linear-gradient(145deg, #0f0f0f, #141414)',
          borderRadius: 24,
          border: '1px solid #1f1f1f',
          overflow: 'hidden',
          padding: '56px 48px',
        }}
      >
        {/* Header */}
        <motion.div
          custom={0}
          variants={fadeUp}
          style={{ textAlign: 'center', marginBottom: 48 }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 999,
              padding: '6px 18px',
              marginBottom: 16,
            }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path
                d="M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.22 0-.45.02-.68.06-.14-.96-.74-1.79-1.44-2.43l-.29-.24-.25.28c-.52.59-.79 1.39-.72 2.17.02.22.08.64.33 1.01-.24.13-.65.31-1.22.31H2.15l-.04.31c-.14 1.13-.06 4.63 2.19 7.33C5.77 20.1 8 21.18 11.05 21.18c5.67 0 9.87-2.62 11.84-7.38.77.02 2.44.01 3.3-1.63.02-.04.07-.13.22-.42l.08-.17-.26-.16zM7.45 11.96H5.57c-.1 0-.18-.08-.18-.18V10.1c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18zm3.22 0H8.79c-.1 0-.18-.08-.18-.18V10.1c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18zm3.22 0h-1.88c-.1 0-.18-.08-.18-.18V10.1c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18zm3.22 0h-1.88c-.1 0-.18-.08-.18-.18V10.1c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18zm-9.66-3.3H5.57c-.1 0-.18-.08-.18-.18V6.79c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18zm3.22 0H8.79c-.1 0-.18-.08-.18-.18V6.79c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18zm3.22 0h-1.88c-.1 0-.18-.08-.18-.18V6.79c0-.1.08-.18.18-.18h1.88c.1 0 .18.08.18.18v1.69c0 .1-.08.18-.18.18z"
                fill="#10b981"
              />
            </svg>
            <span
              style={{
                color: '#10b981',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              DOCKER MCP TOOLKIT
            </span>
          </div>
          <h1
            style={{
              color: '#fafafa',
              fontSize: 38,
              fontWeight: 800,
              lineHeight: 1.2,
              margin: 0,
              letterSpacing: -0.5,
            }}
          >
            How Docker MCP Toolkit
            <br />
            <span style={{ color: '#10b981' }}>Optimizes Your AI Agents</span>
          </h1>
          <p
            style={{
              color: '#71717a',
              fontSize: 16,
              marginTop: 12,
              maxWidth: 600,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            Smarter tool management for Claude, Cursor, and every MCP-powered
            agent
          </p>
        </motion.div>

        {/* Problem vs Solution */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            marginBottom: 48,
          }}
        >
          {/* Problem */}
          <motion.div
            custom={1}
            variants={fadeUp}
            style={{
              background:
                'linear-gradient(135deg, rgba(239,68,68,0.05), rgba(239,68,68,0.02))',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: 16,
              padding: '32px 28px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ef4444',
                }}
              />
              <span
                style={{
                  color: '#ef4444',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                The Problem
              </span>
            </div>
            <h3
              style={{
                color: '#fafafa',
                fontSize: 20,
                fontWeight: 700,
                margin: '0 0 16px 0',
              }}
            >
              Static MCP Configurations
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                'All tools loaded at startup',
                'Every tool description sent every turn',
                'Bloated context window',
                'Wasted tokens on unused tools',
              ].map((item, i) => (
                <motion.div
                  key={item}
                  custom={2 + i * 0.3}
                  variants={fadeUp}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: '#a1a1aa',
                    fontSize: 14,
                  }}
                >
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </svg>
                  {item}
                </motion.div>
              ))}
            </div>
            <motion.div
              custom={4}
              variants={scaleIn}
              style={{
                marginTop: 20,
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 10,
                padding: '12px 16px',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  color: '#ef4444',
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                100%
              </span>
              <span
                style={{
                  color: '#ef4444',
                  fontSize: 13,
                  marginLeft: 6,
                  opacity: 0.8,
                }}
              >
                tokens sent every turn
              </span>
            </motion.div>
          </motion.div>

          {/* Solution */}
          <motion.div
            custom={1.5}
            variants={fadeUp}
            style={{
              background:
                'linear-gradient(135deg, rgba(16,185,129,0.05), rgba(16,185,129,0.02))',
              border: '1px solid rgba(16,185,129,0.15)',
              borderRadius: 16,
              padding: '32px 28px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#10b981',
                }}
              />
              <span
                style={{
                  color: '#10b981',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                The Solution
              </span>
            </div>
            <h3
              style={{
                color: '#fafafa',
                fontSize: 20,
                fontWeight: 700,
                margin: '0 0 16px 0',
              }}
            >
              Docker MCP Gateway
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                'Dynamic tool loading on demand',
                'Only active tools in context',
                'Lightweight catalog instead of full descriptions',
                'Container-isolated MCP servers',
              ].map((item, i) => (
                <motion.div
                  key={item}
                  custom={2.5 + i * 0.3}
                  variants={fadeUp}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: '#a1a1aa',
                    fontSize: 14,
                  }}
                >
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 5"
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {item}
                </motion.div>
              ))}
            </div>
            <motion.div
              custom={4.5}
              variants={scaleIn}
              style={{
                marginTop: 20,
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.25)',
                borderRadius: 10,
                padding: '12px 16px',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  color: '#10b981',
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                96%
              </span>
              <span
                style={{
                  color: '#10b981',
                  fontSize: 13,
                  marginLeft: 6,
                  opacity: 0.8,
                }}
              >
                token reduction
              </span>
            </motion.div>
          </motion.div>
        </div>

        {/* Architecture Flow */}
        <motion.div custom={5} variants={fadeUp} style={{ marginBottom: 48 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <span
              style={{
                color: '#71717a',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              Architecture Flow
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0,
              position: 'relative',
            }}
          >
            {/* AI Agent Node */}
            <motion.div
              custom={5.5}
              variants={scaleIn}
              style={{
                background:
                  'linear-gradient(135deg, #1a1a2e, #16162a)',
                border: '1px solid #2d2d4a',
                borderRadius: 16,
                padding: '24px 28px',
                textAlign: 'center',
                minWidth: 160,
                position: 'relative',
                zIndex: 2,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
              <div
                style={{
                  color: '#fafafa',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                AI Agent
              </div>
              <div style={{ color: '#71717a', fontSize: 12, marginTop: 4 }}>
                Claude / Cursor
              </div>
            </motion.div>

            {/* Arrow 1 */}
            <motion.div custom={6} variants={fadeUp}>
              <svg width={80} height={40} viewBox="0 0 80 40">
                <defs>
                  <linearGradient
                    id="arrowGrad1"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="#3b3b5c" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
                <motion.path
                  d="M5 20 L65 20"
                  stroke="url(#arrowGrad1)"
                  strokeWidth={2}
                  fill="none"
                  custom={6}
                  variants={drawLine}
                />
                <motion.path
                  d="M60 14 L70 20 L60 26"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="none"
                  custom={6.5}
                  variants={drawLine}
                />
              </svg>
            </motion.div>

            {/* MCP Gateway Node */}
            <motion.div
              custom={6.5}
              variants={scaleIn}
              style={{
                background:
                  'linear-gradient(135deg, #0a2a1a, #0d1f14)',
                border: '2px solid rgba(16,185,129,0.35)',
                borderRadius: 16,
                padding: '24px 32px',
                textAlign: 'center',
                minWidth: 180,
                position: 'relative',
                zIndex: 2,
                boxShadow: '0 0 40px rgba(16,185,129,0.08)',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>🐳</div>
              <div
                style={{
                  color: '#10b981',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                MCP Gateway
              </div>
              <div
                style={{
                  color: '#6ee7b7',
                  fontSize: 11,
                  marginTop: 4,
                  opacity: 0.7,
                }}
              >
                Dynamic Tool Router
              </div>
            </motion.div>

            {/* Arrow 2 */}
            <motion.div custom={7} variants={fadeUp}>
              <svg width={80} height={40} viewBox="0 0 80 40">
                <defs>
                  <linearGradient
                    id="arrowGrad2"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#3b3b5c" />
                  </linearGradient>
                </defs>
                <motion.path
                  d="M5 20 L65 20"
                  stroke="url(#arrowGrad2)"
                  strokeWidth={2}
                  fill="none"
                  custom={7}
                  variants={drawLine}
                />
                <motion.path
                  d="M60 14 L70 20 L60 26"
                  stroke="#3b3b5c"
                  strokeWidth={2}
                  fill="none"
                  custom={7.5}
                  variants={drawLine}
                />
              </svg>
            </motion.div>

            {/* Containers Grid */}
            <motion.div
              custom={7.5}
              variants={scaleIn}
              style={{
                background:
                  'linear-gradient(135deg, #141414, #1a1a1a)',
                border: '1px solid #2a2a2a',
                borderRadius: 16,
                padding: '20px 24px',
                minWidth: 300,
              }}
            >
              <div
                style={{
                  color: '#71717a',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  marginBottom: 14,
                  textAlign: 'center',
                }}
              >
                Docker Containers
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                }}
              >
                {containers.map((c, i) => (
                  <motion.div
                    key={c.label}
                    custom={8 + i * 0.15}
                    variants={scaleIn}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${c.color}33`,
                      borderRadius: 10,
                      padding: '10px 8px',
                      textAlign: 'center',
                      cursor: 'default',
                    }}
                    whileHover={{
                      scale: 1.05,
                      borderColor: `${c.color}88`,
                      transition: { duration: 0.2 },
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>
                      {c.icon}
                    </div>
                    <div
                      style={{
                        color: '#d4d4d8',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {c.label}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Token Comparison Bar */}
        <motion.div
          custom={9}
          variants={fadeUp}
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 48,
            padding: '0 20px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span
                style={{ color: '#a1a1aa', fontSize: 12, fontWeight: 600 }}
              >
                Without Gateway
              </span>
              <span
                style={{ color: '#ef4444', fontSize: 12, fontWeight: 700 }}
              >
                ~25,000 tokens/turn
              </span>
            </div>
            <div
              style={{
                height: 12,
                background: '#1a1a1a',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ delay: 2, duration: 1, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background:
                    'linear-gradient(90deg, #ef4444, #dc2626)',
                  borderRadius: 6,
                }}
              />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span
                style={{ color: '#a1a1aa', fontSize: 12, fontWeight: 600 }}
              >
                With MCP Gateway
              </span>
              <span
                style={{ color: '#10b981', fontSize: 12, fontWeight: 700 }}
              >
                ~156 tokens/turn
              </span>
            </div>
            <div
              style={{
                height: 12,
                background: '#1a1a1a',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '4%' }}
                transition={{ delay: 2.3, duration: 0.6, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background:
                    'linear-gradient(90deg, #10b981, #059669)',
                  borderRadius: 6,
                  minWidth: 6,
                }}
              />
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
          }}
        >
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              custom={10 + i * 0.2}
              variants={scaleIn}
              style={{
                background: stat.accent
                  ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.03))'
                  : 'rgba(255,255,255,0.02)',
                border: stat.accent
                  ? '1px solid rgba(16,185,129,0.2)'
                  : '1px solid #1f1f1f',
                borderRadius: 14,
                padding: '24px 20px',
                textAlign: 'center',
              }}
              whileHover={{
                y: -4,
                transition: { duration: 0.2 },
              }}
            >
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: stat.accent ? '#10b981' : '#fafafa',
                  lineHeight: 1,
                  marginBottom: 8,
                }}
              >
                {stat.value}
              </div>
              <div
                style={{ color: '#71717a', fontSize: 13, fontWeight: 500 }}
              >
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Footer */}
        <motion.div
          custom={11}
          variants={fadeUp}
          style={{
            textAlign: 'center',
            marginTop: 40,
            paddingTop: 24,
            borderTop: '1px solid #1a1a1a',
          }}
        >
          <span style={{ color: '#52525b', fontSize: 13 }}>
            Powered by{' '}
            <span style={{ color: '#10b981', fontWeight: 600 }}>
              Docker MCP Toolkit
            </span>{' '}
            &mdash; One gateway, all your MCP servers, zero bloat.
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
