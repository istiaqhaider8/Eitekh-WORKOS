'use client';

import React, { useState, useEffect } from 'react';
import { SystemRefreshCacheView } from '@/components/admin/SystemRefreshCacheView';

export default function SystemCacheSettingsPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentOrg, setCurrentOrg] = useState<any>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
          if (data.user.organizations?.length > 0) {
            setCurrentOrg(data.user.organizations[0]?.organization || data.user.organizations[0]);
          }
        }
      })
      .catch((err) => console.error('Failed to load user', err));
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">
          System Refresh & Cache Management
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Perform safe cache clearing, data re-synchronization, and PBAC capability re-evaluations.
        </p>
      </div>

      <SystemRefreshCacheView
        orgId={currentOrg?.id}
      />
    </div>
  );
}
