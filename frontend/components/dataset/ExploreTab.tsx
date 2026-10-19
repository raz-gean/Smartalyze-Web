"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import type {
  AIAnalyzeContext,
  AnalyzeStatsResponse,
  CleanApplyResponse,
  DistributionResponse,
  GroupByResponse,
  StructureSummaryResponse,
  TrendResponse,
} from "@/lib/api";
import { AIInsightPanel } from "@/components/dataset/AIInsightPanel";

type ExploreSubTab = "analysis" | "aggregation" | "trends";

// Trend chart boundaries: cap how many raw points ever get sent to Recharts, and
// clamp the Y-axis to the 1st-99th percentile so one extreme outlier can't
// auto-scale the axis and flatten the rest of the series.
const TREND_CHART_MAX_POINTS = 250;

// Uniform-stride sample that always keeps the first and last point, so the
// visible series start/end (and the trend-line overlay, which is anchored to
// them) still line up. Keeps each point's original array index so downstream
// interpolation math can stay correct after sampling.
function sampleTrendPoints<T>(points: T[], maxPoints: number): Array<{ point: T; originalIndex: number }> {
  const indexed = points.map((point, originalIndex) => ({ point, originalIndex }));
  if (indexed.length <= maxPoints) return indexed;
  const step = Math.ceil(indexed.length / maxPoints);
  const sampled = indexed.filter((_, i) => i % step === 0);
  const last = indexed[indexed.length - 1];
  if (sampled[sampled.length - 1]?.originalIndex !== last.originalIndex) sampled.push(last);
  return sampled;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

// Returns a clamped [min, max] Y-axis domain only when the 99th percentile is
// meaningfully below the true max (i.e. outliers would otherwise dominate the
// auto-scaled axis) -- well-behaved data renders with Recharts' normal
// auto-scale, unchanged from today.
function computeOutlierClampDomain(values: number[], trueMin: number, trueMax: number): [number, number] | null {
  if (values.length < 5 || trueMax === trueMin) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p1 = percentile(sorted, 1);
  const p99 = percentile(sorted, 99);
  const range = trueMax - trueMin;
  if ((trueMax - p99) / range <= 0.05 && (p1 - trueMin) / range <= 0.05) return null;
  const padding = (p99 - p1) * 0.1 || range * 0.1;
  return [p1 - padding, p99 + padding];
}

export interface ExploreTabProps {
  workspace: { dataset: { row_count?: number | null; column_count?: number | null; summary_json?: Record<string, unknown> | null } } | null;
  availableColumns: string[];
  analysisStats: AnalyzeStatsResponse | null;
  analysisLoading: boolean;
  structureSummary: StructureSummaryResponse | null;
  selectedDistColumn: string | null;
  setSelectedDistColumn: (col: string | null) => void;
  distributionData: DistributionResponse | null;
  setDistributionData: (data: DistributionResponse | null) => void;
  distributionLoading: boolean;
  aggregationGroupBy: string;
  setAggregationGroupBy: (v: string) => void;
  aggregateColumn: string;
  setAggregateColumn: (v: string) => void;
  aggregationOperation: string;
  setAggregationOperation: (v: string) => void;
  groupResult: GroupByResponse | null;
  groupLoading: boolean;
  saveGroupAsOpen: boolean;
  setSaveGroupAsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  saveGroupAsName: string;
  setSaveGroupAsName: (v: string) => void;
  saveGroupAsSaving: boolean;
  trendData: TrendResponse | null;
  trendLoading: boolean;
  selectedTrendColumn: string;
  setSelectedTrendColumn: (v: string) => void;
  cleaningResult: CleanApplyResponse | null;
  setShowSaveModal: (v: boolean) => void;
  setActiveGroupTab: (tab: "prepare" | "explore" | "detect" | "predict") => void;
  handleGenerateAggregation: () => void;
  handleExportGroupCSV: () => void;
  handleSaveGroupAsDataset: () => void;
  aiContext: AIAnalyzeContext | null;
  token: string;
}

function InsightCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm italic text-sky-800">
      {text}
    </div>
  );
}

