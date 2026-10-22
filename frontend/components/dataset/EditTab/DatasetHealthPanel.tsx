"use client";

import { plural } from "@/lib/format";

interface DatasetHealthPanelProps {
  totalRows: number;
  totalCols: number;
  missingValuesPerCol: Record<string, number>;
  duplicates: number;
  outlierCount: number;
  suggestionCount: number;
  loading: boolean;
}

export function DatasetHealthPanel({
  totalRows,
  totalCols,
  missingValuesPerCol,
  duplicates,
  outlierCount,
  suggestionCount,
  loading,
}: DatasetHealthPanelProps) {
  const totalCells = totalRows * totalCols;
  const totalMissing = Object.values(missingValuesPerCol).reduce((a, b) => a + b, 0);
  const completeness =
    totalCells > 0 ? Math.max(0, Math.min(100, ((totalCells - totalMissing) / totalCells) * 100)) : 100;

  const completenessColor =
    completeness >= 95
      ? { bar: "bg-emerald-500", text: "text-emerald-700", ring: "border-emerald-200 bg-emerald-50" }
      : completeness >= 80
      ? { bar: "bg-amber-400", text: "text-amber-700", ring: "border-amber-200 bg-amber-50" }
      : { bar: "bg-red-500", text: "text-red-700", ring: "border-red-200 bg-red-50" };

  const issueCount = (totalMissing > 0 ? 1 : 0) + (duplicates > 0 ? 1 : 0) + (outlierCount > 0 ? 1 : 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Completeness score */}
        <div className="flex items-center gap-3 min-w-[160px]">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 ${completenessColor.ring}`}>
            {loading ? (
              <span className="text-xs text-slate-400">…</span>
            ) : (
              <span className={`text-sm font-bold ${completenessColor.text}`}>
                {completeness.toFixed(0)}%
              </span>
            )}
          </div>
          <div>
            {/* Share of cells that have a value; the Overview health score also counts duplicates, type problems, etc. */}
            <p className="text-xs font-semibold text-slate-700" title="Share of cells that have a value">Filled cells</p>
            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${completenessColor.bar}`}
                style={{ width: loading ? "0%" : `${completeness}%` }}
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {loading ? "Analysing…" : issueCount === 0 ? "No issues found" : `${plural(issueCount, "issue type")} found`}
            </p>
          </div>
        </div>

        <div className="h-10 w-px bg-slate-100 hidden sm:block" />

        {/* Metric chips */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Missing cells */}
          <MetricChip
            count={totalMissing}
            label="missing cell"
            emptyLabel="No missing cells"
            activeColor="bg-red-50 border-red-200 text-red-700"
            emptyColor="bg-slate-50 border-slate-200 text-slate-400"
            icon="○"
            loading={loading}
          />
          {/* Duplicates */}
          <MetricChip
            count={duplicates}
            label="duplicate row"
            emptyLabel="No duplicates"
            activeColor="bg-amber-50 border-amber-200 text-amber-700"
            emptyColor="bg-slate-50 border-slate-200 text-slate-400"
            icon="⇌"
            loading={loading}
          />
          {/* Outliers */}
          <MetricChip
            count={outlierCount}
            label="unusual value"
            emptyLabel="No unusual values"
            activeColor="bg-orange-50 border-orange-200 text-orange-700"
            emptyColor="bg-slate-50 border-slate-200 text-slate-400"
            icon="◇"
            loading={loading}
          />
          {/* Suggested fixes (rule-based data scan) */}
          {(suggestionCount > 0 || loading) && (
            <MetricChip
              count={suggestionCount}
              label="suggested fix"
              pluralLabel="suggested fixes"
              emptyLabel=""
              activeColor="bg-indigo-50 border-indigo-200 text-indigo-700"
              emptyColor="bg-slate-50 border-slate-200 text-slate-400"
              icon="✓"
              loading={loading}
            />
          )}
        </div>

        {/* Dataset stats */}
        <div className="ml-auto hidden lg:flex items-center gap-4 text-xs text-slate-400">
          <span>{plural(totalRows, "row")}</span>
          <span>·</span>
          <span>{plural(totalCols, "column")}</span>
          <span>·</span>
          <span>{totalCells.toLocaleString()} cells total</span>
        </div>
      </div>
    </div>
  );
}

// ── Internal chip ──────────────────────────────────────────────────────────────

interface MetricChipProps {
  count: number;
  label: string; // singular; "s" is added for other counts unless pluralLabel is given
  pluralLabel?: string;
  emptyLabel: string;
  activeColor: string;
  emptyColor: string;
  icon: string;
  loading: boolean;
}

function MetricChip({ count, label, pluralLabel, emptyLabel, activeColor, emptyColor, icon, loading }: MetricChipProps) {
  if (loading) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${emptyColor}`}>
        <span className="opacity-50">{icon}</span>
        <span className="opacity-50">…</span>
      </span>
    );
  }
  const isActive = count > 0;
  const colorClass = isActive ? activeColor : emptyColor;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${colorClass}`}>
      <span>{icon}</span>
      <span>{isActive ? plural(count, label, pluralLabel) : emptyLabel}</span>
    </span>
  );
}
