"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import type { AnomalyResponse, CorrelationMethod, CorrelationResponse } from "@/lib/api";

type DetectSubTab = "anomaly" | "correlation";

export interface DetectTabProps {
  anomalyData: AnomalyResponse | null;
  anomalyLoading: boolean;
  correlationData: CorrelationResponse | null;
  correlationLoading: boolean;
  correlationMethod: CorrelationMethod;
  setCorrelationMethod: (method: CorrelationMethod) => void;
  onSwitchTab?: (tab: "prepare" | "explore" | "detect" | "predict") => void;
}

function TipCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
      {text}
    </div>
  );
}

function InsightCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm italic text-sky-800">
      {text}
    </div>
  );
}

export function DetectTab(props: DetectTabProps) {
  const {
    anomalyData,
    anomalyLoading,
    correlationData,
    correlationLoading,
    correlationMethod,
    setCorrelationMethod,
    onSwitchTab,
  } = props;

  const [subTab, setSubTab] = useState<DetectSubTab>("anomaly");

  function renderAnomaly() {
    if (anomalyLoading) return <p className="text-sm text-slate-600">Running anomaly detection...</p>;

    const anomaly = anomalyData;

    return (
      <div className="space-y-6">
        <TipCard text="Outlier Detection — Smartalyze uses the IQR (Interquartile Range) statistical method to automatically identify outliers: values unusually far from the typical range of a column. They may be data entry errors or genuine extremes worth investigating." />

        {!anomaly ? (
          <p className="text-sm text-slate-600">Switch to this tab to run anomaly detection.</p>
        ) : anomaly.columns_analyzed === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
            No numeric columns found. Anomaly detection requires at least one numeric column.
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Columns analyzed</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{anomaly.columns_analyzed}</p>
              </div>
              <div className={`rounded-2xl border p-4 shadow-sm ${anomaly.total_flagged_rows > 0 ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50"}`}>
                <p className="text-sm text-slate-500">Total flagged rows</p>
                <p className={`mt-1 text-2xl font-semibold ${anomaly.total_flagged_rows > 0 ? "text-orange-700" : "text-green-700"}`}>
                  {anomaly.total_flagged_rows}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-500">Columns with outliers</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{anomaly.columns.filter((c) => c.outlier_count > 0).length}</p>
              </div>
            </div>

            {anomaly.columns.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">Outlier rate by column</h3>
                <div className="mt-4 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={anomaly.columns.map((c) => ({
                        column: c.column.length > 18 ? c.column.slice(0, 17) + "…" : c.column,
                        pct: c.outlier_pct,
                        fill: c.outlier_pct >= 10 ? "#ef4444" : c.outlier_pct >= 5 ? "#f59e0b" : "#6366f1",
                      }))}
                      margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="column" tick={{ fontSize: 11, fill: "#64748b" }} width={110} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                        formatter={(v) => [`${typeof v === "number" ? v.toFixed(1) : v}%`, "Outlier rate"]}
                      />
                      <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                        {anomaly.columns.map((c) => (
                          <Cell key={c.column} fill={c.outlier_pct >= 10 ? "#ef4444" : c.outlier_pct >= 5 ? "#f59e0b" : "#6366f1"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-950">Outliers per column</h3>
              <p className="mt-1 text-sm text-slate-600">Statistical range method — flags values that fall far outside the typical spread of each column.</p>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Column</th>
                      <th className="px-4 py-3 font-medium">Outliers</th>
                      <th className="px-4 py-3 font-medium">%</th>
                      <th className="px-4 py-3 font-medium">Lower fence</th>
                      <th className="px-4 py-3 font-medium">Upper fence</th>
                      <th className="px-4 py-3 font-medium">Samples</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {anomaly.columns.map((col) => (
                      <tr key={col.column}>
                        <td className="px-4 py-3 font-medium text-slate-950">{col.column}</td>
                        <td className="px-4 py-3">
                          <span className={col.outlier_count > 0 ? "font-semibold text-orange-700" : "text-slate-400"}>{col.outlier_count}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${col.outlier_pct > 15 ? "bg-red-500" : col.outlier_pct > 5 ? "bg-orange-400" : "bg-yellow-400"}`}
                                  style={{ width: `${Math.min(col.outlier_pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-500">{col.outlier_pct}%</span>
                            </div>
                            <span className={`text-xs font-medium ${col.outlier_pct > 15 ? "text-red-600" : col.outlier_pct > 5 ? "text-amber-600" : "text-green-600"}`}>
                              {col.outlier_pct > 15 ? "High — possible data quality issue" : col.outlier_pct > 5 ? "Moderate — worth reviewing" : "Low — likely safe to ignore"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{col.lower_fence}</td>
                        <td className="px-4 py-3 text-slate-600">{col.upper_fence}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{col.sample_outliers.slice(0, 3).map(String).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {anomaly.total_flagged_rows > 0 && (
              <div className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    {anomaly.total_flagged_rows} outlier row{anomaly.total_flagged_rows !== 1 ? "s" : ""} detected
                  </p>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    To remove or cap these values, go to the <strong>Prepare</strong> tab and use the cleaning tools. Cleaning will update the current dataset version.
                  </p>
                </div>
                {onSwitchTab && (
                  <button
                    type="button"
                    onClick={() => onSwitchTab("prepare")}
                    className="shrink-0 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500"
                  >
                    Go to Prepare →
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function renderCorrelation() {
    if (correlationLoading) return <p className="text-sm text-slate-600">Computing correlation matrix...</p>;

    const corr = correlationData;

    if (!corr || corr.columns.length < 2) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
          Correlation requires at least 2 numeric columns. Switch to this tab after uploading a dataset with numeric data.
        </div>
      );
    }

    const cols = corr.columns;
    const n = cols.length;

    let maxPos = { r: 0, a: "", b: "" };
    let maxNeg = { r: 0, a: "", b: "" };
    const allPairs: Array<{ colA: string; colB: string; r: number }> = [];
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        const val = corr.matrix[cols[i]]?.[cols[j]] ?? 0;
        if (val > maxPos.r) maxPos = { r: val, a: cols[i], b: cols[j] };
        if (val < maxNeg.r) maxNeg = { r: val, a: cols[i], b: cols[j] };
        if (!isNaN(val) && cols[i] !== cols[j]) {
          allPairs.push({ colA: cols[i], colB: cols[j], r: val });
        }
      }
    }
    const topPairs = allPairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 5);

    function cellColor(r: number): string {
      const abs = Math.abs(r);
      const lightness = Math.round(98 - abs * 48);
      if (r >= 0) return `hsl(220,70%,${lightness}%)`;
      return `hsl(0,70%,${lightness}%)`;
    }

    function textColor(r: number): string {
      return Math.abs(r) > 0.5 ? "#fff" : "#334155";
    }

    const CELL = 64;
    const LABEL_W = 100;
    const PAD = 8;
    const W = LABEL_W + n * CELL + PAD;
    const H = LABEL_W + n * CELL + PAD;

    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Columns analyzed</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{n}</p>
            {corr.total_columns > n && (
              <p className="mt-1 text-xs text-slate-400">of {corr.total_columns.toLocaleString()} numeric columns</p>
            )}
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm">
            <p className="text-sm text-slate-500">Strongest positive</p>
            {maxPos.a ? (
              <>
                <p className="mt-1 text-lg font-semibold text-indigo-700">{maxPos.r.toFixed(3)}</p>
                <p className="truncate text-xs text-slate-500">{maxPos.a} ↔ {maxPos.b}</p>
              </>
            ) : <p className="mt-1 text-sm text-slate-400">—</p>}
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 shadow-sm">
            <p className="text-sm text-slate-500">Strongest negative</p>
            {maxNeg.a ? (
              <>
                <p className="mt-1 text-lg font-semibold text-red-700">{maxNeg.r.toFixed(3)}</p>
                <p className="truncate text-xs text-slate-500">{maxNeg.a} ↔ {maxNeg.b}</p>
              </>
            ) : <p className="mt-1 text-sm text-slate-400">—</p>}
          </div>
        </div>

        {topPairs.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Top Relationships</p>
            <div className="space-y-1.5">
              {topPairs.map((p) => {
                const abs = Math.abs(p.r);
                const strength = abs >= 0.7 ? "strongly" : abs >= 0.4 ? "moderately" : "weakly";
                const direction = p.r > 0 ? "positively" : "negatively";
                return (
                  <div key={`${p.colA}-${p.colB}`} className="flex items-center gap-2.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${p.r > 0 ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span>&quot;{p.colA}&quot; and &quot;{p.colB}&quot; are <span className="font-medium">{strength} {direction} related</span> ({p.r.toFixed(2)})</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <InsightCard text="The diagonal always shows 1.0 — each column is perfectly correlated with itself. Values near +1 indicate columns that increase together; near −1 they move in opposite directions. Values near 0 mean no meaningful relationship." />

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Correlation Heatmap</h3>
              <p className="mt-1 text-sm text-slate-500">
                {correlationMethod === "pearson"
                  ? "Pearson correlation — measures linear relationships. Blue = positive, red = negative. Diagonal is always 1."
                  : "Spearman correlation — measures monotonic (rank-based) relationships. Robust to outliers and non-linear curves."}
              </p>
            </div>
            <div className="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setCorrelationMethod("pearson")}
                className={`rounded-full px-3 py-1.5 transition ${correlationMethod === "pearson" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                disabled={correlationLoading}
              >
                Pearson
              </button>
              <button
                type="button"
                onClick={() => setCorrelationMethod("spearman")}
                className={`rounded-full px-3 py-1.5 transition ${correlationMethod === "spearman" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                disabled={correlationLoading}
              >
                Spearman
              </button>
            </div>
          </div>

          {corr.total_columns > n && (
            <p className="mt-3 text-xs text-slate-500">
              Showing the {n} columns with the strongest overall correlations, out of {corr.total_columns.toLocaleString()} numeric columns.
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: W, height: H }}>
              {cols.map((col, j) => (
                <text
                  key={`ch-${j}`}
                  x={LABEL_W + j * CELL + CELL / 2}
                  y={LABEL_W - 8}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                  transform={`rotate(-45, ${LABEL_W + j * CELL + CELL / 2}, ${LABEL_W - 8})`}
                >
                  {col.length > 12 ? col.slice(0, 11) + "…" : col}
                </text>
              ))}
              {cols.map((col, i) => (
                <text
                  key={`rh-${i}`}
                  x={LABEL_W - 8}
                  y={LABEL_W + i * CELL + CELL / 2 + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                >
                  {col.length > 12 ? col.slice(0, 11) + "…" : col}
                </text>
              ))}
              {cols.map((row, i) =>
                cols.map((col, j) => {
                  const val = corr.matrix[row]?.[col] ?? 0;
                  const x = LABEL_W + j * CELL;
                  const y = LABEL_W + i * CELL;
                  return (
                    <g key={`${i}-${j}`}>
                      <rect x={x} y={y} width={CELL} height={CELL} fill={cellColor(val)} rx="2" />
                      <text
                        x={x + CELL / 2}
                        y={y + CELL / 2 + 4}
                        textAnchor="middle"
                        fontSize="10"
                        fill={textColor(val)}
                        fontWeight={i === j ? "700" : "400"}
                      >
                        {val.toFixed(2)}
                      </text>
                    </g>
                  );
                })
              )}
            </svg>
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-6 rounded" style={{ background: cellColor(1) }} /> Strong positive (+1)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-6 rounded" style={{ background: cellColor(0) }} /> No correlation (0)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-6 rounded" style={{ background: cellColor(-1) }} /> Strong negative (−1)
            </span>
          </div>
        </div>
      </div>
    );
  }

  const subTabs: { key: DetectSubTab; label: string }[] = [
    { key: "anomaly", label: "Anomaly Detection" },
    { key: "correlation", label: "Correlation" },
  ];

  return (
    <div className="space-y-6">

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

      {subTab === "anomaly" && renderAnomaly()}
      {subTab === "correlation" && renderCorrelation()}
    </div>
  );
}
