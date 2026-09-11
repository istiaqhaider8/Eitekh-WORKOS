"use client";

import React, { useState, useEffect } from "react";
import { AccessGovernanceView } from "@/components/admin/AccessGovernanceView";

export default function RolesAndPermissionsPage() {
  const [currentOrgId, setCurrentOrgId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user?.organizations?.length > 0) {
          setCurrentOrgId(data.user.organizations[0].id);
        }
      })
      .catch((err) => {
        console.error("Error fetching user organization for PBAC settings", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading Access Governance & Permission Roles...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AccessGovernanceView initialOrgId={currentOrgId} showHeader={true} />
    </div>
  );
}
