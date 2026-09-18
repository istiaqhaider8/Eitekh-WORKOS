'use client';

import React, { useState, useEffect } from 'react';
import {
  Eye,
  Search,
  KeyRound,
  Shield,
  FolderGit2,
  Building2,
  CheckCircle2,
  Lock,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface InspectorTabProps {
  orgId: string;
  selectedUserId?: string;
  projects?: any[];
  selectedProjectId?: string;
}

export function InspectorTab({
  orgId,
  selectedUserId,
  projects = [],
  selectedProjectId = 'ALL',
}: InspectorTabProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>(selectedUserId || '');
  const [inspectorProjectId, setInspectorProjectId] = useState<string>(selectedProjectId || 'ALL');
  const [loading, setLoading] = useState(false);
  const [inspectData, setInspectData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('ALL');
  const [selectedTracePerm, setSelectedTracePerm] = useState<any>(null);

  useEffect(() => {
    if (selectedProjectId) {
      setInspectorProjectId(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Load user directory for picker
  useEffect(() => {
    async function loadUsers() {
      try {
        const res = await fetch(`/api/pbac/users?orgId=${orgId}&limit=all`);
        if (res.ok) {
          const json = await res.json();
          const userList = json.users || [];
          setUsers(userList);
          if (!targetUserId && userList.length > 0) {
            setTargetUserId(userList[0].id);
          }
        }
      } catch (e) {
        console.error('Failed to load users for inspector', e);
      }
    }
    loadUsers();
  }, [orgId, targetUserId]);

  // Load Inspection for Target User
  useEffect(() => {
    if (!targetUserId) return;
    setLoading(true);
    async function fetchInspection() {
      try {
        const projectParam = inspectorProjectId && inspectorProjectId !== 'ALL' ? `&projectId=${inspectorProjectId}` : '';
        const res = await fetch(`/api/pbac/inspector?orgId=${orgId}&userId=${targetUserId}${projectParam}`);
        if (res.ok) {
          const json = await res.json();
          setInspectData(json);
          if (json.provenanceTraces?.length > 0) {
            setSelectedTracePerm(json.provenanceTraces[0]);
          }
        } else {
          setInspectData(null);
        }
      } catch (e: any) {
        showError('Failed to inspect user access');
      } finally {
        setLoading(false);
      }
    }
    fetchInspection();
    const handleUpdate = () => {
      fetchInspection();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pbac:updated', handleUpdate);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pbac:updated', handleUpdate);
      }
    };
  }, [orgId, targetUserId, inspectorProjectId]);

  return (
    <div className="space-y-6">
      {/* Top Header & User + Project Selector */}
      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Eye className="w-4 h-4 text-indigo-600" />
            Effective Access Inspector & Provenance Trace
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Full deterministic evaluation of effective permissions with step-by-step "Why does this user have access?" reasoning.
          </p>
        </div>

        {/* User Search & Project Select */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-400 font-medium">User:</span>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer max-w-[180px] truncate"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {u.firstName} {u.lastName} ({u.email})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-400 font-medium">Target Project:</span>
            <select
              value={inspectorProjectId}
              onChange={(e) => setInspectorProjectId(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer max-w-[200px] truncate"
            >
              <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                🌐 All Projects (Global Scope)
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  🎯 {p.name} ({p.key})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-500 bg-white dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800">
          Evaluating user access provenance...
        </div>
      ) : !inspectData ? (
        <div className="p-12 text-center text-xs text-slate-500 bg-white dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800">
          Select a user to inspect effective access.
        </div>
      ) : (
        <div className="space-y-6">
          {/* User Profile Summary */}
          <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                User Identity
              </span>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {inspectData.user?.name || `${inspectData.user?.firstName || ''} ${inspectData.user?.lastName || ''}`.trim() || 'User'}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">{inspectData.user?.email}</div>
              <div className="text-[10px] text-slate-500 font-mono">ID: {inspectData.user?.id}</div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Assigned Permission Roles ({inspectData.assignedRoles?.length || 0})
              </span>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {inspectData.assignedRoles?.map((r: any) => (
                  <span
                    key={r.id}
                    className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-semibold rounded text-[10px]"
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Effective Capabilities
              </span>
              <div className="text-xl font-bold text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                {inspectData.totalEffectivePermissions ?? inspectData.effectivePermissionsCount ?? 0}
              </div>
              <p className="text-[10px] text-slate-500">Deduplicated from active roles</p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Resource Scope
              </span>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {inspectData.accessibleProjects?.length || 0} Projects • {inspectData.accessibleWorkspaces?.length || 0} Workspaces
              </div>
              <p className="text-[10px] text-slate-500">Where capabilities are active</p>
            </div>
          </div>

          {/* Provenance "Why does this user have access?" Explorer */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: 18 Modules Permission Accordion */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Granted Capabilities by Module (18 Categories)
                </h4>
                <span className="text-[11px] text-slate-500">Click capability to inspect trace</span>
              </div>

              <div className="space-y-3">
                {inspectData.permissionsByCategory?.map((cat: any) => {
                  const grantedCount = cat.grantedPermissions?.length || 0;
                  if (grantedCount === 0) return null;

                  return (
                    <div
                      key={cat.id}
                      className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
                    >
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{cat.name}</span>
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 rounded text-[10px] font-bold">
                          {grantedCount} Granted
                        </span>
                      </div>

                      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cat.grantedPermissions.map((p: any) => {
                          const isSelected = selectedTracePerm?.permissionKey === p.key;

                          return (
                            <div
                              key={p.key}
                              onClick={() => {
                                const trace = inspectData.provenanceTraces?.find(
                                  (t: any) => t.permissionKey === p.key
                                );
                                if (trace) setSelectedTracePerm(trace);
                              }}
                              className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all space-y-1 ${
                                isSelected
                                  ? 'bg-indigo-600/15 border-indigo-500 text-slate-900 dark:text-slate-100 shadow-xs'
                                  : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{p.label}</span>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">{p.key}</div>
                              <div className="text-[9px] text-indigo-600 pt-0.5">
                                Origin: {p.sources?.map((s: any) => s.roleName).join(' + ') || 'Role'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Step-by-Step Provenance Trace */}
            <div className="lg:col-span-5 space-y-4">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                "Why Does This User Have Access?" Provenance Tree
              </h4>

              {selectedTracePerm ? (
                <div className="bg-white dark:bg-slate-900 border border-indigo-500/30 rounded-xl p-5 space-y-4 shadow-xs sticky top-4">
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                      Evaluated Capability
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {selectedTracePerm.permissionLabel}
                    </h4>
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                      {selectedTracePerm.permissionKey}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                      Authorization Step-by-Step Path
                    </span>

                    {selectedTracePerm.tracePath?.map((step: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-3 text-xs">
                        <div className="w-5 h-5 rounded-full bg-indigo-600/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <div className="p-2.5 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 flex-1 leading-relaxed">
                          {typeof step === 'string' ? (
                            step
                          ) : step && typeof step === 'object' ? (
                            <div className="space-y-0.5">
                              {step.node && (
                                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                                  {step.node}
                                </div>
                              )}
                              <div className="text-slate-800 dark:text-slate-200">{step.detail || JSON.stringify(step)}</div>
                            </div>
                          ) : (
                            String(step)
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs space-y-1">
                    <div className="font-bold text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Deterministic Authorization Verified
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      User actively satisfies all role requirements and holds active project membership. Access is securely authorized.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
                  Select any permission on the left to view its detailed authorization chain.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
