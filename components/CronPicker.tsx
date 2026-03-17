'use client';

import React, { useState } from 'react';
import { describeCron, isValidCron, getNextRunDescription } from '@/lib/cron-utils';

interface CronPickerProps {
  value: string;
  onChange: (expr: string) => void;
  className?: string;
}

const PRESETS = [
  { label: 'every 5 min', value: '*/5 * * * *' },
  { label: 'every 15 min', value: '*/15 * * * *' },
  { label: 'every 30 min', value: '*/30 * * * *' },
  { label: 'hourly', value: '0 * * * *' },
  { label: 'every 6h', value: '0 */6 * * *' },
  { label: 'daily 9am', value: '0 9 * * *' },
  { label: 'daily midnight', value: '0 0 * * *' },
  { label: 'weekdays 9am', value: '0 9 * * 1-5' },
  { label: 'weekly mon', value: '0 9 * * 1' },
  { label: 'monthly 1st', value: '0 0 1 * *' },
];

const MINUTE_OPTIONS = [
  { label: 'every min', value: '*' },
  { label: 'every 5 min', value: '*/5' },
  { label: 'every 10 min', value: '*/10' },
  { label: 'every 15 min', value: '*/15' },
  { label: 'every 30 min', value: '*/30' },
  ...Array.from({ length: 60 }, (_, i) => ({ label: `:${String(i).padStart(2, '0')}`, value: String(i) })),
];

const HOUR_OPTIONS = [
  { label: 'every hour', value: '*' },
  { label: 'every 2h', value: '*/2' },
  { label: 'every 6h', value: '*/6' },
  ...Array.from({ length: 24 }, (_, i) => {
    const h = i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`;
    return { label: h, value: String(i) };
  }),
];

const DAY_OPTIONS = [
  { label: 'every day', value: '*' },
  ...Array.from({ length: 31 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) })),
];

const MONTH_OPTIONS = [
  { label: 'every month', value: '*' },
  ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => ({
    label: m, value: String(i + 1),
  })),
];

const WEEKDAY_OPTIONS = [
  { label: 'every day', value: '*' },
  { label: 'weekdays', value: '1-5' },
  { label: 'weekends', value: '0,6' },
  ...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => ({
    label: d, value: String(i),
  })),
];

type Tab = 'presets' | 'custom' | 'raw';

export default function CronPicker({ value, onChange, className }: CronPickerProps) {
  const [tab, setTab] = useState<Tab>('presets');
  const [rawInput, setRawInput] = useState(value);

  const valid = isValidCron(value);
  const description = describeCron(value);
  const nextRun = getNextRunDescription(value);

  // Parse current value into fields for custom tab
  const parts = value.trim().split(/\s+/);
  const fields = parts.length === 5 ? parts : ['*', '*', '*', '*', '*'];

  const updateField = (idx: number, val: string) => {
    const next = [...fields];
    next[idx] = val;
    onChange(next.join(' '));
  };

  return (
    <div className={`space-y-2 ${className || ''}`}>
      {/* Tab bar */}
      <div className="flex gap-1">
        {(['presets', 'custom', 'raw'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              if (t === 'raw') setRawInput(value);
            }}
            className={`px-2.5 py-1 rounded text-[10px] font-mono border transition-colors ${
              tab === t
                ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                : 'bg-transparent border-transparent text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Presets tab */}
      {tab === 'presets' && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                value === p.value
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom tab */}
      {tab === 'custom' && (
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'minute', options: MINUTE_OPTIONS, idx: 0 },
            { label: 'hour', options: HOUR_OPTIONS, idx: 1 },
            { label: 'day', options: DAY_OPTIONS, idx: 2 },
            { label: 'month', options: MONTH_OPTIONS, idx: 3 },
            { label: 'weekday', options: WEEKDAY_OPTIONS, idx: 4 },
          ].map(({ label, options, idx }) => (
            <div key={label} className="space-y-1">
              <span className="text-[9px] font-mono text-zinc-600 block">{label}</span>
              <select
                value={fields[idx]}
                onChange={(e) => updateField(idx, e.target.value)}
                className="w-full h-7 text-[10px] font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-300 px-1 focus:border-emerald-800 focus:outline-none appearance-none cursor-pointer"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Raw tab */}
      {tab === 'raw' && (
        <input
          type="text"
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value);
            const trimmed = e.target.value.trim();
            if (trimmed.split(/\s+/).length === 5) {
              onChange(trimmed);
            }
          }}
          onBlur={() => {
            const trimmed = rawInput.trim();
            if (trimmed.split(/\s+/).length === 5) {
              onChange(trimmed);
            }
          }}
          placeholder="* * * * *"
          spellCheck={false}
          className="w-full h-8 text-sm font-mono bg-zinc-900 border border-zinc-700 rounded px-3 text-zinc-100 placeholder:text-zinc-700 focus:border-emerald-800 focus:outline-none"
        />
      )}

      {/* Description + validation */}
      <div className="flex items-center gap-2 min-h-[20px]">
        <span className={`text-[10px] font-mono ${valid ? 'text-zinc-500' : 'text-red-400'}`}>
          {valid ? description : 'invalid cron expression'}
        </span>
        {valid && nextRun && (
          <>
            <span className="text-zinc-700 text-[10px]">&middot;</span>
            <span className="text-[10px] font-mono text-zinc-600">{nextRun}</span>
          </>
        )}
        <span className={`ml-auto w-1.5 h-1.5 rounded-full ${valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
      </div>
    </div>
  );
}
