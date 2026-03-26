import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="font-mono text-[120px] font-bold text-zinc-800 leading-none select-none">
          404
        </div>
        <div className="space-y-2">
          <p className="font-mono text-sm text-zinc-400">page not found</p>
          <p className="font-mono text-xs text-zinc-600">the route you requested doesn&apos;t exist</p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors font-mono text-xs"
        >
          back to fleet
        </Link>
      </div>
    </div>
  );
}
