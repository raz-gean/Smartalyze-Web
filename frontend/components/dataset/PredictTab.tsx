"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyzeStatsResponse, PredictResponse } from "@/lib/api";

export interface PredictTabProps {
  availableColumns: string[];
  dateColumns: string[];
  analysisStats: AnalyzeStatsResponse | null;
  predictionResult: PredictResponse | null;
  predictionLoading: boolean;
  predictionInputColumn: string;
  setPredictionInputColumn: (v: string) => void;
  predictionTargetColumn: string;
  setPredictionTargetColumn: (v: string) => void;
  predictionSteps: number;
  setPredictionSteps: (v: number) => void;
  handleRunPrediction: () => void;
}

function InsightCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm italic text-sky-800">
      {text}
    </div>
  );
}

function getPredictionConfidence(rSquared: number): { label: string; badgeClasses: string } {
  if (rSquared >= 0.7) return { label: "High confidence — consistent historical data", badgeClasses: "bg-green-100 text-green-700" };
  if (rSquared >= 0.4) return { label: "Medium confidence — some variation in historical data", badgeClasses: "bg-yellow-100 text-yellow-700" };
  return { label: "Low confidence — irregular data; treat as a rough estimate", badgeClasses: "bg-red-100 text-red-700" };
}

function getPredictionTrend(slope: number): { label: "Trending Up" | "Trending Down" | "Stable"; badgeClasses: string } {
  if (slope > 0.01) return { label: "Trending Up", badgeClasses: "bg-green-100 text-green-700" };
  if (slope < -0.01) return { label: "Trending Down", badgeClasses: "bg-red-100 text-red-700" };
  return { label: "Stable", badgeClasses: "bg-slate-100 text-slate-600" };
}

