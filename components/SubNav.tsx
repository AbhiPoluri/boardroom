import Link from 'next/link';

interface SubNavTab {
  label: string;
  href: string;
  active: boolean;
}

export function SubNav({ tabs }: { tabs: SubNavTab[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {tabs.map(t => (
        <Link
          key={t.href}
          href={t.href}
          className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
            t.active
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
