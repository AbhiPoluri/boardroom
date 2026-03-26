'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
        <h2 className="text-xl font-semibold text-red-400 mb-2">Something went wrong</h2>
        <p className="text-zinc-400 text-sm mb-6">
          {error.message || 'An unexpected error occurred.'}
        </p>
        {error.digest && (
          <p className="text-zinc-600 text-xs mb-4 font-mono">digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm rounded-md transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