export function PredictTab(props: PredictTabProps) {
  const {
    availableColumns,
    dateColumns,
    analysisStats,
    predictionResult,
    predictionLoading,
    predictionInputColumn,
    setPredictionInputColumn,
    predictionTargetColumn,
    setPredictionTargetColumn,
    predictionSteps,
    setPredictionSteps,
    handleRunPrediction,
  } = props;

  const numericColumns =
    analysisStats?.column_stats.filter((c) => c.dtype === "numeric").map((c) => c.name) ?? [];
  const forecastOptions = numericColumns.length > 0 ? numericColumns : availableColumns;

  return (
    <div className="space-y-6">
      {/* Guided workflow hint */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
        <p className="text-sm font-semibold text-indigo-800">How to use this tab</p>
        <p className="text-sm text-indigo-700 mt-0.5">
          Select a <strong>Date column</strong> (optional) for time-based forecasting, then choose a <strong>numeric column to forecast</strong>. Set how many steps ahead you want to predict, then click <strong>Run prediction</strong>. Best results with 20+ rows of consistent data.
        </p>
      </div>
      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
        <p className="text-sm font-semibold text-sky-900">ML-Based Predictions</p>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Smartalyze uses a machine learning regression model (linear regression) to fit a trend to your selected column and project it forward.{" "}
          <span className="text-slate-400">
            Best with 20+ rows of consistent numeric data. The date column is optional —
            if omitted, row order is used as the time axis.
          </span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="mb-1 block text-sm font-medium text-slate-900">Date column (optional)</span>
          <span className="mb-2 block text-xs text-slate-400">
            {dateColumns.length > 0 ? "Forecast by date, e.g. the next months" : "No date columns found; row order is used"}
          </span>
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            value={predictionInputColumn}
            onChange={(e) => setPredictionInputColumn(e.target.value)}
          >
            <option value="">None (use row order)</option>
            {dateColumns.map((col) => <option key={col} value={col}>{col}</option>)}
          </select>
        </label>

        <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="mb-1 block text-sm font-medium text-slate-900">Column to forecast</span>
          <span className="mb-2 block text-xs text-slate-400">Numeric columns give the best results</span>
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            value={predictionTargetColumn}
            onChange={(e) => setPredictionTargetColumn(e.target.value)}
          >
            {forecastOptions.map((col) => <option key={col} value={col}>{col}</option>)}
          </select>
        </label>

        <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="mb-2 block text-sm font-medium text-slate-900">Steps ahead</span>
          <input
            type="number"
            min={1}
            max={20}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            value={predictionSteps}
            onChange={(e) => setPredictionSteps(Math.max(1, Math.min(20, Number(e.target.value))))}
          />
        </label>

        <div className="flex items-end rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70"
            onClick={handleRunPrediction}
            disabled={predictionLoading}
          >
            {predictionLoading ? "Running..." : "Run prediction"}
          </button>
        </div>
      </div>

      {predictionResult && (() => {
        const lastPrediction = predictionResult.predictions[predictionResult.predictions.length - 1];
        const lastValue = lastPrediction ? lastPrediction.predicted_value : null;
        const confidence = getPredictionConfidence(predictionResult.r_squared);
        const trend = getPredictionTrend(predictionResult.slope);
        return (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trend.badgeClasses}`}>{trend.label}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confidence.badgeClasses}`}>{confidence.label} confidence</span>
            </div>
            <p className="mt-3 text-sm text-slate-700">
              If this continues,{" "}
              <span className="font-semibold text-slate-950">{predictionResult.target_column}</span>{" "}
              is expected to reach approximately{" "}
              <span className="font-semibold text-indigo-700">
                {lastValue !== null ? lastValue.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}
              </span>{" "}
              {lastPrediction?.label ? (
                <>by <span className="font-semibold text-slate-950">{lastPrediction.label}</span>.</>
              ) : (
                <>
                  in <span className="font-semibold text-slate-950">{predictionResult.future_steps}</span>{" "}
                  {predictionResult.future_steps === 1 ? "step" : "steps"}.
                </>
              )}
            </p>
          </div>
        );
      })()}

      {predictionResult && (
        <InsightCard text="Predictions use a linear trend model. Accuracy improves with more data — best results with 20 or more rows. Use the confidence badge above to judge how much to rely on these estimates." />
      )}

      {predictionResult && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">Forecast — {predictionResult.target_column}</h3>

            {predictionResult.predictions.length > 0 && (
              <div className="mt-4">
                <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={predictionResult.predictions.map((p) => ({
                      step: p.label ?? `Period ${p.step}`,
                      predicted: p.predicted_value,
                      lower: p.lower_bound,
                      upper: p.upper_bound,
                      band: [p.lower_bound, p.upper_bound],
                    }))}
                    margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id="predictBand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="step" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                      formatter={(v, name) => {
                        const val = typeof v === "number" ? v.toFixed(1) : String(v ?? "");
                        if (name === "upper") return [val, "Upper bound"];
                        if (name === "lower") return [val, "Lower bound"];
                        return [val, "Predicted"];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="upper"
                      stroke="none"
                      fill="url(#predictBand)"
                      fillOpacity={1}
                    />
                    <Area
                      type="monotone"
                      dataKey="lower"
                      stroke="none"
                      fill="#ffffff"
                      fillOpacity={1}
                    />
                    <Area
                      type="monotone"
                      dataKey="predicted"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="none"
                      dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                </div>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                  The shaded area shows the estimated range where the true value is likely to fall. A wider band means higher uncertainty.
                </p>
              </div>
            )}

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{predictionResult.time_column ? "Date" : "Period"}</th>
                    <th className="px-4 py-3 font-medium">Expected</th>
                    <th className="px-4 py-3 font-medium">Est. Range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {predictionResult.predictions.map((p) => (
                    <tr key={p.step}>
                      <td className="px-4 py-3 font-medium text-slate-700">{p.label ?? `Period ${p.step}`}</td>
                      <td className="px-4 py-3 font-semibold text-indigo-700">
                        {p.predicted_value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {p.lower_bound.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        {" – "}
                        {p.upper_bound.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {(() => {
            const confidence = getPredictionConfidence(predictionResult.r_squared);
            const slopeAbs = Math.abs(predictionResult.slope);
            const slopeSign = predictionResult.slope >= 0 ? "+" : "−";
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">Model</h3>
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div className="flex justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-slate-500">Trend rate</span>
                    <span className={`font-semibold ${predictionResult.slope >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {slopeSign}{slopeAbs.toFixed(slopeAbs < 1 ? 2 : 1)} per {predictionResult.time_column ? "day" : "period"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-slate-500">Forecast confidence</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confidence.badgeClasses}`}>
                      {confidence.label.split(" — ")[0]}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    Forecast uses a linear trend model. Accuracy improves with more data.
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {!predictionResult && !predictionLoading && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Choose a column to forecast and the number of steps ahead, then click <span className="font-medium text-slate-700">Run prediction</span>.
        </div>
      )}
    </div>
  );
}
