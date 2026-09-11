'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl p-1.5 flex items-center justify-center text-slate-400">
        <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }

  const isDark = resolvedTheme === 'dark' || theme === 'dark';

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 md:p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-xl transition-all duration-200 cursor-pointer relative group shadow-2xs"
      title={`Switch to ${isDark ? 'Light' : 'Dark'} Theme`}
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 group-hover:rotate-45 group-hover:scale-110 transition-transform duration-300" />
      ) : (
        <Moon className="w-4 h-4 text-slate-600 group-hover:-rotate-12 group-hover:scale-110 transition-transform duration-300" />
      )}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
