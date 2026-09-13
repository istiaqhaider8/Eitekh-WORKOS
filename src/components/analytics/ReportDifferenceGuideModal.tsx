'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  CheckCircle2,
  Layers,
  Flame,
  TrendingUp,
  Users,
  Bug,
  AlertTriangle,
  Target,
  Compass,
  History,
  Briefcase,
  ArrowRight,
  Filter,
  ShieldCheck,
  Eye,
  FileSpreadsheet,
  Printer,
  Sparkles,
  HelpCircle
} from 'lucide-react';
import { CANONICAL_REPORTS, CANONICAL_REPORT_CATEGORIES, CanonicalReport } from './ReportCatalogConstants';

interface ReportDifferenceGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectReport?: (reportId: string, reportTitle: string) => void;
}

export function ReportDifferenceGuideModal({
  isOpen,
  onClose,
  onSelectReport,
}: ReportDifferenceGuideModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const filteredReports = useMemo(() => {
    return CANONICAL_REPORTS.filter((r) => {
      if (selectedCategory !== 'ALL' && r.category !== selectedCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.name.toLowerCase().includes(q) ||
        r.businessQuestion.toLowerCase().includes(q) ||
        r.distinctMatrix.toLowerCase().includes(q) ||
        r.targetAudience.toLowerCase().includes(q) ||
        r.scopeFilter.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [searchQuery, selectedCategory]);

  if (!isOpen) return null;

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'PROJECT': return Briefcase;
      case 'WORK': return Layers;
      case 'SPRINT': return Flame;
      case 'DELIVERY': return TrendingUp;
      case 'TEAM': return Users;
      case 'QUALITY': return Bug;
      case 'RISK': return AlertTriangle;
      case 'PLANNING': return Target;
      case 'ROADMAP': return Compass;
      case 'AUDIT': return History;
      default: return Briefcase;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-muted/30 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  Report Comparison &amp; Domain Matrix
                </h2>
                <span className="px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  Zero Duplication Policy
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Each of the 10 Canonical Reports addresses ONE specific decision-making domain with dedicated data filters, specialized matrices, and actionable KPIs.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            title="Close Guide"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Category Selector & Search */}
        <div className="px-6 py-3 bg-card border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {CANONICAL_REPORT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition whitespace-nowrap cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search domain, question, or metric..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary shadow-2xs"
            />
          </div>
        </div>

        {/* Comparison Table & Cards Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-background/50">
          
          {/* Architecture Summary Banner */}
          <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  How Eitekh WorkOS Eliminates Report Duplication
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Instead of generating 25+ generic tables, Eitekh WorkOS organizes reporting into <strong>10 specialized domain reports</strong>. Each report queries live database records with tailored filters (e.g. Sprint Performance isolates active sprint items, Quality Defect isolates bugs, Team Capacity maps individual member workloads).
                </p>
              </div>
            </div>
            <div className="text-[11px] font-mono text-primary font-semibold shrink-0 bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20">
              10 Domains • Zero Overlap
            </div>
          </div>

          {/* Matrix Cards Grid */}
          <div className="grid grid-cols-1 gap-3">
            {filteredReports.map((report) => {
              const Icon = getCategoryIcon(report.category);
              return (
                <div
                  key={report.id}
                  className="p-4.5 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-xs transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 group"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {report.name}
                      </h3>
                      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-md bg-muted text-foreground border border-border">
                        {report.categoryLabel}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                          Key Business Question
                        </span>
                        <span className="font-medium text-foreground leading-snug">
                          {report.businessQuestion}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                          Data Scope Filter
                        </span>
                        <span className="font-mono text-xs text-primary font-semibold">
                          {report.scopeFilter}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                          Exclusive Domain Matrix
                        </span>
                        <span className="font-medium text-foreground">
                          {report.distinctMatrix}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap pt-1">
                      <span><strong>Target Audience:</strong> {report.targetAudience}</span>
                      <span>•</span>
                      <span><strong>Key Metrics:</strong> {report.keyMetrics.join(', ')}</span>
                    </div>
                  </div>

                  <div className="shrink-0 self-end lg:self-center">
                    <button
                      onClick={() => {
                        onClose();
                        if (onSelectReport) {
                          onSelectReport(report.id, report.name);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-2xs cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Open Report</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredReports.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs">
                No reports matched your search query.
              </div>
            )}
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Eitekh WorkOS Enterprise Analytics Engine</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-background border border-border hover:bg-muted transition cursor-pointer"
          >
            Close Guide
          </button>
        </div>

      </div>
    </div>
  );
}
