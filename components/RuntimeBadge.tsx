/**
 * Tiny visual chip identifying which runtime a persona uses
 * (claude / hermes / codex / opencode). Render anywhere a persona surfaces
 * so it's obvious at a glance which CLI will actually run when the persona
 * wakes.
 *
 * The dot color and label come from RUNTIME_STYLE — keep it in one place so
 * every surface (cards, lists, detail header) reads the same scheme.
 */
/** Runtime kinds personas can run on. Narrower than the global AgentType
 *  union — which also covers internal 'custom' / 'test' agent rows. */
export type PersonaRuntime = 'claude' | 'hermes' | 'codex' | 'opencode';

export const RUNTIME_STYLE: Record<PersonaRuntime, { color: string; label: string; tagline: string }> = {
  claude:   { color: '#E89151', label: 'claude',   tagline: 'Anthropic Claude (default)' },
  hermes:   { color: '#B084EB', label: 'hermes',   tagline: 'Hermes via OpenRouter' },
  codex:    { color: '#10A37F', label: 'codex',    tagline: 'OpenAI Codex CLI' },
  opencode: { color: '#6B7280', label: 'opencode', tagline: 'Open-source agent CLI' },
};

const VALID: PersonaRuntime[] = ['claude', 'hermes', 'codex', 'opencode'];
function normalize(value: string | null | undefined): PersonaRuntime {
  if (!value) return 'claude';
  return (VALID as string[]).includes(value) ? (value as PersonaRuntime) : 'claude';
}

export function RuntimeBadge({
  agentType,
  compact,
  withTooltip = true,
}: {
  agentType: string | null | undefined;
  compact?: boolean;
  withTooltip?: boolean;
}) {
  const kind = normalize(agentType);
  const { color, label, tagline } = RUNTIME_STYLE[kind];
  return (
    <span
      title={withTooltip ? tagline : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '1px 4px' : '2px 8px',
        border: `1px solid ${color}`,
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontSize: compact ? 9 : 10,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono, monospace)',
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          width: compact ? 4 : 5,
          height: compact ? 4 : 5,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {!compact && label}
    </span>
  );
}
