'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Shield,
  KeyRound,
  FileText,
  FileCode,
  Printer,
  X,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface AccessMatrixTabProps {
  orgId: string;
  roles: any[];
  projects?: any[];
  selectedProjectId?: string;
  onInspectUser: (userId: string) => void;
}

export function AccessMatrixTab({
  orgId,
  roles,
  projects = [],
  selectedProjectId = 'ALL',
  onInspectUser,
}: AccessMatrixTabProps) {
  const [matrixUsers, setMatrixUsers] = useState<any[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<'25' | '50' | '100' | '150' | '250' | '500' | 'all'>('25');

  // Export Modal State
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load Matrix Data
  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        orgId,
        search,
        roleId: roleFilter,
        status: statusFilter,
        projectId: selectedProjectId || 'ALL',
        page: String(page),
        limit: String(limit),
      });

      const res = await fetch(`/api/pbac/matrix?${query.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setMatrixUsers(json.users || []);
        setTotalRecords(json.totalRecords || 0);
      }
    } catch (e: any) {
      showError('Failed to load access matrix');
    } finally {
      setLoading(false);
    }
  }, [orgId, search, roleFilter, statusFilter, selectedProjectId, page, limit]);

  useEffect(() => {
    loadMatrix();
    const handleUpdate = () => {
      loadMatrix();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pbac:updated', handleUpdate);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pbac:updated', handleUpdate);
      }
    };
  }, [loadMatrix]);

  // Execute Export
  const handleExport = async (format: 'csv' | 'excel' | 'pdf') => {
    setExporting(true);
    try {
      const query = new URLSearchParams({
        orgId,
        format,
        search,
        roleId: roleFilter,
        projectId: selectedProjectId || 'ALL',
      });

      const res = await fetch(`/api/pbac/export?${query.toString()}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eitekh-access-matrix-${Date.now()}.${format === 'pdf' ? 'html' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showSuccess(`Exported matrix in ${format.toUpperCase()} format`);
      setIsExportOpen(false);
    } catch (e: any) {
      showError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = limit === 'all' ? 1 : Math.ceil(totalRecords / Number(limit));

  return (
    <div className="space-y-4">
      {/* Top Header & Actions */}
      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-indigo-400" />
            User Access Governance Matrix ({totalRecords} Governed Users)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Real-time matrix mapping governed existing users to assigned Permission Roles with full export capabilities.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span>Export Matrix</span>
          </button>
        </div>
      </div>

      {/* Filter & Pagination Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by user name, email, or User ID..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 font-medium">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer max-w-[140px]"
            >
              <option value="all" className="bg-white dark:bg-slate-900">All Roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900">
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-slate-900">All Statuses</option>
              <option value="ACTIVE" className="bg-white dark:bg-slate-900">ACTIVE</option>
              <option value="SUSPENDED" className="bg-white dark:bg-slate-900">SUSPENDED</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 font-medium">Rows:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value as any);
                setPage(1);
              }}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="25" className="bg-white dark:bg-slate-900">25</option>
              <option value="50" className="bg-white dark:bg-slate-900">50</option>
              <option value="100" className="bg-white dark:bg-slate-900">100</option>
              <option value="150" className="bg-white dark:bg-slate-900">150</option>
              <option value="250" className="bg-white dark:bg-slate-900">250</option>
              <option value="500" className="bg-white dark:bg-slate-900">500</option>
              <option value="all" className="bg-white dark:bg-slate-900">All</option>
            </select>
          </div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[200px]">User & Identity</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[120px]">Account Status</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[220px]">Assigned Permission Roles</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[140px]">Effective Perms</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[160px]">Resource Boundaries</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Loading access matrix...
                  </td>
                </tr>
              ) : matrixUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No users found matching your filters.
                  </td>
                </tr>
              ) : (
                matrixUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-850/60 transition-colors">
                    <td className="p-3">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{u.name}</div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400">{u.email}</div>
                      <div className="text-[10px] text-slate-500">{u.jobTitle} • {u.company}</div>
                    </td>

                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          u.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {u.assignedRoles && u.assignedRoles.length > 0 ? (
                          u.assignedRoles.map((r: any) => (
                            <span
                              key={r.id}
                              className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-semibold rounded text-[10px]"
                            >
                              {r.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">None</span>
                        )}
                      </div>
                    </td>

                    <td className="p-3">
                      <span className="font-mono font-bold text-indigo-400">
                        {u.effectivePermissionCount || 0}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-1">unique capabilities</span>
                    </td>

                    <td className="p-3">
                      <div className="text-slate-700 dark:text-slate-300 text-xs font-medium">
                        {u.projects?.length || 0} Projects Active
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {u.workspaces?.length || 0} Workspaces
                      </div>
                    </td>

                    <td className="p-3 text-right">
                      <button
                        onClick={() => onInspectUser(u.id)}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 flex items-center gap-1.5 ml-auto"
                      >
                        <Eye className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Inspect Provenance</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div>
            Showing <span className="font-bold text-slate-800 dark:text-slate-200">{matrixUsers.length}</span> of{' '}
            <span className="font-bold text-slate-800 dark:text-slate-200">{totalRecords}</span> governed users
          </div>

          {limit !== 'all' && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(1)}
                className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                First
              </button>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 font-semibold text-slate-800 dark:text-slate-200">
                Page {page} of {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                Last
              </button>
            </div>
          )}
        </div>
      </div>

      {/* EXPORT MODAL */}
      {isExportOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Download className="w-4 h-4 text-indigo-400" />
                Export Access Governance Matrix
              </h4>
              <button
                onClick={() => setIsExportOpen(false)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Export will include all <strong className="text-slate-800 dark:text-slate-200">{totalRecords} authorized records</strong> matching the active filter, including assigned roles and effective permissions count.
            </p>

            <div className="space-y-2 pt-2">
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting}
                className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>CSV Spreadsheet Format (.csv)</span>
                </div>
                <span className="text-[10px] text-slate-500">Universal RFC-4180</span>
              </button>

              <button
                onClick={() => handleExport('excel')}
                disabled={exporting}
                className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                  <span>Excel-Compatible Export (.csv)</span>
                </div>
                <span className="text-[10px] text-slate-500">Microsoft Excel / Numbers</span>
              </button>

              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting}
                className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <Printer className="w-4 h-4 text-purple-400" />
                  <span>Printable HTML / PDF Summary</span>
                </div>
                <span className="text-[10px] text-slate-500">Print to PDF</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-right">
              <button
                onClick={() => setIsExportOpen(false)}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
