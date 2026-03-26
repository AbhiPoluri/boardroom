'use client';

import { useEffect } from 'react';

export default function GlobalError({
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
    <html>
      <body style={{ margin: 0, backgroundColor: '#09090b', fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '448px',
              width: '100%',
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: '8px',
              padding: '32px',
              textAlign: 'center',
            }}
          >
            <h2 style={{ color: '#f87171', fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
              Critical error
            </h2>
            <p style={{ color: '#a1a1aa', fontSize: '14px', marginBottom: '24px' }}>
              {error.message || 'A fatal error occurred in the application.'}
            </p>
            {error.digest && (
              <p style={{ color: '#52525b', fontSize: '12px', fontFamily: 'monospace', marginBottom: '16px' }}>
                digest: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                padding: '8px 16px',
                backgroundColor: '#3f3f46',
                color: '#f4f4f5',
                fontSize: '14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
