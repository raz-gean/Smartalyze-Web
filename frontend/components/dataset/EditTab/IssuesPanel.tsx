"use client";

import { useState } from "react";
import type { CleaningIssue } from "@/lib/api";

interface IssuesPanelProps {
  issues: CleaningIssue[];
  // Suggested fill per column with missing values: how many cells it fills and how.
  fillPlans: Record<string, { count: number; description: string }>;
  // Columns whose suggested fixes have all been applied in the grid (not saved yet).
  filledColumns: Set<string>;
  duplicates: number;
  duplicateRowCount: number;
  onFixMissingColumn: (colName: string) => void;
  onMarkDuplicatesForDeletion: () => void;
  loading: boolean;
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

const SEVERITY_DOT: Record<string, string> = {
  error: "bg-red-500",
  warning: "bg-amber-400",
  info: "bg-sky-400",
};

const SEVERITY_LABEL: Record<string, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export function IssuesPanel({
  issues,
  fillPlans,
  filledColumns,
  duplicates,
  duplicateRowCount,
  onFixMissingColumn,
  onMarkDuplicatesForDeletion,
  loading,
}: IssuesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const sorted = [...issues].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs text-slate-400">
        Analysing dataset for issues…
      </div>
    );
  }

  if (issues.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Issues &amp; Suggestions</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {issues.length}
          </span>
        </div>
        <span className="text-slate-400 text-xs select-none">{collapsed ? "▼ Show" : "▲ Hide"}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {sorted.map((issue, i) => {
            const col = issue.column;
            const fillPlan = issue.kind === "missing_values" && col ? fillPlans[col] : undefined;
            const filled = issue.kind === "missing_values" && col !== null && col !== undefined && filledColumns.has(col);
            const showDupButton = issue.kind === "duplicates";

            return (
              <div key={i} className="flex items-start gap-4 px-5 py-3.5">
                {/* Severity indicator */}
                <div className="mt-1 flex shrink-0 flex-col items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[issue.severity] ?? "bg-slate-300"}`} />
                  <span className="text-[10px] font-medium text-slate-400 leading-none">
                    {SEVERITY_LABEL[issue.severity] ?? issue.severity}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {col && (
                    <span className="mb-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono font-medium text-slate-600">
                      {col}
                    </span>
                  )}
                  <p className={`text-sm leading-snug ${filled ? "text-slate-400 line-through" : "text-slate-800"}`}>{issue.message}</p>
                  {filled ? (
                    <p className="mt-0.5 text-xs font-medium text-emerald-700 leading-snug">
                      Filled. Save to keep these changes.
                    </p>
                  ) : fillPlan ? (
                    <p className="mt-0.5 text-xs text-slate-500 leading-snug">
                      Suggested fix: {fillPlan.description}
                    </p>
                  ) : issue.suggestion && (
                    <p className="mt-0.5 text-xs text-slate-500 leading-snug">
                      Suggestion: {issue.suggestion}
                    </p>
                  )}
                </div>

                {/* Fix button */}
                {fillPlan && (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                    onClick={() => onFixMissingColumn(col!)}
                  >
                    Fill {fillPlan.count} cell{fillPlan.count > 1 ? "s" : ""}
                  </button>
                )}
                {showDupButton && duplicates > 0 && (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                    onClick={onMarkDuplicatesForDeletion}
                  >
                    Mark {duplicateRowCount} for deletion
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
