'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Project error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 bg-background text-foreground text-center rounded-xl border border-border m-4 shadow-sm">
      <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
          <path d="M12 9v4"></path>
          <path d="M12 17h.01"></path>
        </svg>
      </div>
      <h2 className="text-lg font-bold mb-2">Error Loading Project</h2>
      <p className="text-muted-foreground text-sm max-w-md mb-6">
        We couldn't load this project. It might have been deleted, or you might not have permission to view it.
      </p>

      {process.env.NODE_ENV === 'development' && (
        <div className="mb-6 max-w-2xl text-left bg-slate-100 dark:bg-slate-900 p-4 rounded-lg overflow-auto w-full">
          <pre className="text-xs text-amber-600 dark:text-amber-400 font-mono">
            {error.message}
          </pre>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium text-sm transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
