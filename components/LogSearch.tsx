'use client';
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SearchResult {
  id: number;
  agent_id: string;
  agent_name: string;
  timestamp: number;
  stream: string;
  content: string;
}

export function LogSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data.results || []);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="search across all agent logs..."
            className="pl-8 font-mono text-xs h-8 bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setSearched(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {searching && <div className="text-[10px] font-mono text-zinc-600">searching...</div>}

      {searched && !searching && (
        <div className="text-[10px] font-mono text-zinc-600">{results.length} result{results.length !== 1 ? 's' : ''}</div>
      )}

      {results.length > 0 && (
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {results.map((r) => (
            <div key={r.id} className="px-2.5 py-1.5 rounded border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition-colors">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-mono text-emerald-500">{r.agent_name}</span>
                <span className={`text-[9px] font-mono px-1 rounded ${r.stream === 'stderr' ? 'bg-red-950 text-red-400' : 'bg-zinc-800 text-zinc-500'}`}>{r.stream}</span>
                <span className="text-[9px] font-mono text-zinc-700">{new Date(r.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="font-mono text-[11px] text-zinc-300 break-all">{r.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
