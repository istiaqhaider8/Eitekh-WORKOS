'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

/**
 * PROD-7 — the last-resort boundary.
 *
 * `error.tsx` only catches errors below it in the tree; a failure in the root
 * layout itself bypasses it entirely and the user gets Next's built-in error
 * screen with nothing reported. This file did not exist, which meant the worst
 * class of client failure — the one that breaks the whole application shell —
 * was also the one nobody would hear about.
 *
 * It replaces <html> and <body>, so it cannot rely on the app's providers or
 * styling. Everything here is inline and self-contained on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      source: 'boundary',
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#0b0e14',
          color: '#e6e8eb',
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#9aa4b2', margin: '0 0 20px' }}>
            The application could not load. The error has been reported.
          </p>
          {/* The digest is the one thing that lets support tie this screen to a
              specific report, so it is shown rather than hidden. */}
          {error.digest ? (
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 20px' }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              borderRadius: 6,
              border: '1px solid #2b3240',
              background: '#161b25',
              color: '#e6e8eb',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
