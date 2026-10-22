"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Dataset, deleteDataset, getCurrentUser, listDatasets, renameDataset, uploadDataset } from "@/lib/api";
import { clearStoredToken, getStoredToken, signOut } from "@/lib/auth";
import { computeHealthScore } from "@/lib/health";

type DatasetSortKey = "recent" | "name" | "size";

const CHART_COLORS = {
  good: "#22c55e",
  fair: "#f59e0b",
  needsWork: "#ef4444",
  missing: "#f59e0b",
  duplicate: "#ef4444",
  invalid: "#f97316",
};

function getDeductions(dataset: Dataset) {
  const health = computeHealthScore(dataset.summary_json, dataset.row_count ?? 0, dataset.column_count ?? 1);
  return { ...health, classes: health.badgeClasses, borderColor: health.color };
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type StatCardProps = { title: string; value: string; sub: string; accent: string };

function StatCard({ title, value, sub, accent }: StatCardProps) {
  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className={`mb-3 h-1 w-10 rounded-full ${accent}`} />
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingMessage, setUploadingMessage] = useState("Uploading…");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const ocrProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<DatasetSortKey>("recent");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) { router.replace("/login"); return; }
    setToken(storedToken);
    Promise.all([getCurrentUser(storedToken), listDatasets(storedToken)])
      .then(([user, datasetList]) => { setUsername(user.username); setDatasets(datasetList); })
      .catch(() => { clearStoredToken(); router.replace("/login"); })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    return () => { if (ocrProgressTimerRef.current !== null) clearInterval(ocrProgressTimerRef.current); };
  }, []);

  async function refreshDatasets(t?: string) {
    const tok = t ?? token;
    if (!tok) return;
    const list = await listDatasets(tok);
    setDatasets(list);
  }

  // OCR extraction has no real progress signal from the backend (it's a single
  // blocking call, no streaming channel) -- simulate a smooth, decelerating climb
  // toward ~92% so the bar keeps visibly moving instead of sitting on a spinner,
  // then snap to 100% once the real response actually arrives.
  function startSimulatedOcrProgress() {
    stopSimulatedOcrProgress();
    setUploadProgress(0);
    ocrProgressTimerRef.current = setInterval(() => {
      setUploadProgress((prev) => {
        const current = prev ?? 0;
        if (current >= 0.92) return current;
        const remaining = 0.92 - current;
        return current + remaining * 0.08;
      });
    }, 200);
  }

  function stopSimulatedOcrProgress() {
    if (ocrProgressTimerRef.current !== null) {
      clearInterval(ocrProgressTimerRef.current);
      ocrProgressTimerRef.current = null;
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const tok = token ?? getStoredToken();
    if (!tok) { toast.warning("You need to be logged in to upload."); return; }
    const isImage = /\.(png|jpe?g)$/i.test(file.name);
    setUploadingMessage(isImage ? "Uploading…" : "Uploading…");
    setUploadProgress(0);
    setUploading(true);
    try {
      await uploadDataset(file, isImage ? "Uploaded via OCR" : "Dashboard upload", tok, (fraction) => {
        setUploadProgress(fraction);
        if (fraction >= 1) {
          setUploadingMessage(isImage ? "Extracting table from image…" : "Processing…");
          if (isImage) startSimulatedOcrProgress();
        }
      });
      setUploadProgress(1);
      event.target.value = "";
      await refreshDatasets(tok);
      toast.success(isImage ? "Image table extracted and saved as dataset." : "Dataset uploaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      stopSimulatedOcrProgress();
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleLoadSample() {
    const tok = token ?? getStoredToken();
    if (!tok) { toast.warning("You need to be logged in."); return; }
    setLoadingSample(true);
    try {
      const res = await fetch("/sample-dataset.csv");
      const blob = await res.blob();
      const file = new File([blob], "sample-dataset.csv", { type: "text/csv" });
      await uploadDataset(file, "Sample dataset with messy sales data", tok);
      await refreshDatasets(tok);
      toast.success("Sample dataset loaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load sample.");
    } finally {
      setLoadingSample(false);
    }
  }

  async function handleConfirmDelete() {
    const tok = token ?? getStoredToken();
    if (!tok || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDataset(deleteTarget.id, tok);
      await refreshDatasets(tok);
      toast.success(`Deleted "${deleteTarget.original_filename}".`);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  function startRename(dataset: Dataset) {
    setRenameTargetId(dataset.id);
    setRenameValue(dataset.original_filename);
  }

  function cancelRename() {
    setRenameTargetId(null);
    setRenameValue("");
  }

  async function handleConfirmRename() {
    const tok = token ?? getStoredToken();
    const name = renameValue.trim();
    if (!tok || renameTargetId === null) return;
    if (!name) { toast.warning("Name cannot be empty."); return; }
    setRenaming(true);
    try {
      await renameDataset(renameTargetId, name, tok);
      await refreshDatasets(tok);
      toast.success(`Renamed to "${name}".`);
      cancelRename();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rename failed.");
    } finally {
      setRenaming(false);
    }
  }

  function handleLogout() { signOut(); router.replace("/login"); }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    const tok = token ?? getStoredToken();
    if (!tok) { toast.warning("You need to be logged in to upload."); return; }
    const isImage = /\.(png|jpe?g)$/i.test(file.name);
    setUploadingMessage("Uploading…");
    setUploadProgress(0);
    setUploading(true);
    try {
      await uploadDataset(file, isImage ? "Uploaded via OCR" : "Dashboard upload", tok, (fraction) => {
        setUploadProgress(fraction);
        if (fraction >= 1) {
          setUploadingMessage(isImage ? "Extracting table from image…" : "Processing…");
          if (isImage) startSimulatedOcrProgress();
        }
      });
      setUploadProgress(1);
      await refreshDatasets(tok);
      toast.success(isImage ? "Image table extracted and saved." : "Dataset uploaded successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      stopSimulatedOcrProgress();
      setUploading(false);
      setUploadProgress(null);
    }
  }

  // Derived data
  const byLatest = [...datasets].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const trimmed = searchQuery.trim().toLowerCase();
  const filtered = trimmed
    ? byLatest.filter((d) => (d.original_filename ?? "").toLowerCase().includes(trimmed) || (d.description ?? "").toLowerCase().includes(trimmed))
    : byLatest;
  const sorted = (() => {
    const copy = [...filtered];
    if (sortKey === "name") return copy.sort((a, b) => (a.original_filename ?? "").localeCompare(b.original_filename ?? ""));
    if (sortKey === "size") return copy.sort((a, b) => Number(b.row_count ?? 0) - Number(a.row_count ?? 0));
    return copy;
  })();

  const totalRows = datasets.reduce((s, d) => s + Number(d.row_count ?? 0), 0);
  const totalColumns = datasets.reduce((s, d) => s + Number(d.column_count ?? 0), 0);
  const healthCounts = datasets.reduce((acc, d) => {
    const label = getDeductions(d).label;
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const cleanDatasets = (healthCounts["Great"] ?? 0) + (healthCounts["Good"] ?? 0);

  const qualityPieData = [
    { name: "Great", value: healthCounts["Great"] ?? 0, fill: CHART_COLORS.good },
    { name: "Good",  value: healthCounts["Good"]  ?? 0, fill: "#14b8a6" },
    { name: "Fair",  value: healthCounts["Fair"]  ?? 0, fill: CHART_COLORS.fair },
    { name: "Needs Work", value: healthCounts["Needs Work"] ?? 0, fill: CHART_COLORS.needsWork },
  ].filter((d) => d.value > 0);

  const totalIssues = datasets.reduce(
    (acc, d) => {
      const s = d.summary_json ?? {};
      acc.missing   += Number(s.missing_cells ?? 0);
      acc.duplicate += Number(s.duplicate_rows ?? 0);
      acc.invalid   += Number(s.type_issue_columns ?? 0) + Number(s.pseudo_null_columns ?? 0);
      return acc;
    },
    { missing: 0, duplicate: 0, invalid: 0 },
  );
  const issuesBarData = [
    { name: "Missing Values", count: totalIssues.missing,   fill: CHART_COLORS.missing },
    { name: "Duplicates",     count: totalIssues.duplicate, fill: CHART_COLORS.duplicate },
    { name: "Type / Format",  count: totalIssues.invalid,   fill: CHART_COLORS.invalid },
  ].filter((d) => d.count > 0);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">

        {/* Page Header */}
        <header className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">Smartalyze</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
              {username ? `Welcome back, ${username}` : "Your Datasets"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">Turn raw data into clean, actionable insights.</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} className="hidden" type="file" accept=".csv,.xlsx,.xls,.json,.png,.jpg,.jpeg" onChange={handleUpload} />
            <button
              type="button"
              className="rounded-xl border border-indigo-200 bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? uploadingMessage : "Upload"}
            </button>
            {byLatest.length > 0 && (
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                onClick={() => router.push(`/dataset/${byLatest[0].id}`)}
              >
                Open Recent
              </button>
            )}
          </div>
        </header>

        {/* Main split layout */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">

          {/* LEFT: Dataset Panel */}
          <aside className="flex h-full flex-col rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Datasets</h2>
                {datasets.length > 0 && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    {datasets.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-28 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-900 outline-none transition focus:border-indigo-400 focus:w-36"
                />
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as DatasetSortKey)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition focus:border-indigo-400"
                >
                  <option value="recent">Recent</option>
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                </select>
              </div>
            </div>

            {/* Dataset list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {datasets.length === 0 ? (
                /* Empty state: indigo drop zone */
                <div
                  role="button"
                  tabIndex={0}
                  className={`m-4 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-10 transition-colors cursor-pointer ${
                    isDragging ? "border-indigo-500 bg-indigo-100" : "border-indigo-300 bg-indigo-50 hover:border-indigo-400 hover:bg-indigo-100/70"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => { void handleDrop(e); }}
                  onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!uploading) fileInputRef.current?.click(); } }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none"
                    stroke={isDragging ? "#4f46e5" : "#6366f1"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true">
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                    <path d="M12 12v9" />
                    <path d="m16 16-4-4-4 4" />
                  </svg>
                  <div className="text-center px-4">
                    <p className={`text-sm font-semibold ${isDragging ? "text-indigo-700" : "text-indigo-600"}`}>
                      {uploading ? uploadingMessage : "Drag & Drop files here"}
                    </p>
                    {!uploading && (
                      <p className="mt-1 text-xs text-indigo-400">CSV, Excel, JSON, or PNG/JPG</p>
                    )}
                  </div>
                  {uploading ? (
                    uploadProgress !== null && uploadProgress < 1 ? (
                      <div className="w-full max-w-xs px-4">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-all"
                            style={{ width: `${Math.round(uploadProgress * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-center text-xs text-indigo-500">{Math.round(uploadProgress * 100)}%</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-indigo-600">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        {uploadingMessage}
                      </div>
                    )
                  ) : (
                    <div className="flex flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="rounded-lg border-2 border-indigo-400 bg-white px-4 py-1.5 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Browse Files
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-500 transition hover:bg-indigo-50 disabled:opacity-60"
                        onClick={handleLoadSample}
                        disabled={loadingSample}
                      >
                        {loadingSample ? "Loading…" : "Try sample data"}
                      </button>
                    </div>
                  )}
                </div>
              ) : sorted.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No datasets match &ldquo;{searchQuery}&rdquo;
                </div>
              ) : (
                sorted.map((dataset) => {
                  const d = getDeductions(dataset);
                  const isClean = d.score === 100;
                  const isRenaming = renameTargetId === dataset.id;
                  return (
                    <div
                      key={dataset.id}
                      className="group flex cursor-pointer items-start gap-3 border-b border-slate-50 px-4 py-3 transition hover:bg-slate-50"
                      style={{ borderLeft: `3px solid ${d.borderColor}` }}
                      onClick={() => { if (!isRenaming) router.push(`/dataset/${dataset.id}`); }}
                    >
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              className="min-w-0 flex-1 rounded-lg border border-indigo-300 px-2 py-1 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              value={renameValue}
                              disabled={renaming}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleConfirmRename();
                                if (e.key === "Escape") cancelRename();
                              }}
                            />
                            <button
                              type="button"
                              className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-60"
                              onClick={handleConfirmRename}
                              disabled={renaming}
                              aria-label="Save name"
                            >
                              {renaming ? "…" : "✓"}
                            </button>
                            <button
                              type="button"
                              className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-60"
                              onClick={cancelRename}
                              disabled={renaming}
                              aria-label="Cancel rename"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-slate-800">{dataset.original_filename}</p>
                            {dataset.file_format === "image" && (
                              <span className="shrink-0 rounded px-1 py-0.5 text-xs font-medium bg-violet-100 text-violet-700">OCR</span>
                            )}
                            <button
                              type="button"
                              className="shrink-0 text-xs text-slate-300 opacity-0 transition hover:text-indigo-600 group-hover:opacity-100"
                              onClick={(e) => { e.stopPropagation(); startRename(dataset); }}
                              aria-label="Rename dataset"
                            >
                              ✎
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-slate-400">
                          {dataset.row_count?.toLocaleString() ?? "—"} rows · {dataset.column_count ?? "—"} cols · {formatRelativeDate(dataset.created_at)}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {isClean && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 text-green-700">✓ Clean</span>
                          )}
                          {d.missingDed > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">↓ Missing −{d.missingDed}%</span>
                          )}
                          {d.dupDed > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">⊗ Dupes −{d.dupDed}%</span>
                          )}
                          {d.typeDed > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700">⚠ Types −{d.typeDed}%</span>
                          )}
                          {d.pseudoDed > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-yellow-100 text-yellow-800">~ Pseudo-nulls −{d.pseudoDed}%</span>
                          )}
                          {d.variantDed > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-sky-100 text-sky-700">≈ Variants −{d.variantDed}%</span>
                          )}
                          {d.outlierDed > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">◈ Outliers −{d.outlierDed}%</span>
                          )}
                        </div>
                      </div>
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${d.classes}`}>
                        {d.score}%
                      </span>
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 text-sm text-red-400 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(dataset); }}
                        aria-label="Delete dataset"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* RIGHT: Charts + Stats */}
          <div className="flex flex-col gap-6">

            {/* Charts row */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {/* Quality Breakdown Pie */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Data Quality Breakdown</h2>
                <p className="text-xs text-slate-500">Distribution of health scores across all datasets</p>
                {qualityPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={qualityPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={88}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {qualityPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value} dataset${Number(value) !== 1 ? "s" : ""}`, ""]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-56 items-center justify-center text-sm text-slate-400">
                    Upload datasets to see quality breakdown
                  </div>
                )}
              </div>

              {/* Top Issues Bar */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Top Issues</h2>
                <p className="text-xs text-slate-500">Cumulative counts across all datasets</p>
                {issuesBarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={issuesBarData} layout="vertical" margin={{ top: 16, right: 48, left: 8, bottom: 16 }}>
                      <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value) => [Number(value ?? 0).toLocaleString(), "Count"]} cursor={{ fill: "#f8fafc" }} />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11, fill: "#64748b" }}>
                        {issuesBarData.map((entry, index) => (
                          <Cell key={`bar-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-56 flex-col items-center justify-center gap-2">
                    <span className="text-2xl">✓</span>
                    <p className="text-sm font-medium text-emerald-600">No issues detected</p>
                    <p className="text-xs text-slate-400">Your data looks clean across all datasets.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatCard
                title="Total Datasets"
                value={String(datasets.length)}
                sub="All uploads"
                accent="bg-indigo-500"
              />
              <StatCard
                title="Total Rows"
                value={totalRows > 0 ? totalRows.toLocaleString() : "0"}
                sub="Across all datasets"
                accent="bg-sky-500"
              />
              <StatCard
                title="Total Columns"
                value={totalColumns > 0 ? totalColumns.toLocaleString() : "0"}
                sub="Across all datasets"
                accent="bg-purple-500"
              />
              <StatCard
                title="Clean Datasets"
                value={String(cleanDatasets)}
                sub={`of ${datasets.length} total`}
                accent="bg-teal-500"
              />
            </div>

          </div>
        </div>
      </div>

      {/* OCR Loading Overlay */}
      {uploading && uploadingMessage.startsWith("Extracting") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border border-slate-100 bg-white px-10 py-8 shadow-2xl">
            <div className="relative flex items-center justify-center">
              <svg className="h-12 w-12 animate-spin text-indigo-200" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              </svg>
              <svg className="absolute h-12 w-12 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none" style={{ animationDuration: "0.8s" }}>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-900">Extracting table from image</p>
              <p className="mt-1 text-xs text-slate-400">This may take a few seconds…</p>
            </div>
            <div className="w-full">
              <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-200"
                  style={{ width: `${Math.round((uploadProgress ?? 0) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-center text-xs text-indigo-500">{Math.round((uploadProgress ?? 0) * 100)}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
            <h3 className="text-base font-semibold text-slate-900">Delete dataset?</h3>
            <p className="mt-2 text-sm text-slate-600">
              You are about to permanently delete{" "}
              <span className="font-medium text-slate-900">{deleteTarget.original_filename}</span>.
              This cannot be undone.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                type="button"
                onClick={() => { if (!deleting) setDeleteTarget(null); }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
