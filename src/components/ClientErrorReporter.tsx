'use client';

import { useEffect } from 'react';
import { installGlobalErrorReporting } from '@/lib/report-client-error';

/**
 * PROD-7 — installs window-level error reporting for the whole app.
 *
 * React error boundaries only see errors thrown during render, in lifecycle
 * methods or in effects. They do not see a throw from an event handler, a
 * setTimeout callback, a script that failed to load, or a promise nobody
 * awaited — which between them are a large share of real browser failures.
 *
 * Renders nothing; it exists for its effect.
 */
export function ClientErrorReporter() {
  useEffect(() => installGlobalErrorReporting(), []);
  return null;
}
