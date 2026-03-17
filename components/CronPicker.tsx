'use client';

import React, { useState, useEffect } from 'react';
import { describeCron, isValidCron, getNextRunDescription } from '@/lib/cron-utils';

interface CronPickerProps {
  value: string;
  onChange: (expr: string) => void;
  className?: string;
}

type Mode = 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly';

const MINUTE_INTERVALS = [1, 2, 5, 10, 15, 20, 30];
const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES_OF_HOUR = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const QUICK_PRESETS = [
  { label: 'every 15 min', value: '*/15 * * * *' },
  { label: 'hourly', value: '0 * * * *' },
  { label: 'daily 9am', value: '0 9 * * *' },
  { label: 'weekdays 9am', value: '0 9 * * 1-5' },
  { label: 'weekly mon', value: '0 9 * * 1' },
  { label: 'monthly 1st', value: '0 0 1 * *' },
];

function to24h(hour12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function to12h(hour24: number): { hour: number; ampm: 'AM' | 'PM' } {
  if (hour24 === 0) return { hour: 12, ampm: 'AM' };
  if (hour24 < 12) return { hour: hour24, ampm: 'AM' };
  if (hour24 === 12) return { hour: 12, ampm: 'PM' };
  return { hour: hour24 - 12, ampm: 'PM' };
}

function detectMode(expr: string): Mode {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return 'daily';
  const [min, hr, dom, , dow] = p;
  if (min.startsWith('*/') && hr === '*' && dom === '*') return 'minutes';
  if (min === '0' && hr.startsWith('*/') && dom === '*') return 'hours';
  if (dom !== '*') return 'monthly';
  if (dow !== '*') return 'weekly';
  return 'daily';
}

function parseMinuteInterval(expr: string): number {
  const m = expr.match(/^\*\/(\d+)/);
  return m ? parseInt(m[1]) : 15;
}

function parseHourInterval(expr: string): number {
  const p = expr.split(/\s+/);
  const m = p[1]?.match(/^\*\/(\d+)/);
  return m ? parseInt(m[1]) : 1;
}

function parseTime(expr: string): { hour: number; minute: number } {
  const p = expr.trim().split(/\s+/);
  return {
    minute: parseInt(p[0]) || 0,
    hour: parseInt(p[1]) || 9,
  };
}

function parseDow(expr: string): number[] {
  const p = expr.trim().split(/\s+/);
  const dow = p[4] || '*';
  if (dow === '*') return [0, 1, 2, 3, 4, 5, 6];
  if (dow === '1-5') return [1, 2, 3, 4, 5];
  return dow.split(',').map(Number).filter(n => !isNaN(n));
}

function parseDom(expr: string): number {
  const p = expr.trim().split(/\s+/);
  return parseInt(p[2]) || 1;
}

function buildExpr(mode: Mode, state: BuilderState): string {
  const { minuteInterval, hourInterval, hour24, minute, dowDays, dom } = state;
  switch (mode) {
    case 'minutes': return `*/${minuteInterval} * * * *`;
    case 'hours':   return `0 */${hourInterval} * * *`;
    case 'daily':   return `${minute} ${hour24} * * *`;
    case 'weekly': {
      const dowStr = dowDays.length === 7 ? '*'
        : dowDays.length === 0 ? '*'
        : dowDays.sort((a, b) => a - b).join(',');
      return `${minute} ${hour24} * * ${dowStr}`;
    }
    case 'monthly': return `${minute} ${hour24} ${dom} * *`;
  }
}

interface BuilderState {
  minuteInterval: number;
  hourInterval: number;
  hour24: number;
  minute: number;
  ampm: 'AM' | 'PM';
  hour12: number;
  dowDays: number[];
  dom: number;
}

function stateFromExpr(expr: string, mode: Mode): BuilderState {
  const { hour, minute } = parseTime(expr);
  const { hour: hour12, ampm } = to12h(hour);
  return {
    minuteInterval: parseMinuteInterval(expr),
    hourInterval: parseHourInterval(expr),
    hour24: hour,
    minute,
    ampm,
    hour12,
    dowDays: mode === 'weekly' ? parseDow(expr) : [1, 2, 3, 4, 5],
    dom: parseDom(expr),
  };
}

export default function CronPicker({ value, onChange, className }: CronPickerProps) {
  const [mode, setMode] = useState<Mode>(() => detectMode(value));
  const [state, setState] = useState<BuilderState>(() => stateFromExpr(value, detectMode(value)));
  const [showRaw, setShowRaw] = useState(false);
  const [rawInput, setRawInput] = useState(value);

  // Sync rawInput when value changes externally
  useEffect(() => { setRawInput(value); }, [value]);

  const valid = isValidCron(value);
  const description = describeCron(value);
  const nextRun = getNextRunDescription(value);

  const update = (newMode: Mode, newState: BuilderState) => {
    const expr = buildExpr(newMode, newState);
    onChange(expr);
  };

  const setStateAndEmit = (patch: Partial<BuilderState>, overrideMode?: Mode) => {
    const next = { ...state, ...patch };
    setState(next);
    update(overrideMode ?? mode, next);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    update(m, state);
  };

  const setHour = (h12: number, ap: 'AM' | 'PM') => {
    const h24 = to24h(h12, ap);
    setStateAndEmit({ hour12: h12, ampm: ap, hour24: h24 });
  };

  const toggleDow = (d: number) => {
    const next = state.dowDays.includes(d)
      ? state.dowDays.filter(x => x !== d)
      : [...state.dowDays, d];
    setStateAndEmit({ dowDays: next.length ? next : state.dowDays });
  };

  const MODES: { key: Mode; label: string }[] = [
    { key: 'minutes', label: 'minutes' },
    { key: 'hours',   label: 'hours' },
    { key: 'daily',   label: 'daily' },
    { key: 'weekly',  label: 'weekly' },
    { key: 'monthly', label: 'monthly' },
  ];

  return (
    <div className={`space-y-3 ${className || ''}`}>
      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => {
              onChange(p.value);
              setMode(detectMode(p.value));
              setState(stateFromExpr(p.value, detectMode(p.value)));
            }}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              value === p.value
                ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Mode selector */}
      <div className="flex rounded-md border border-zinc-800 overflow-hidden">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchMode(key)}
            className={`flex-1 py-1.5 text-[10px] font-mono transition-colors ${
              mode === key
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Builder area */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3">

        {/* ── MINUTES ── */}
        {mode === 'minutes' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-400 font-mono">every</span>
            <div className="flex gap-1.5 flex-wrap">
              {MINUTE_INTERVALS.map(n => (
                <button key={n} type="button"
                  onClick={() => setStateAndEmit({ minuteInterval: n })}
                  className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                    state.minuteInterval === n
                      ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                      : 'border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-zinc-400 font-mono">minutes</span>
          </div>
        )}

        {/* ── HOURS ── */}
        {mode === 'hours' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-400 font-mono">every</span>
            <div className="flex gap-1.5 flex-wrap">
              {HOUR_INTERVALS.map(n => (
                <button key={n} type="button"
                  onClick={() => setStateAndEmit({ hourInterval: n })}
                  className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                    state.hourInterval === n
                      ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                      : 'border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-zinc-400 font-mono">hour{state.hourInterval !== 1 ? 's' : ''}</span>
          </div>
        )}

        {/* ── DAILY ── */}
        {mode === 'daily' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-400 font-mono">every day at</span>
            <TimePicker hour12={state.hour12} minute={state.minute} ampm={state.ampm} onHourChange={(h) => setHour(h, state.ampm)} onMinuteChange={(m) => setStateAndEmit({ minute: m })} onAmpmChange={(ap) => setHour(state.hour12, ap)} />
          </div>
        )}

        {/* ── WEEKLY ── */}
        {mode === 'weekly' && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              {DAYS.map((d, i) => (
                <button key={d} type="button"
                  onClick={() => toggleDow(i)}
                  className={`w-9 h-9 rounded-full text-[11px] font-mono border transition-colors ${
                    state.dowDays.includes(i)
                      ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                      : 'border-zinc-700 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {d.slice(0, 2)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-mono">at</span>
              <TimePicker hour12={state.hour12} minute={state.minute} ampm={state.ampm} onHourChange={(h) => setHour(h, state.ampm)} onMinuteChange={(m) => setStateAndEmit({ minute: m })} onAmpmChange={(ap) => setHour(state.hour12, ap)} />
            </div>
          </div>
        )}

        {/* ── MONTHLY ── */}
        {mode === 'monthly' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-400 font-mono">day</span>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <button key={d} type="button"
                    onClick={() => setStateAndEmit({ dom: d })}
                    className={`w-7 h-7 rounded text-[11px] font-mono border transition-colors ${
                      state.dom === d
                        ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                        : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <span className="text-xs text-zinc-400 font-mono">of every month</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-mono">at</span>
              <TimePicker hour12={state.hour12} minute={state.minute} ampm={state.ampm} onHourChange={(h) => setHour(h, state.ampm)} onMinuteChange={(m) => setStateAndEmit({ minute: m })} onAmpmChange={(ap) => setHour(state.hour12, ap)} />
            </div>
          </div>
        )}
      </div>

      {/* Description + next run + raw toggle */}
      <div className="flex items-center gap-2 min-h-[20px]">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className={`text-[10px] font-mono ${valid ? 'text-zinc-400' : 'text-red-400'}`}>
          {valid ? description : 'invalid expression'}
        </span>
        {valid && nextRun && (
          <span className="text-[10px] font-mono text-zinc-600 ml-1">{nextRun}</span>
        )}
        <button
          type="button"
          onClick={() => setShowRaw(v => !v)}
          className="ml-auto text-[10px] font-mono text-zinc-700 hover:text-zinc-500 transition-colors"
        >
          {showRaw ? 'hide raw' : 'raw'}
        </button>
      </div>

      {/* Raw expression editor */}
      {showRaw && (
        <input
          type="text"
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value);
            const trimmed = e.target.value.trim();
            if (trimmed.split(/\s+/).length === 5) {
              onChange(trimmed);
              setMode(detectMode(trimmed));
              setState(stateFromExpr(trimmed, detectMode(trimmed)));
            }
          }}
          placeholder="* * * * *"
          spellCheck={false}
          className="w-full h-8 text-sm font-mono bg-zinc-950 border border-zinc-700 rounded px-3 text-zinc-300 placeholder:text-zinc-700 focus:border-emerald-800 focus:outline-none"
        />
      )}
    </div>
  );
}

// ── TimePicker sub-component ──────────────────────────────────────────────────
interface TimePickerProps {
  hour12: number;
  minute: number;
  ampm: 'AM' | 'PM';
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  onAmpmChange: (ap: 'AM' | 'PM') => void;
}

function TimePicker({ hour12, minute, ampm, onHourChange, onMinuteChange, onAmpmChange }: TimePickerProps) {
  const selClass = 'bg-zinc-950 border border-zinc-700 rounded text-xs font-mono text-zinc-200 px-2 py-1 focus:border-emerald-700 focus:outline-none cursor-pointer appearance-none';

  return (
    <div className="flex items-center gap-1">
      <select value={hour12} onChange={e => onHourChange(parseInt(e.target.value))} className={selClass}>
        {HOURS_12.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-zinc-600 font-mono text-xs">:</span>
      <select value={minute} onChange={e => onMinuteChange(parseInt(e.target.value))} className={selClass}>
        {MINUTES_OF_HOUR.map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <div className="flex rounded border border-zinc-700 overflow-hidden">
        {(['AM', 'PM'] as const).map(ap => (
          <button key={ap} type="button"
            onClick={() => onAmpmChange(ap)}
            className={`px-2 py-1 text-[10px] font-mono transition-colors ${
              ampm === ap ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {ap}
          </button>
        ))}
      </div>
    </div>
  );
}