export function ExploreTab(props: ExploreTabProps) {
  const {
    workspace,
    availableColumns,
    analysisStats,
    analysisLoading,
    structureSummary,
    selectedDistColumn,
    setSelectedDistColumn,
    distributionData,
    setDistributionData,
    distributionLoading,
    aggregationGroupBy,
    setAggregationGroupBy,
    aggregateColumn,
    setAggregateColumn,
    aggregationOperation,
    setAggregationOperation,
    groupResult,
    groupLoading,
    saveGroupAsOpen,
    setSaveGroupAsOpen,
    saveGroupAsName,
    setSaveGroupAsName,
    saveGroupAsSaving,
    trendData,
    trendLoading,
    selectedTrendColumn,
    setSelectedTrendColumn,
    cleaningResult,
    setShowSaveModal,
    setActiveGroupTab,
    handleGenerateAggregation,
    handleExportGroupCSV,
    handleSaveGroupAsDataset,
    aiContext,
    token,
  } = props;

  const [subTab, setSubTab] = useState<ExploreSubTab>("analysis");

  function renderAnalysis() {
    if (analysisLoading) {
      return <p className="text-sm text-slate-600">Loading column statistics...</p>;
    }

    const stats = analysisStats;
    const numericCols = stats?.column_stats.filter((c) => c.dtype === "numeric") ?? [];
    const colsWithMissing = stats?.column_stats.filter((c) => c.missing > 0) ?? [];
    const mostMissingCol = [...colsWithMissing].sort((a, b) => b.missing_pct - a.missing_pct)[0] ?? null;

    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total rows</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">
              {stats?.row_count ?? workspace?.dataset.row_count ?? "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total columns</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">
              {stats?.col_count ?? workspace?.dataset.column_count ?? "-"}
            </p>
          </div>
          <div className={`rounded-2xl border p-4 shadow-sm ${colsWithMissing.length > 0 ? "border-yellow-200 bg-yellow-50" : "border-green-200 bg-green-50"}`}>
            <p className="text-sm text-slate-500">Columns with missing</p>
            <p className={`mt-1 text-2xl font-semibold ${colsWithMissing.length > 0 ? "text-yellow-800" : "text-green-800"}`}>
              {stats ? colsWithMissing.length : "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Numeric columns</p>
            <p className="mt-1 text-2xl font-semibold text-indigo-600">{stats ? numericCols.length : "-"}</p>
          </div>
        </div>

        {cleaningResult && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>Analysis reflects original data. Save your cleaned result to analyze the cleaned version.</span>
            <button
              type="button"
              className="shrink-0 font-medium underline underline-offset-4 decoration-amber-400 hover:text-amber-900"
              onClick={() => setShowSaveModal(true)}
            >
              Save now →
            </button>
          </div>
        )}

        {structureSummary && structureSummary.columns.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">Column Overview</h3>
            <p className="mt-1 text-sm text-slate-500">Quick breakdown of each column — type, missing values, and most common value.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {structureSummary.columns.map((col) => {
                const kindColors: Record<string, string> = {
                  Numbers: "bg-indigo-100 text-indigo-700",
                  Text: "bg-slate-100 text-slate-600",
                  Dates: "bg-purple-100 text-purple-700",
                  Boolean: "bg-orange-100 text-orange-700",
                };
                const kindTooltips: Record<string, string> = {
                  Numbers: "Numeric column — supports mean, sum, and correlation",
                  Text: "Text column — supports grouping and frequency analysis",
                  Dates: "Date column — supports trend analysis",
                  Boolean: "True/False column",
                };
                const kindClass = kindColors[col.kind] ?? "bg-slate-100 text-slate-600";
                const topVal = col.top_values[0];
                return (
                  <div key={col.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-950">{col.name}</p>
                      <span className={`shrink-0 cursor-help rounded-full px-2 py-0.5 text-xs font-medium ${kindClass}`} title={kindTooltips[col.kind] ?? col.kind}>
                        {col.kind}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-500">
                      <span>
                        Unique: <span className="font-medium text-slate-700">{col.unique_values}</span>
                        {col.unique_values === 1 && (
                          <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700" title="Only 1 unique value — consider dropping">1 value</span>
                        )}
                      </span>
                      <span className={col.missing_values > 0 ? "text-amber-600" : ""}>
                        Missing: <span className="font-medium">{col.missing_values}</span>
                      </span>
                      {topVal != null && (
                        <span className="col-span-2 truncate">Top: <span className="font-medium text-slate-700">{String(topVal.value)}</span></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">Column summaries</h3>
            {stats ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Column</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Non-null</th>
                      <th className="px-4 py-3 font-medium">Missing %</th>
                      <th className="px-4 py-3 font-medium">Unique</th>
                      <th className="px-4 py-3 font-medium">Mean / Min / Max</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                    {stats.column_stats.map((col) => {
                      const isSelected = selectedDistColumn === col.name;
                      return (
                        <tr
                          key={col.name}
                          className={`cursor-pointer transition hover:bg-indigo-50/40 ${isSelected ? "bg-indigo-50/60" : ""}`}
                          onClick={() => setSelectedDistColumn(isSelected ? null : col.name)}
                          title="Click to view distribution"
                        >
                          <td className="px-4 py-3 font-medium text-slate-950">
                            <span className="inline-flex items-center gap-2">
                              {isSelected ? <span className="text-indigo-600">▾</span> : <span className="text-slate-300">▸</span>}
                              {col.name}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              col.dtype === "numeric" ? "bg-indigo-100 text-indigo-700" :
                              col.dtype === "datetime" ? "bg-purple-100 text-purple-700" :
                              col.dtype === "boolean" ? "bg-orange-100 text-orange-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>
                              {col.dtype}
                            </span>
                          </td>
                          <td className="px-4 py-3">{col.count}</td>
                          <td className={`px-4 py-3 font-medium ${col.missing_pct > 0 ? "text-yellow-700" : "text-green-700"}`}>
                            {col.missing_pct > 0 ? `${col.missing_pct}%` : "—"}
                          </td>
                          <td className="px-4 py-3">{col.unique}</td>
                          <td className="px-4 py-3 text-slate-500">
                            {col.dtype === "numeric" && col.mean != null
                              ? `${col.mean} / ${col.min ?? "?"} / ${col.max ?? "?"}`
                              : col.top_values[0] != null
                              ? String(col.top_values[0].value)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">Switch to this tab to load statistics.</p>
            )}

            {selectedDistColumn ? (
              <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-indigo-600">Distribution</p>
                    <h4 className="mt-0.5 text-base font-semibold text-slate-950">{selectedDistColumn}</h4>
                  </div>
                  <button
                    type="button"
                    className="rounded-full px-2 py-0.5 text-lg leading-none text-slate-400 transition hover:bg-white hover:text-slate-700"
                    onClick={() => { setSelectedDistColumn(null); setDistributionData(null); }}
                    aria-label="Close distribution"
                  >
                    ×
                  </button>
                </div>

                {distributionLoading ? (
                  <p className="mt-3 text-sm text-slate-600">Loading distribution…</p>
                ) : !distributionData || distributionData.bins.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-600">No distribution data available for this column.</p>
                ) : (() => {
                  const dist = distributionData;
                  return (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{dist.kind}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{dist.total_count} rows</span>
                        {dist.missing_count > 0 && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{dist.missing_count} missing</span>
                        )}
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{dist.unique_count} unique</span>
                        {dist.kind === "numeric" && dist.mean != null && (
                          <>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">mean {dist.mean}</span>
                            {dist.median != null && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">median {dist.median}</span>}
                            {dist.std != null && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">σ {dist.std}</span>}
                          </>
                        )}
                      </div>

                      {dist.kind === "categorical" || dist.kind === "boolean" || dist.kind === "datetime" ? (
                        <div className="space-y-1.5">
                          {dist.bins.map((bin) => {
                            const maxCount = Math.max(...dist.bins.map((b) => b.count), 1);
                            const widthPct = (bin.count / maxCount) * 100;
                            return (
                              <div key={bin.label} className="flex items-center gap-3 text-xs">
                                <span className="w-32 shrink-0 truncate text-slate-700" title={bin.label}>{bin.label}</span>
                                <div className="relative h-5 flex-1 overflow-hidden rounded bg-white">
                                  <div className="h-full rounded bg-indigo-500" style={{ width: `${Math.max(widthPct, 2)}%` }} />
                                </div>
                                <span className="w-12 shrink-0 text-right font-medium text-slate-700">{bin.count}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="h-44">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={dist.bins.map((b) => ({
                                label: b.bin_start != null ? Number(b.bin_start).toFixed(1) : b.label,
                                count: b.count,
                              }))}
                              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={36} />
                              <Tooltip
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                labelFormatter={(v) => `${selectedDistColumn}: ${v}`}
                              />
                              <Bar dataKey="count" fill="#6366f1" radius={[2, 2, 0, 0]} />
                              {dist.kind === "numeric" && dist.mean != null && (
                                <ReferenceLine
                                  x={Number(dist.mean).toFixed(1)}
                                  stroke="#dc2626"
                                  strokeDasharray="4 3"
                                  strokeWidth={1.5}
                                  label={{ value: "mean", position: "top", fontSize: 9, fill: "#dc2626" }}
                                />
                              )}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : stats ? (
              <p className="mt-4 text-xs text-slate-500">Click any column above to see its distribution.</p>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">Insights</h3>
            {stats ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">
                  {numericCols.length > 0
                    ? `${numericCols.length} numeric column${numericCols.length === 1 ? "" : "s"} detected. Use the Aggregation tab to summarize them.`
                    : "No numeric columns detected in this dataset."}
                </div>
                {colsWithMissing.length > 0 ? (
                  <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>
                        {colsWithMissing.length} column{colsWithMissing.length === 1 ? " has" : "s have"} missing values.
                        {mostMissingCol ? ` Highest: "${mostMissingCol.name}" (${mostMissingCol.missing_pct}%).` : ""}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-medium underline decoration-yellow-500 underline-offset-4 hover:text-yellow-900"
                        onClick={() => setActiveGroupTab("prepare")}
                      >
                        Fix in Cleaning →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                    No missing values detected across all columns.
                  </div>
                )}
                {(workspace?.dataset.summary_json?.duplicate_rows as number) > 0 && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {String(workspace?.dataset.summary_json?.duplicate_rows)} duplicate rows found. Clean them in the Prepare tab.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-600">Insights will appear once statistics are loaded.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderAggregation() {
    // Derive type-filtered column lists from analysisStats (falls back to all columns if stats not loaded)
    const groupableColumns =
      analysisStats?.column_stats.filter((c) => c.dtype !== "numeric").map((c) => c.name) ?? [];
    const numericColumns =
      analysisStats?.column_stats.filter((c) => c.dtype === "numeric").map((c) => c.name) ?? [];
    const groupByOptions = groupableColumns.length > 0 ? groupableColumns : availableColumns;
    const aggregateOptions = numericColumns.length > 0 ? numericColumns : availableColumns;

    const isCount = aggregationOperation === "count";
    const opLabel = aggregationOperation === "mean"
      ? "Average"
      : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1);

    return (
      <div className="space-y-6">
        {/* Guidance banner */}
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
          <p className="text-sm font-semibold text-indigo-800">Aggregate your data</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Group rows by a category and compute a summary value per group.{" "}
            <span className="text-slate-400">
              Example: total sales per region, average rating per product category.
            </span>
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="mb-2 block text-sm font-medium text-slate-900">Group by</span>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              value={aggregationGroupBy}
              onChange={(e) => setAggregationGroupBy(e.target.value)}
            >
              {groupByOptions.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">Categorical or text column</p>
          </label>

          {isCount ? (
            <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-sm font-medium text-slate-400">Aggregate column</span>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Not needed for Count — rows per group are tallied automatically.
              </p>
            </div>
          ) : (
            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-2 block text-sm font-medium text-slate-900">Aggregate column</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={aggregateColumn}
                onChange={(e) => setAggregateColumn(e.target.value)}
              >
                {aggregateOptions.map((col) => <option key={col} value={col}>{col}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-slate-400">Numeric column to compute</p>
            </label>
          )}

          <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="mb-2 block text-sm font-medium text-slate-900">Function</span>
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              value={aggregationOperation}
              onChange={(e) => setAggregationOperation(e.target.value)}
            >
              <option value="sum">Sum</option>
              <option value="mean">Average (mean)</option>
              <option value="count">Count</option>
              <option value="min">Min</option>
              <option value="max">Max</option>
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              {isCount ? "Rows per group" : "Applied to aggregate column"}
            </p>
          </label>

          <div className="flex items-end rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleGenerateAggregation}
              disabled={groupLoading || availableColumns.length === 0}
            >
              {groupLoading ? "Generating…" : "Generate result"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">Result table</h3>
          {groupResult ? (
            <p className="mt-1 text-sm text-slate-600">
              {isCount
                ? <>Row count per <strong>{groupResult.group_by}</strong> — {groupResult.total_groups.toLocaleString()} groups, sorted by count.</>
                : <>{opLabel} of <strong>{groupResult.aggregate_column}</strong> grouped by <strong>{groupResult.group_by}</strong> — {groupResult.total_groups.toLocaleString()} groups, sorted by value.</>
              }
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">Configure the fields above and click Generate result to see your summary.</p>
          )}

          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            {groupResult && groupResult.results.length > 0 ? (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">{groupResult.group_by}</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">
                      {groupResult.aggregate_func === "count"
                        ? "Rows"
                        : `${groupResult.aggregate_func === "mean" ? "Average" : groupResult.aggregate_func.charAt(0).toUpperCase() + groupResult.aggregate_func.slice(1)} of ${groupResult.aggregate_column}`}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {groupResult.results.map((row, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 font-medium text-slate-950">{row.group}</td>
                      <td className="px-4 py-3 text-slate-800">{row.value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-sm text-slate-600">
                {groupResult ? "No groups found in the selected column." : "Results will appear here after you generate."}
              </div>
            )}
          </div>
          {groupResult && groupResult.total_groups > groupResult.results.length && (
            <p className="mt-2 text-xs text-slate-500">
              Showing top {groupResult.results.length.toLocaleString()} of {groupResult.total_groups.toLocaleString()} groups, sorted by {isCount ? "count" : "value"}.
            </p>
          )}

          {groupResult && groupResult.results.length > 0 && (
            <>
              <div className="mt-5 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={groupResult.results.slice(0, 15).map((r) => ({
                      group: r.group.length > 18 ? r.group.slice(0, 17) + "…" : r.group,
                      value: r.value,
                    }))}
                    margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis type="category" dataKey="group" tick={{ fontSize: 11, fill: "#64748b" }} width={110} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                      formatter={(v) => [typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(v ?? ""), groupResult.aggregate_func === "count" ? "Rows" : groupResult.aggregate_column]}
                    />
                    <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]}>
                      {groupResult.results.slice(0, 15).map((_, i) => (
                        <Cell key={i} fill="#6366f1" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {groupResult.total_groups > 15 && (
                <p className="mt-2 text-xs text-slate-500">
                  Chart shows the top 15 of {groupResult.total_groups.toLocaleString()} groups.
                </p>
              )}

              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExportGroupCSV}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSaveGroupAsOpen((v) => !v); setSaveGroupAsName(""); }}
                    className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
                  >
                    Save as new dataset
                  </button>
                </div>

                {saveGroupAsOpen && (
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
                    <p className="mb-3 text-sm font-medium text-slate-800">Save aggregation as a new dataset</p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        placeholder={`${groupResult.group_by} ${aggregationOperation} ${groupResult.aggregate_column}`}
                        value={saveGroupAsName}
                        onChange={(e) => setSaveGroupAsName(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSaveGroupAsDataset}
                        disabled={saveGroupAsSaving}
                        className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70"
                      >
                        {saveGroupAsSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveGroupAsOpen(false)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Leave the name blank to use the default. The dataset will appear in your dashboard.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderTrends() {
    if (trendLoading) return <p className="text-sm text-slate-600">Loading trend analysis...</p>;

    const numericCols = trendData?.columns ?? [];
    const activeTrend = numericCols.find((c) => c.column === selectedTrendColumn) ?? numericCols[0] ?? null;

    function directionBadge(dir: string) {
      const map: Record<string, string> = {
        increasing: "bg-green-100 text-green-700",
        decreasing: "bg-red-100 text-red-700",
        stable: "bg-yellow-100 text-yellow-700",
        volatile: "bg-orange-100 text-orange-700",
      };
      return map[dir] ?? "bg-slate-100 text-slate-600";
    }

    function directionLabel(dir: string) {
      const map: Record<string, string> = {
        increasing: "Going up over time",
        decreasing: "Going down over time",
        stable: "Relatively flat — little change over time",
        volatile: "High variation — no clear direction",
      };
      return map[dir] ?? dir;
    }

    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
          <p className="text-sm font-semibold text-violet-800">AI-Powered Trend Analysis</p>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            Select a numeric column to detect how values change across rows using linear regression.{" "}
            <span className="text-slate-400">
              The ML model fits a trend line to reveal the underlying direction and filters out noise.
            </span>
          </p>
        </div>

        {numericCols.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
            No numeric columns found. Upload a dataset with numeric data to see trends.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-900">Column</span>
                <select
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                  value={selectedTrendColumn}
                  onChange={(e) => setSelectedTrendColumn(e.target.value)}
                >
                  {numericCols.map((c) => <option key={c.column} value={c.column}>{c.column}</option>)}
                </select>
              </label>
              {activeTrend && (
                <span className={`mt-5 rounded-full px-3 py-1 text-xs font-semibold ${directionBadge(activeTrend.direction)}`}>
                  {directionLabel(activeTrend.direction)}
                </span>
              )}
            </div>

            {activeTrend && (
              <>
                <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
                  {[
                    { label: "Min", value: activeTrend.min },
                    { label: "Max", value: activeTrend.max },
                    { label: "Mean", value: activeTrend.mean },
                    { label: "Slope", value: activeTrend.slope },
                    { label: "R²", value: activeTrend.r_squared },
                    { label: "Points", value: activeTrend.count },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-950">{String(value)}</p>
                    </div>
                  ))}
                </div>

                <InsightCard text="R² measures how well the trend line fits your data. Above 0.7 = strong trend. Below 0.3 = weak or noisy pattern — the trend line may not be reliable." />

                {activeTrend.chart_points.length >= 2 && (() => {
                  const totalPoints = activeTrend.chart_points.length;
                  const sampled = sampleTrendPoints(activeTrend.chart_points, TREND_CHART_MAX_POINTS);
                  const isSampled = sampled.length < totalPoints;
                  const yClamp = computeOutlierClampDomain(
                    activeTrend.chart_points.map((p) => p.y),
                    activeTrend.min,
                    activeTrend.max,
                  );
                  const trendSlopePerStep =
                    activeTrend.trend_line[0] && activeTrend.trend_line[1]
                      ? (activeTrend.trend_line[1].y - activeTrend.trend_line[0].y) / (totalPoints - 1 || 1)
                      : null;

                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="mb-1 text-sm font-semibold text-slate-950">
                        Trend chart — <span className="text-indigo-600">{activeTrend.column}</span>
                        <span className="ml-2 text-xs font-normal text-slate-400">(indigo = data series, dashed = trend line)</span>
                      </h3>
                      {isSampled && (
                        <p className="mb-1 text-xs text-slate-400">
                          Showing {sampled.length.toLocaleString()} of {totalPoints.toLocaleString()} points (sampled for readability).
                        </p>
                      )}
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={sampled.map(({ point, originalIndex }) => ({
                              x: originalIndex,
                              value: point.y,
                              trend: trendSlopePerStep !== null && activeTrend.trend_line[0]
                                ? activeTrend.trend_line[0].y + trendSlopePerStep * originalIndex
                                : null,
                            }))}
                            margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="x" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                            <YAxis
                              tick={{ fontSize: 10, fill: "#94a3b8" }}
                              width={40}
                              domain={yClamp ?? undefined}
                              allowDataOverflow={yClamp !== null}
                            />
                            <Tooltip
                              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                              formatter={(v, name) => [typeof v === "number" ? v.toFixed(2) : String(v ?? ""), name === "trend" ? "Trend line" : activeTrend.column]}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#6366f1"
                              strokeWidth={2}
                              dot={false}
                              name="value"
                            />
                            <Line
                              type="monotone"
                              dataKey="trend"
                              stroke={activeTrend.direction === "increasing" ? "#22c55e" : "#ef4444"}
                              strokeWidth={1.5}
                              strokeDasharray="6 4"
                              dot={false}
                              name="trend"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      {yClamp && (
                        <p className="mt-2 text-xs text-slate-400">
                          Y-axis range clipped to the 1st–99th percentile to keep the chart readable (full range: {activeTrend.min} to {activeTrend.max}).
                        </p>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </>
        )}
      </div>
    );
  }

  const subTabs: { key: ExploreSubTab; label: string }[] = [
    { key: "analysis", label: "Column Analysis" },
    { key: "aggregation", label: "Aggregation" },
    { key: "trends", label: "Trends" },
  ];

  return (
    <div className="space-y-6">
      <AIInsightPanel
        context={aiContext}
        token={token}
        contextKey={aiContext?.dataset_name ?? ""}
      />

      {/* Guided workflow hint */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
        <p className="text-sm font-semibold text-indigo-800">How to use this tab</p>
        <p className="text-sm text-indigo-700 mt-0.5">
          Use <strong>Column Analysis</strong> to see statistics (mean, min, max) for each column and explore distributions. Switch to <strong>Aggregation</strong> to group your data and compute totals or averages. Use <strong>Trends</strong> to detect patterns over time.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {subTabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              subTab === key
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "analysis" && renderAnalysis()}
      {subTab === "aggregation" && renderAggregation()}
      {subTab === "trends" && renderTrends()}
    </div>
  );
}
