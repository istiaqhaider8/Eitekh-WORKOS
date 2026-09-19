"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  Clock,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Users,
  Check,
  Zap,
  MoveHorizontal,
  ChevronDown,
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { doesLeaveOverlap, formatLeaveRange } from "@/lib/leave-engine";
import { isDelegationActive } from "@/lib/delegation-dates";
import { isIssueDone, getIssueKeyClass } from "@/lib/designSystem";


interface TimelineGanttViewProps {
  issues: any[];
  statuses?: any[];
  priorities?: any[];
  leaves?: any[];
  delegations?: any[];
  projectId?: string;
  onSelectIssue: (issue: any) => void;
  onRefresh?: () => void;
}


interface DragState {
  issueId: string;
  issueKey: string;
  issueTitle: string;
  mode: "move" | "resize-start" | "resize-end";
  startX: number;
  currentX: number;
  origStart: Date;
  origEnd: Date;
  durationDays: number;
  hasMoved: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export type TimelineScale = "day" | "month" | "year";

const COL_WIDTH_DAY = 52;
const COL_WIDTH_MONTH = 100;
const COL_WIDTH_YEAR = 120;

function toMidnight(input: Date | string | number): Date {
  if (typeof input === "string") {
    // If string matches YYYY-MM-DD or starts with YYYY-MM-DD
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(year, month, day, 0, 0, 0, 0);
    }
  }
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysBetween(d1: Date, d2: Date): number {
  return Math.round((d1.getTime() - d2.getTime()) / MS_PER_DAY);
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function TimelineGanttView({
  issues,
  statuses = [],
  priorities = [],
  leaves: propsLeaves = [],
  delegations = [],
  projectId,
  onSelectIssue,
  onRefresh,
}: TimelineGanttViewProps) {
  const [fetchedLeaves, setFetchedLeaves] = useState<any[]>([]);

  useEffect(() => {
    if (propsLeaves.length > 0) return;
    if (projectId) {
      fetch(`/api/projects/${projectId}/availability`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.leaves)) setFetchedLeaves(data.leaves);
        })
        .catch(() => {});
    }
  }, [projectId, propsLeaves]);

  const activeLeaves = useMemo(() => (propsLeaves.length > 0 ? propsLeaves : fetchedLeaves), [propsLeaves, fetchedLeaves]);

  const [timelineScale, setTimelineScale] = useState<TimelineScale>("day");

  const [isHighlightingToday, setIsHighlightingToday] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [statusCategoryFilter, setStatusCategoryFilter] = useState("ALL");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const colWidth =
    timelineScale === "day"
      ? COL_WIDTH_DAY
      : timelineScale === "month"
      ? COL_WIDTH_MONTH
      : COL_WIDTH_YEAR;

  // Local optimistic overrides for issue dates
  const [dateOverrides, setDateOverrides] = useState<Record<string, { startDate: Date; dueDate: Date }>>({});

  // When issues prop updates, clear local date overrides so saved changes immediately reflect
  useEffect(() => {
    setDateOverrides({});
  }, [issues]);

  // Active drag state
  const dragStateRef = useRef<DragState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const today = useMemo(() => toMidnight(new Date()), []);

  // 1. Filter issues based on toolbar filters
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchKey = issue.issueKey?.toLowerCase().includes(q);
        const matchTitle = issue.title?.toLowerCase().includes(q);
        if (!matchKey && !matchTitle) return false;
      }
      if (priorityFilter !== "ALL" && issue.priority !== priorityFilter) {
        return false;
      }
      if (statusCategoryFilter !== "ALL") {
        const matchesId = issue.statusId === statusCategoryFilter;
        const matchesCat = (issue.status?.category || "TODO") === statusCategoryFilter;
        if (!matchesId && !matchesCat) return false;
      }
      return true;
    });
  }, [issues, searchQuery, priorityFilter, statusCategoryFilter]);

  // 2. Resolve realistic dates for each issue, applying any local drag overrides
  const resolvedIssues = useMemo(() => {
    return filteredIssues.map((issue, idx) => {
      let start: Date;
      let end: Date;
      let isAutoScheduled = false;

      // Check if user has dragged / overridden this issue's dates
      const override = dateOverrides[issue.id];
      if (override) {
        start = toMidnight(override.startDate);
        end = toMidnight(override.dueDate);
        return {
          ...issue,
          startDate: start.toISOString(),
          dueDate: end.toISOString(),
          resolvedStart: start,
          resolvedEnd: end,
          durationDays: Math.max(1, getDaysBetween(end, start) + 1),
          isAutoScheduled: false,
        };
      }

      const points = issue.estimatePoints ? Number(issue.estimatePoints) : 3;
      // Duration between 1 and 6 business days based on story points or priority
      const durationDays = Math.min(6, Math.max(2, Math.round(points / 2) || 3));

      if (issue.startDate && issue.dueDate) {
        start = toMidnight(issue.startDate);
        end = toMidnight(issue.dueDate);
        if (end < start) end = new Date(start.getTime() + (durationDays - 1) * MS_PER_DAY);
      } else if (issue.startDate) {
        start = toMidnight(issue.startDate);
        end = new Date(start.getTime() + (durationDays - 1) * MS_PER_DAY);
      } else if (issue.dueDate) {
        end = toMidnight(issue.dueDate);
        start = new Date(end.getTime() - (durationDays - 1) * MS_PER_DAY);
      } else {
        // Stagger unscheduled issues realistically across the recent 2-3 weeks window
        isAutoScheduled = true;
        const staggerOffset = ((issue.keyNumber || idx) % 10) - 4; // between -4 and +5 days from today
        start = new Date(today.getTime() + staggerOffset * MS_PER_DAY);
        end = new Date(start.getTime() + (durationDays - 1) * MS_PER_DAY);
      }

      const memberLeaves = (issue.assigneeId || issue.assignee?.id) ? activeLeaves.filter((l: any) => l.userId === (issue.assigneeId || issue.assignee?.id)) : [];
      const leaveCheck = memberLeaves.length > 0 ? doesLeaveOverlap(memberLeaves, start, end) : { hasOverlap: false, warningText: undefined };

      return {
        ...issue,
        resolvedStart: start,
        resolvedEnd: end,
        durationDays: Math.max(1, getDaysBetween(end, start) + 1),
        isAutoScheduled,
        hasLeaveOverlap: leaveCheck.hasOverlap,
        leaveWarningText: leaveCheck.warningText,
      };
    });
  }, [filteredIssues, today, dateOverrides, activeLeaves]);


  // 3. Dynamic Date Range & Grid Generation for Day, Month, and Year Views
  const gridInfo = useMemo(() => {
    let min = new Date(today.getTime() - 7 * MS_PER_DAY);
    let max = new Date(today.getTime() + 21 * MS_PER_DAY);

    resolvedIssues.forEach((i) => {
      if (i.resolvedStart < min) min = new Date(i.resolvedStart);
      if (i.resolvedEnd > max) max = new Date(i.resolvedEnd);
    });

    if (timelineScale === "day") {
      // Day scale: columns are days, top groups are months
      min = toMidnight(new Date(min.getTime() - 3 * MS_PER_DAY));
      max = toMidnight(new Date(max.getTime() + 5 * MS_PER_DAY));

      const daysArr: {
        dateObj: Date;
        topLabel: string;
        bottomLabel: string;
        isWeekend: boolean;
        isCurrent: boolean;
      }[] = [];

      const curr = new Date(min);
      while (curr <= max) {
        const d = toMidnight(curr);
        const dayNum = d.getDay();
        daysArr.push({
          dateObj: d,
          topLabel: d.toLocaleDateString("en-US", { weekday: "short" }),
          bottomLabel: String(d.getDate()),
          isWeekend: dayNum === 0 || dayNum === 6,
          isCurrent: isSameDay(d, today),
        });
        curr.setDate(curr.getDate() + 1);
      }

      const monthsMap: Record<string, { label: string; count: number }> = {};
      daysArr.forEach((d) => {
        const key = `${d.dateObj.getFullYear()}-${d.dateObj.getMonth()}`;
        const label = d.dateObj.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        if (!monthsMap[key]) {
          monthsMap[key] = { label, count: 0 };
        }
        monthsMap[key].count += 1;
      });

      return {
        minDate: min,
        maxDate: max,
        columns: daysArr,
        topGroups: Object.values(monthsMap),
      };
    }

    if (timelineScale === "month") {
      // Month scale: columns are months, top groups are years
      const startYear = Math.min(min.getFullYear(), today.getFullYear());
      const startMonth = Math.min(min.getMonth() - 2, today.getMonth() - 1);
      const endYear = Math.max(max.getFullYear(), today.getFullYear());
      const endMonth = Math.max(max.getMonth() + 4, today.getMonth() + 6);

      const gridMin = new Date(startYear, startMonth, 1);
      const gridMax = new Date(endYear, endMonth + 1, 0);

      const monthsArr: {
        dateObj: Date;
        topLabel: string;
        bottomLabel: string;
        isWeekend: boolean;
        isCurrent: boolean;
      }[] = [];

      const curr = new Date(gridMin);
      while (curr <= gridMax) {
        const d = new Date(curr.getFullYear(), curr.getMonth(), 1);
        const isCurrentMonth =
          d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
        monthsArr.push({
          dateObj: d,
          topLabel: d.toLocaleDateString("en-US", { month: "short" }),
          bottomLabel: String(d.getFullYear()),
          isWeekend: false,
          isCurrent: isCurrentMonth,
        });
        curr.setMonth(curr.getMonth() + 1);
      }

      const yearsMap: Record<string, { label: string; count: number }> = {};
      monthsArr.forEach((m) => {
        const yearKey = String(m.dateObj.getFullYear());
        if (!yearsMap[yearKey]) {
          yearsMap[yearKey] = { label: yearKey, count: 0 };
        }
        yearsMap[yearKey].count += 1;
      });

      return {
        minDate: gridMin,
        maxDate: gridMax,
        columns: monthsArr,
        topGroups: Object.values(yearsMap),
      };
    }

    // Year scale: columns are quarters (Q1-Q4), top groups are years
    const startYear = Math.min(min.getFullYear() - 1, today.getFullYear() - 1);
    const endYear = Math.max(max.getFullYear() + 1, today.getFullYear() + 1);

    const gridMin = new Date(startYear, 0, 1);
    const gridMax = new Date(endYear, 11, 31);

    const quartersArr: {
      dateObj: Date;
      topLabel: string;
      bottomLabel: string;
      isWeekend: boolean;
      isCurrent: boolean;
    }[] = [];

    const quartersMeta = [
      { q: "Q1", range: "Jan - Mar", monthStart: 0 },
      { q: "Q2", range: "Apr - Jun", monthStart: 3 },
      { q: "Q3", range: "Jul - Sep", monthStart: 6 },
      { q: "Q4", range: "Oct - Dec", monthStart: 9 },
    ];

    for (let yr = startYear; yr <= endYear; yr++) {
      quartersMeta.forEach((qm) => {
        const qDate = new Date(yr, qm.monthStart, 1);
        const isCurrentQuarter =
          yr === today.getFullYear() &&
          Math.floor(today.getMonth() / 3) === Math.floor(qm.monthStart / 3);
        quartersArr.push({
          dateObj: qDate,
          topLabel: qm.q,
          bottomLabel: qm.range,
          isWeekend: false,
          isCurrent: isCurrentQuarter,
        });
      });
    }

    const topGroups: { label: string; count: number }[] = [];
    for (let yr = startYear; yr <= endYear; yr++) {
      topGroups.push({ label: String(yr), count: 4 });
    }

    return {
      minDate: gridMin,
      maxDate: gridMax,
      columns: quartersArr,
      topGroups,
    };
  }, [resolvedIssues, today, timelineScale]);

  // Coordinate and Dimension calculation helper for all 3 scales
  const getBarCoordinates = useMemo(() => {
    return (start: Date, end: Date) => {
      if (timelineScale === "day") {
        const startCol = Math.max(0, getDaysBetween(start, gridInfo.minDate));
        const spanCols = Math.max(1, getDaysBetween(end, start) + 1);
        const left = startCol * COL_WIDTH_DAY + 2;
        const width = Math.max(36, spanCols * COL_WIDTH_DAY - 4);
        return { left, width, spanCols, startCol: startCol + 1 };
      }

      if (timelineScale === "month") {
        const minM = gridInfo.minDate;
        const getMonthPx = (d: Date) => {
          const mIdx =
            (d.getFullYear() - minM.getFullYear()) * 12 + (d.getMonth() - minM.getMonth());
          const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          const frac = Math.max(0, Math.min(1, (d.getDate() - 1) / daysInMonth));
          return (mIdx + frac) * COL_WIDTH_MONTH;
        };
        const startPx = getMonthPx(start);
        const endDaysInMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
        const endPx = getMonthPx(end) + COL_WIDTH_MONTH / endDaysInMonth;
        const left = Math.max(0, startPx) + 2;
        const width = Math.max(36, endPx - startPx - 4);
        return {
          left,
          width,
          spanCols: Math.max(1, Math.round(width / COL_WIDTH_MONTH)),
          startCol: 1,
        };
      }

      // Year Scale (Quarters)
      const minYr = gridInfo.minDate.getFullYear();
      const getQuarterPx = (d: Date) => {
        const qIdx = (d.getFullYear() - minYr) * 4 + Math.floor(d.getMonth() / 3);
        const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
        const qStart = new Date(d.getFullYear(), qStartMonth, 1);
        const qEnd = new Date(d.getFullYear(), qStartMonth + 3, 0);
        const qDays = Math.max(1, (qEnd.getTime() - qStart.getTime()) / MS_PER_DAY + 1);
        const dayInQ = Math.max(0, (d.getTime() - qStart.getTime()) / MS_PER_DAY);
        return (qIdx + Math.max(0, Math.min(1, dayInQ / qDays))) * COL_WIDTH_YEAR;
      };
      const startPx = getQuarterPx(start);
      const endPx = getQuarterPx(end) + Math.max(12, COL_WIDTH_YEAR / 30);
      const left = Math.max(0, startPx) + 2;
      const width = Math.max(36, endPx - startPx - 4);
      return {
        left,
        width,
        spanCols: Math.max(1, Math.round(width / COL_WIDTH_YEAR)),
        startCol: 1,
      };
    };
  }, [timelineScale, gridInfo]);

  // Pixel to day delta helper
  const getDayDelta = (pixelDelta: number, scale: TimelineScale) => {
    if (scale === "day") {
      return Math.round(pixelDelta / COL_WIDTH_DAY);
    }
    if (scale === "month") {
      return Math.round((pixelDelta / COL_WIDTH_MONTH) * 30.4);
    }
    return Math.round((pixelDelta / COL_WIDTH_YEAR) * 91.25);
  };

  // Today marker exact pixel position
  const todayLeftPx = useMemo(() => {
    if (timelineScale === "day") {
      const idx = gridInfo.columns.findIndex((c) => c.isCurrent);
      if (idx !== -1) {
        return idx * COL_WIDTH_DAY + COL_WIDTH_DAY / 2;
      }
    }
    return getBarCoordinates(today, today).left;
  }, [gridInfo, timelineScale, today, getBarCoordinates]);

  // Active hover column index during drag
  const activeHoverColIdx = useMemo(() => {
    if (!dragState || !dragState.hasMoved) return -1;
    const pixelDelta = dragState.currentX - dragState.startX;
    const dayDelta = getDayDelta(pixelDelta, timelineScale);
    const targetDate = new Date(dragState.origStart.getTime() + dayDelta * MS_PER_DAY);

    if (timelineScale === "day") {
      return gridInfo.columns.findIndex(
        (d) => d.dateObj.getTime() === toMidnight(targetDate).getTime()
      );
    }
    if (timelineScale === "month") {
      return gridInfo.columns.findIndex(
        (d) =>
          d.dateObj.getFullYear() === targetDate.getFullYear() &&
          d.dateObj.getMonth() === targetDate.getMonth()
      );
    }
    const tq = Math.floor(targetDate.getMonth() / 3);
    return gridInfo.columns.findIndex(
      (d) =>
        d.dateObj.getFullYear() === targetDate.getFullYear() &&
        Math.floor(d.dateObj.getMonth() / 3) === tq
    );
  }, [dragState, gridInfo.columns, timelineScale]);

  // Scroll to "Today" column with viewport centering and visual highlight pulse
  const handleScrollToToday = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const containerWidth = container.clientWidth || 800;
      const visibleTimelineWidth = Math.max(200, containerWidth - 300);
      const targetScrollLeft = todayLeftPx - visibleTimelineWidth / 2;
      container.scrollTo({
        left: Math.max(0, targetScrollLeft),
        behavior: "smooth",
      });

      // Visual pulse highlight effect on Today marker and badge
      setIsHighlightingToday(true);
      setTimeout(() => setIsHighlightingToday(false), 2000);
    }
  };

  // Scroll to "Today" on initial render or when switching view scale
  useEffect(() => {
    const timer = setTimeout(() => {
      handleScrollToToday();
    }, 50);
    return () => clearTimeout(timer);
  }, [timelineScale]);

  // Drag & Drop Pointer Handler
  const startDrag = (
    e: React.PointerEvent,
    issue: any,
    mode: "move" | "resize-start" | "resize-end"
  ) => {
    if (e.button !== 0) return; // Left mouse / touch only
    const startX = e.clientX;
    const initial: DragState = {
      issueId: issue.id,
      issueKey: issue.issueKey,
      issueTitle: issue.title,
      mode,
      startX,
      currentX: startX,
      origStart: new Date(issue.resolvedStart),
      origEnd: new Date(issue.resolvedEnd),
      durationDays: issue.durationDays,
      hasMoved: false,
    };
    dragStateRef.current = initial;
    setDragState(initial);
  };

  // Global window listeners for smooth drag & drop tracking
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      const dx = e.clientX - dragStateRef.current.startX;
      if (!dragStateRef.current.hasMoved && Math.abs(dx) > 3) {
        dragStateRef.current.hasMoved = true;
      }
      dragStateRef.current.currentX = e.clientX;
      setDragState({ ...dragStateRef.current });
    };

    const handlePointerUp = async (e: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current) return;
      dragStateRef.current = null;
      setDragState(null);

      // If user merely clicked without dragging, let normal onSelectIssue handle it
      if (!current.hasMoved) return;

      const pixelDelta = current.currentX - current.startX;
      const dayDelta = getDayDelta(pixelDelta, timelineScale);

      if (dayDelta === 0) return; // Snapped back to same position

      let newStart = new Date(current.origStart);
      let newEnd = new Date(current.origEnd);

      if (current.mode === "move") {
        newStart = new Date(current.origStart.getTime() + dayDelta * MS_PER_DAY);
        newEnd = new Date(current.origEnd.getTime() + dayDelta * MS_PER_DAY);
      } else if (current.mode === "resize-start") {
        newStart = new Date(current.origStart.getTime() + dayDelta * MS_PER_DAY);
        if (newStart > newEnd) newStart = new Date(newEnd);
      } else if (current.mode === "resize-end") {
        newEnd = new Date(current.origEnd.getTime() + dayDelta * MS_PER_DAY);
        if (newEnd < newStart) newEnd = new Date(newStart);
      }

      // Optimistically update local UI immediately
      setDateOverrides((prev) => ({
        ...prev,
        [current.issueId]: { startDate: newStart, dueDate: newEnd },
      }));

      try {
        const res = await fetch(`/api/issues/${current.issueId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: newStart.toISOString(),
            dueDate: newEnd.toISOString(),
          }),
        });

        if (res.ok) {
          const startStr = newStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const endStr = newEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          showSuccess(`Rescheduled ${current.issueKey}: ${startStr} – ${endStr}`);
          onRefresh?.();
        } else {
          showError(`Failed to reschedule ${current.issueKey}`);
          setDateOverrides((prev) => {
            const copy = { ...prev };
            delete copy[current.issueId];
            return copy;
          });
        }
      } catch (err) {
        showError(`Network error while rescheduling`);
        setDateOverrides((prev) => {
          const copy = { ...prev };
          delete copy[current.issueId];
          return copy;
        });
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onRefresh, timelineScale]);

  const priorityList = useMemo(() => {
    return priorities.length > 0
      ? priorities
      : [
          { value: "CRITICAL", name: "Critical", color: "#ef4444" },
          { value: "HIGH", name: "High", color: "#f97316" },
          { value: "MEDIUM", name: "Medium", color: "#3b82f6" },
          { value: "LOW", name: "Low", color: "#64748b" },
        ];
  }, [priorities]);

  const getPriorityTheme = (priority: string) => {
    const custom = priorityList.find(
      (p) => p.value === priority || p.name?.toUpperCase() === priority?.toUpperCase()
    );
    if (custom?.color) {
      return {
        bar: "text-white shadow-xs",
        badge: "border",
        dot: "",
        customColor: custom.color,
        name: custom.name || priority,
      };
    }
    switch (priority) {
      case "CRITICAL":
      case "HIGHEST":
        return {
          bar: "bg-gradient-to-r from-rose-500 to-red-600 border-rose-400/80 text-white shadow-rose-500/20",
          badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300",
          dot: "bg-rose-500",
          customColor: "#ef4444",
          name: "Critical",
        };
      case "HIGH":
        return {
          bar: "bg-gradient-to-r from-amber-500 to-orange-600 border-amber-400/80 text-white shadow-amber-500/20",
          badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300",
          dot: "bg-amber-500",
          customColor: "#f97316",
          name: "High",
        };
      case "LOW":
      case "LOWEST":
        return {
          bar: "bg-gradient-to-r from-slate-500 to-slate-600 border-slate-400/80 text-white shadow-slate-500/20",
          badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300",
          dot: "bg-slate-400",
          customColor: "#64748b",
          name: "Low",
        };
      default: // MEDIUM
        return {
          bar: "bg-gradient-to-r from-blue-600 to-indigo-600 border-blue-400/80 text-white shadow-blue-500/20",
          badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300",
          dot: "bg-blue-500",
          customColor: "#3b82f6",
          name: "Medium",
        };
    }
  };

  const isDoneCategory = (status: any) => {
    const cat = status?.category || "";
    return cat === "DONE" || status?.name?.toLowerCase().includes("done") || status?.name?.toLowerCase().includes("closed");
  };

  return (
    <div className="flex-1 p-3 sm:p-4 md:p-6 space-y-4 overflow-hidden flex flex-col min-h-0 select-none">
      {/* Top Header & Interactive Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Timeline Schedule</h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-900/60">
              {resolvedIssues.length} Scheduled
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/80 dark:border-indigo-900/60 flex items-center gap-1.5 shadow-2xs">
              <MoveHorizontal className="w-3 h-3 text-indigo-500" />
              <span>Drag & Drop Enabled</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Gantt milestones, workload scheduling, and Finish-to-Start dependency pathways
          </p>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
            <input
              type="text"
              placeholder="Search schedule..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/[0.1] rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 dark:text-slate-200 w-44 font-medium"
            />
          </div>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-white/[0.1] bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-medium outline-none cursor-pointer hover:border-slate-300 dark:hover:border-white/[0.2]"
          >
            <option value="ALL">All Priorities</option>
            {priorityList.map((p) => (
              <option key={p.value} value={p.value}>
                {p.name || p.value}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusCategoryFilter}
            onChange={(e) => setStatusCategoryFilter(e.target.value)}
            className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-white/[0.1] bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-medium outline-none cursor-pointer hover:border-slate-300 dark:hover:border-white/[0.2]"
          >
            <option value="ALL">All Statuses</option>
            {statuses.length > 0 ? (
              statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            ) : (
              <>
                <option value="TODO">To Do</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="DONE">Done</option>
              </>
            )}
          </select>

          {/* View Scale Dropdown: Day / Month / Year Wise */}
          <div className="relative flex items-center">
            <select
              value={timelineScale}
              onChange={(e) => setTimelineScale(e.target.value as TimelineScale)}
              className="text-xs py-1.5 pl-3 pr-8 rounded-lg border border-slate-300 dark:border-white/[0.1] bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-300 dark:hover:border-white/[0.2] shadow-2xs appearance-none"
              title="Timeline Scale View"
            >
              <option value="day">Day Wise</option>
              <option value="month">Month Wise</option>
              <option value="year">Year Wise</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Today Button */}
          <button
            type="button"
            onClick={handleScrollToToday}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-2xs ${
              isHighlightingToday
                ? "bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-105 ring-2 ring-blue-400"
                : "btn-secondary text-slate-700 dark:text-slate-300 hover:border-blue-400 dark:hover:border-blue-500"
            }`}
            title="Jump and center on Today's date"
          >
            <Calendar className={`w-3.5 h-3.5 ${isHighlightingToday ? "text-white animate-pulse" : "text-blue-600 dark:text-blue-400"}`} />
            <span>Today</span>
          </button>
        </div>
      </div>

      {/* Main Gantt Canvas Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/[0.08] rounded-2xl overflow-hidden shadow-2xs flex-1 flex flex-col min-h-0 relative">
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-auto relative scroll-smooth"
        >
          <div className="inline-block min-w-full relative">
            {/* Header: Tier 1 - Top Group (Month in Day mode, Year in Month/Year mode) */}
            <div className="flex border-b border-slate-300 dark:border-white/[0.08] bg-slate-100/90 dark:bg-slate-800/80 sticky top-0 z-40 backdrop-blur-md">
              <div className="w-[300px] p-2.5 border-r border-slate-300 dark:border-white/[0.08] text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0 sticky left-0 bg-slate-100 dark:bg-slate-800 z-50 flex items-center justify-between">
                <span>Issue / Milestone</span>
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">Duration</span>
              </div>
              <div className="flex-1 flex">
                {gridInfo.topGroups.map((g, idx) => (
                  <div
                    key={idx}
                    style={{ width: `${g.count * colWidth}px` }}
                    className="py-1.5 px-3 border-r border-slate-300 dark:border-white/[0.06] text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0 flex items-center gap-1.5"
                  >
                    <Calendar className="w-3 h-3 text-blue-500" />
                    <span>{g.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Header: Tier 2 - Columns (Days in Day mode, Months in Month mode, Quarters in Year mode) */}
            <div className="flex border-b border-slate-300 dark:border-white/[0.08] bg-slate-50/95 dark:bg-slate-900/95 sticky top-[37px] z-30 backdrop-blur-md">
              <div className="w-[300px] border-r border-slate-300 dark:border-white/[0.08] shrink-0 sticky left-0 bg-slate-50 dark:bg-slate-900 z-40" />
              <div
                className="flex-1 grid text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400 divide-x divide-slate-200/60 dark:divide-white/[0.04]"
                style={{ gridTemplateColumns: `repeat(${gridInfo.columns.length}, ${colWidth}px)` }}
              >
                {gridInfo.columns.map((d, idx) => (
                  <div
                    key={idx}
                    className={`py-1.5 flex flex-col items-center justify-center transition-colors ${
                      activeHoverColIdx === idx
                        ? "bg-blue-100/90 dark:bg-blue-900/60 ring-2 ring-blue-500 z-10 text-blue-700 dark:text-blue-300 font-bold"
                        : d.isCurrent
                        ? "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-bold"
                        : d.isWeekend
                        ? "bg-slate-100/60 dark:bg-slate-800/30 text-slate-500 dark:text-slate-400"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <span className="text-[9px] uppercase tracking-wider">{d.topLabel}</span>
                    <span
                      className={`text-xs ${
                        d.isCurrent && timelineScale === "day"
                          ? "bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center font-bold shadow-xs"
                          : d.isCurrent
                          ? "text-blue-600 dark:text-blue-400 font-extrabold"
                          : ""
                      }`}
                    >
                      {d.bottomLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Vertical "Today" Line Marker */}
            <div
              className={`absolute top-[74px] bottom-0 w-0.5 z-30 pointer-events-none transition-all duration-300 ${
                isHighlightingToday
                  ? "bg-blue-600 dark:bg-blue-400 ring-4 ring-blue-400/60 shadow-lg shadow-blue-500 scale-x-150"
                  : "bg-blue-500 dark:bg-blue-400 shadow-sm shadow-blue-500/50"
              }`}
              style={{ left: `calc(300px + ${todayLeftPx}px)` }}
            >
              <div
                className={`sticky top-[76px] -translate-x-1/2 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full shadow-xl whitespace-nowrap transition-all duration-300 flex items-center gap-1 ${
                  isHighlightingToday
                    ? "bg-blue-600 scale-125 ring-2 ring-white shadow-blue-500/80"
                    : "bg-blue-600"
                }`}
              >
                {isHighlightingToday && <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping shrink-0" />}
                TODAY
              </div>
            </div>

            {/* Timeline Rows */}
            {resolvedIssues.length === 0 ? (
              <div className="py-20 text-center text-slate-500 dark:text-slate-500 space-y-2">
                <Calendar className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs font-semibold">No issues match the selected timeline filters.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60 relative">
                {resolvedIssues.map((issue, idx) => {
                  const isDraggingThis = Boolean(dragState && dragState.issueId === issue.id && dragState.hasMoved);

                  let effectiveStart = issue.resolvedStart;
                  let effectiveEnd = issue.resolvedEnd;

                  if (isDraggingThis && dragState) {
                    const pixelDelta = dragState.currentX - dragState.startX;
                    const dayDelta = getDayDelta(pixelDelta, timelineScale);
                    if (dragState.mode === "move") {
                      effectiveStart = new Date(dragState.origStart.getTime() + dayDelta * MS_PER_DAY);
                      effectiveEnd = new Date(dragState.origEnd.getTime() + dayDelta * MS_PER_DAY);
                    } else if (dragState.mode === "resize-start") {
                      const candidate = new Date(dragState.origStart.getTime() + dayDelta * MS_PER_DAY);
                      effectiveStart = candidate > dragState.origEnd ? dragState.origEnd : candidate;
                      effectiveEnd = dragState.origEnd;
                    } else if (dragState.mode === "resize-end") {
                      const candidate = new Date(dragState.origEnd.getTime() + dayDelta * MS_PER_DAY);
                      effectiveStart = dragState.origStart;
                      effectiveEnd = candidate < dragState.origStart ? dragState.origStart : candidate;
                    }
                  }

                  const { left, width, spanCols } = getBarCoordinates(effectiveStart, effectiveEnd);
                  const effectiveDurationDays = Math.max(1, getDaysBetween(effectiveEnd, effectiveStart) + 1);

                  const priorityTheme = getPriorityTheme(issue.priority);
                  const isDone = isDoneCategory(issue.status);

                  return (
                    <div
                      key={issue.id}
                      className="flex hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors relative h-12 group"
                    >
                      {/* Left Sticky Info Column */}
                      <div
                        onClick={() => onSelectIssue(issue)}
                        className="w-[300px] px-3.5 py-2 border-r border-slate-300 dark:border-white/[0.08] flex items-center justify-between gap-2 cursor-pointer shrink-0 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/90 z-30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${priorityTheme.dot}`}
                            style={priorityTheme.customColor ? { backgroundColor: priorityTheme.customColor } : undefined}
                            title={`Priority: ${priorityTheme.name || issue.priority}`}
                          />
                          <span className={getIssueKeyClass(isIssueDone(issue, statuses), "text-xs shrink-0")}>
                            {issue.issueKey}
                          </span>
                          {(() => {
                            const activeDel = (delegations || []).find(
                              (d: any) => d.issueId === issue.id && isDelegationActive(d) && d.status === "ACTIVE"
                            );
                            if (activeDel) {
                              return (
                                <span
                                  className="text-[9px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950 px-1 rounded border border-indigo-200 dark:border-indigo-800 shrink-0"
                                  title={`Delegated to ${activeDel.delegateUser?.firstName || "Delegate"}`}
                                >
                                  ↗ Delegated
                                </span>
                              );
                            }
                            return null;
                          })()}
                          <span
                            className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                            title={issue.title}
                          >
                            {issue.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {issue.status ? (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1"
                              style={
                                issue.status?.color
                                  ? {
                                      backgroundColor: `${issue.status?.color}15`,
                                      borderColor: `${issue.status?.color}40`,
                                      color: issue.status?.color,
                                    }
                                  : undefined
                              }
                            >
                              {isDone && <Check className="w-2.5 h-2.5" />}
                              <span>{issue.status?.name || 'Status'}</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                              {effectiveDurationDays}d
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Grid Column for Gantt Capsule */}
                      <div
                        className="flex-1 grid relative items-center px-1"
                        style={{ gridTemplateColumns: `repeat(${gridInfo.columns.length}, ${colWidth}px)` }}
                      >
                        {/* Grid background column shading */}
                        {gridInfo.columns.map((d, dIdx) => (
                          <div
                            key={dIdx}
                            className={`h-full border-r border-slate-300/60 dark:border-slate-800/30 ${
                              activeHoverColIdx === dIdx
                                ? "bg-blue-50/50 dark:bg-blue-950/30"
                                : d.isWeekend
                                ? "bg-slate-100/30 dark:bg-slate-800/20"
                                : ""
                            }`}
                          />
                        ))}

                        {/* Interactive Gantt Bar Capsule with Drag & Drop and Resizing */}
                        <div
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            startDrag(e, issue, "move");
                          }}
                          onClick={(e) => {
                            if (dragState?.hasMoved) {
                              e.stopPropagation();
                              return;
                            }
                            onSelectIssue(issue);
                          }}
                          style={{
                            left: `${left}px`,
                            width: `${width}px`,
                            touchAction: "none",
                            ...(!isDone && priorityTheme.customColor
                              ? {
                                  backgroundColor: priorityTheme.customColor,
                                  borderColor: `${priorityTheme.customColor}CC`,
                                }
                              : {}),
                          }}
                          className={`absolute h-7 rounded-xl border group/bar select-none overflow-hidden ${
                            isDone
                              ? "bg-gradient-to-r from-emerald-500 to-teal-600 border-emerald-400/90 text-white shadow-xs"
                              : `${priorityTheme.bar} shadow-xs`
                          } flex items-center justify-between px-2 text-[11px] font-semibold transition-all duration-75 ${
                            isDraggingThis
                              ? "cursor-grabbing ring-2 ring-white/90 scale-[1.02] shadow-xl z-40 brightness-110"
                              : "cursor-grab hover:brightness-110 hover:shadow-md hover:-translate-y-0.5 z-10"
                          }`}
                          title={`Drag bar to reschedule • Drag edges to resize\n${issue.issueKey}: ${issue.title} (${effectiveDurationDays}d)`}
                        >
                          {/* Floating In-Flight Live Date Tooltip during Drag */}
                          {isDraggingThis && dragState && (
                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1 rounded-xl bg-slate-900/95 dark:bg-slate-950/95 text-white text-[11px] font-bold shadow-2xl border border-white/20 whitespace-nowrap z-50 flex items-center gap-2 pointer-events-none ring-1 ring-blue-500/60 backdrop-blur-md">
                              <MoveHorizontal className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                              <span>
                                {effectiveStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                                {effectiveEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/30 text-blue-300 font-mono">
                                {effectiveDurationDays}d
                              </span>
                              {dragState.mode === "move" && (
                                <span className="text-[10px] text-slate-300 font-normal">
                                  ({getDayDelta(dragState.currentX - dragState.startX, timelineScale) >= 0 ? "+" : ""}
                                  {getDayDelta(dragState.currentX - dragState.startX, timelineScale)}d)
                                </span>
                              )}
                            </div>
                          )}

                          {/* Left Resize Handle (Start Date) */}
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              startDrag(e, issue, "resize-start");
                            }}
                            className="absolute -left-1 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center opacity-0 group-hover/bar:opacity-100 hover:opacity-100 transition-opacity z-20 group/handle"
                            title="Drag left or right to adjust Start Date"
                          >
                            <div className="w-1 h-3.5 bg-white/90 rounded-full shadow-xs group-hover/handle:scale-125 group-hover/handle:bg-white transition-all" />
                          </div>

                          {/* Capsule Content */}
                          <div className="flex items-center gap-1.5 min-w-0 truncate pointer-events-none flex-1">
                            {isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 shrink-0 opacity-80" />
                            )}
                            {spanCols > 1 ? (
                              <span className="truncate">{issue.title}</span>
                            ) : (
                              <span className={`truncate text-[10px] font-mono opacity-90 ${isIssueDone(issue, statuses) ? "line-through" : ""}`}>{issue.issueKey}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0 ml-1 pointer-events-none">
                            {issue.isAutoScheduled && !dateOverrides[issue.id] && spanCols > 2 && (
                              <span className="text-[9px] opacity-75 font-normal" title="Auto-scheduled based on sprint">
                                ~
                              </span>
                            )}
                            <span className="font-mono text-[10px] bg-black/25 px-1.5 py-0.5 rounded-md shrink-0">
                              {effectiveDurationDays}d
                            </span>
                          </div>

                          {/* Right Resize Handle (Due Date) */}
                          <div
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              startDrag(e, issue, "resize-end");
                            }}
                            className="absolute -right-1 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center opacity-0 group-hover/bar:opacity-100 hover:opacity-100 transition-opacity z-20 group/handle"
                            title="Drag left or right to adjust Due Date"
                          >
                            <div className="w-1 h-3.5 bg-white/90 rounded-full shadow-xs group-hover/handle:scale-125 group-hover/handle:bg-white transition-all" />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* SVG Finish-to-Start Dependency Connectors */}
                <svg
                  className="absolute inset-0 pointer-events-none z-25 w-full h-full"
                  style={{ minWidth: `calc(300px + ${gridInfo.columns.length * colWidth}px)` }}
                >
                  {resolvedIssues.map((issue, idx) => {
                    if (!issue.outgoingDeps || issue.outgoingDeps.length === 0) return null;

                    return issue.outgoingDeps.map((dep: any, depIdx: number) => {
                      const targetIdx = resolvedIssues.findIndex((i) => i.id === dep.targetIssueId);
                      if (targetIdx === -1) return null;

                      const targetIssue = resolvedIssues[targetIdx];

                      const sourceCoord = getBarCoordinates(issue.resolvedStart, issue.resolvedEnd);
                      const targetCoord = getBarCoordinates(targetIssue.resolvedStart, targetIssue.resolvedEnd);

                      const x1 = 300 + sourceCoord.left + sourceCoord.width; // Right edge of source bar
                      const y1 = idx * 48 + 24; // Middle of source row

                      const x2 = 300 + targetCoord.left; // Left edge of target bar
                      const y2 = targetIdx * 48 + 24; // Middle of target row

                      return (
                        <g key={`${issue.id}-${targetIssue.id}-${depIdx}`}>
                          <path
                            d={`M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`}
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="2"
                            strokeDasharray={dep.type === "RELATES_TO" ? "4 3" : undefined}
                            markerEnd="url(#gantt-arrowhead)"
                          />
                        </g>
                      );
                    });
                  })}
                  <defs>
                    <marker
                      id="gantt-arrowhead"
                      markerWidth="8"
                      markerHeight="6"
                      refX="7"
                      refY="3"
                      orient="auto"
                    >
                      <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
                    </marker>
                  </defs>
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Footer Summary / Legend */}
        <div className="px-5 py-2.5 border-t border-slate-300 dark:border-white/[0.08] bg-slate-50/90 dark:bg-slate-900/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Critical / Blocker
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> High Priority
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> In Progress / Medium
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Done
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
              <MoveHorizontal className="w-3.5 h-3.5 text-blue-500" />
              Drag bars to reschedule
            </span>
            <span>•</span>
            <span>Drag edges to resize duration</span>
            <span>•</span>
            <span>Click to open details</span>
          </div>
        </div>
      </div>
    </div>
  );
}

