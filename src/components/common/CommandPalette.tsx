"use client";

import React, { useState, useEffect } from "react";
import { Search, X, Layers, Plus, Kanban, ListTodo, Shield, LogOut, FolderGit2, MessageSquare, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { isIssueDone, getIssueKeyClass } from "@/lib/designSystem";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  issues: any[];
  projects: any[];
  onSelectIssue: (issue: any) => void;
  onCreateIssue: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  issues,
  projects,
  onSelectIssue,
  onCreateIssue,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<{ issues: any[]; comments: any[]; projects: any[] } | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        isOpen ? onClose() : undefined;
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Asynchronous debounced search
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setRemoteResults(null);
      setSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setRemoteResults(data);
        }
      } catch (err) {
        console.error("Command palette search error:", err);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  const localFilteredIssues = issues.filter(
    (i) =>
      i.issueKey.toLowerCase().includes(query.toLowerCase()) ||
      i.title.toLowerCase().includes(query.toLowerCase())
  );

  const displayIssues = remoteResults?.issues || localFilteredIssues;
  const displayProjects = remoteResults?.projects || [];
  const displayComments = remoteResults?.comments || [];

  return (
    <div 
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-start justify-center pt-24 z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-slate-300 dark:border-slate-800">
          <Search className="w-5 h-5 text-slate-500 dark:text-slate-400 mr-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type an issue key, title, or action..."
            autoFocus
            className="w-full py-3.5 bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none"
          />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Actions */}
        <div className="p-2 border-b border-slate-300 dark:border-slate-800/80 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-3">
          Quick Actions
        </div>
        <div className="p-1 space-y-0.5">
          <button
            onClick={() => {
              onCreateIssue();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4 text-blue-500" />
            <span>Create new issue</span>
            <kbd className="ml-auto font-mono text-[10px] text-slate-500 dark:text-slate-400">C</kbd>
          </button>
          <button
            onClick={() => {
              router.push("/super-admin");
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 rounded-lg cursor-pointer"
          >
            <Shield className="w-4 h-4 text-amber-500" />
            <span>Switch to Super Admin Governance</span>
          </button>
        </div>

        {/* Search Results */}
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
          {searching && (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span>Searching across workspace...</span>
            </div>
          )}

          {/* Issues Section */}
          {!searching && displayIssues.length > 0 && (
            <div className="p-2">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-2 py-1">
                Issues ({displayIssues.length})
              </div>
              <div className="space-y-0.5">
                {displayIssues.map((issue) => (
                  <button
                    key={issue.id}
                    onClick={() => {
                      onSelectIssue(issue);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={getIssueKeyClass(isIssueDone(issue), "shrink-0")}>{issue.issueKey}</span>
                      <span className="truncate">{issue.title}</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">
                      {issue.status?.name || "Open"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Projects Section */}
          {!searching && displayProjects.length > 0 && (
            <div className="p-2">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-2 py-1">
                Projects ({displayProjects.length})
              </div>
              <div className="space-y-0.5">
                {displayProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      router.push(`/projects/${p.id}`);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FolderGit2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">({p.key})</span>
                    </div>
                    <span className="text-[10px] text-blue-600 font-medium">Open Project →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments Section */}
          {!searching && displayComments.length > 0 && (
            <div className="p-2">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-2 py-1">
                Comments ({displayComments.length})
              </div>
              <div className="space-y-0.5">
                {displayComments.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (c.issue) {
                        onSelectIssue(c.issue);
                        onClose();
                      }
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <MessageSquare className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="font-mono text-blue-600 font-semibold">{c.issue?.issueKey}:</span>
                      <span className="truncate italic text-slate-600 dark:text-slate-300">"{c.content}"</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!searching && query.trim() && displayIssues.length === 0 && displayProjects.length === 0 && displayComments.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No results found matching "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
