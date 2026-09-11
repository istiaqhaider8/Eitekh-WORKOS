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
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 bg-background text-foreground text-center">
      <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <h2 className="text-xl font-bold mb-2">Something went wrong!</h2>
      <p className="text-muted-foreground text-sm max-w-md mb-6">
        An unexpected error occurred. Our team has been notified. Please try again or refresh the page.
      </p>
      
      {process.env.NODE_ENV === 'development' && (
        <div className="mb-6 max-w-2xl text-left bg-slate-100 dark:bg-slate-900 p-4 rounded-lg overflow-auto">
          <pre className="text-xs text-red-600 dark:text-red-400 font-mono">
            {error.message}
            {'\n'}
            {error.stack}
          </pre>
        </div>
      )}

      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
