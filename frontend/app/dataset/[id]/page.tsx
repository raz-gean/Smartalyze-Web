"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AIAnalyzeContext,
  AIChatMessage,
  AIContext,
  analyzeStats,
  AnalyzeStatsResponse,
  AnomalyResponse,
  applyCleaningOperations,
  CleaningOperation,
  CleanApplyResponse,
  CleanDetectResponse,
  CorrelationMethod,
  CorrelationResponse,
  DateOutputFormat,
  DatasetVersionSummary,
  DatasetWorkspace,
  DayFirstHint,
  detectCleaningIssues,
  DistributionResponse,
  exportDataset,
  ExportDatasetFormat,
  FilterOp,
  FilterPredicate,
  filterDatasetRows,
  FilterResponse,
  getAIInsight,
  getAISuggestion,
  getAnomalies,
  getCorrelation,
  getDatasetRows,
  getDatasetWorkspace,
  getDistribution,
  getStructureSummary,
  getTrends,
  groupDataset,
  GroupByResponse,
  listDatasetVersions,
  predictDataset,
  PredictResponse,
  restoreDatasetVersion,
  saveDatasetResult,
  sendAIAnalyzeChat,
  sendAIChat,
  StructureSummaryResponse,
  TrendResponse,
  uploadDataset,
} from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";
import { findDateColumns } from "@/lib/dateColumns";
import { operationsToPandasScript } from "@/lib/codeExport";
import { OverviewTab } from "@/components/dataset/OverviewTab";
import { PrepareTab } from "@/components/dataset/PrepareTab";
import { ExploreTab } from "@/components/dataset/ExploreTab";
import { DetectTab } from "@/components/dataset/DetectTab";
import { PredictTab } from "@/components/dataset/PredictTab";
import { EditTab } from "@/components/dataset/EditTab";
import { TabErrorBoundary } from "@/components/TabErrorBoundary";
import { AskAIPanel, type AISummaryState } from "@/components/dataset/AskAIPanel";

const AI_PANEL_KEY = "smartalyze:ai-panel-open";
type AITopic = "cleaning" | "analysis" | "detect";
const AI_TOPIC_COPY: Record<AITopic, { title: string; waiting: string }> = {
  cleaning: { title: "Cleaning plan", waiting: "Scanning your data for problems…" },
  analysis: { title: "What your data shows", waiting: "Loading the column statistics and trends…" },
  detect: { title: "Outliers & relationships", waiting: "Loading the outlier and correlation results…" },
};

type WorkspaceTab = "overview" | "prepare" | "explore" | "detect" | "predict" | "edit";
type PrepareSubTab = "overview" | "cleaning";
type MissingStrategy = "fill_mean" | "fill_median" | "fill_mode" | "drop_rows";

function getColumnType(columnName: string, detection: CleanDetectResponse | null): string {
  return detection?.column_types?.[columnName] ?? "unknown";
}

function isTextLikeColumnType(columnType: string): boolean {
  return ["text", "categorical", "numeric_string", "datetime_string"].includes(columnType);
}

function isLowercaseCandidate(columnType: string): boolean {
  return ["text", "categorical"].includes(columnType);
}

function getTextColumns(detection: CleanDetectResponse | null, availableColumns: string[]): string[] {
  return availableColumns.filter((col) => isTextLikeColumnType(getColumnType(col, detection)));
}

function getDefaultMissingStrategy(columnName: string, detection: CleanDetectResponse | null): MissingStrategy {
  const columnType = getColumnType(columnName, detection);
  return columnType === "numeric" || columnType === "numeric_string" ? "fill_median" : "fill_mode";
}

function buildDuplicateOperation(): CleaningOperation {
  return { operation_type: "remove_all_duplicates", columns: [], column: null, target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildMissingValueOperation(columnName: string, strategy: MissingStrategy): CleaningOperation {
  return { operation_type: strategy, columns: [columnName], column: columnName, target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildTrimWhitespaceOperation(columns: string[]): CleaningOperation {
  return { operation_type: "trim_whitespace", columns, column: null, target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildConvertTypeOperation(columnName: string, targetType: "numeric" | "datetime"): CleaningOperation {
  return { operation_type: "convert_column_type", column: columnName, target_type: targetType, errors: "coerce" };
}

function buildLowercaseOperation(columnName: string): CleaningOperation {
  return { operation_type: "lowercase_column", columns: [columnName], column: columnName, target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildSortValuesOperation(column: string, ascending: boolean): CleaningOperation {
  return { operation_type: "sort_values", column, ascending, columns: [], target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildPatternImputationOperation(targetCol: string, keyCol: string): CleaningOperation {
  return { operation_type: "fill_pattern", column: targetCol, key_column: keyCol, target_column_fill: targetCol, columns: [], target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildStandardizeDatesOperation(columnName: string, outputFormat: DateOutputFormat, dayfirstHint: DayFirstHint): CleaningOperation {
  return { operation_type: "standardize_dates", columns: [], column: columnName, target_type: null, drop_all_missing: true, errors: "coerce", output_format: outputFormat, dayfirst_hint: dayfirstHint, unparseable_action: "keep_original" };
}

function buildStandardizeCategoriesOperation(columnName: string, valueMapping: Record<string, string>): CleaningOperation {
  return { operation_type: "standardize_categories", column: columnName, columns: [], target_type: null, drop_all_missing: true, errors: "coerce", value_mapping: valueMapping };
}

function buildReplaceWithMissingOperation(columnName: string): CleaningOperation {
  return { operation_type: "replace_with_missing", column: columnName, columns: [columnName], target_type: null, drop_all_missing: true, errors: "coerce", missing_tokens: null };
}

function buildRemoveOutliersOperation(columnName: string): CleaningOperation {
  return { operation_type: "remove_outliers", column: columnName, columns: [], target_type: null, drop_all_missing: true, errors: "coerce" };
}

function buildNullifyOutliersOperation(columnName: string): CleaningOperation {
  return { operation_type: "nullify_outliers", column: columnName, columns: [], target_type: null, drop_all_missing: true, errors: "coerce" };
}

// A per-column "concern": two queued operations with the same concern key are
// contradictory (only one should win), so adding one auto-replaces the other.
// Complementary chains (e.g. nullify_outliers + fill, replace_with_missing + fill)
// have different concerns and can coexist.
function getOperationConcern(op: CleaningOperation): string | null {
  const col = op.column ?? (op.columns && op.columns.length === 1 ? op.columns[0] : null);
  switch (op.operation_type) {
    case "fill_mean":
    case "fill_median":
    case "fill_mode":
    case "drop_rows":
      return col ? `missing:${col}` : null;
    case "fill_pattern":
      return op.column ? `missing:${op.column}` : null;
    case "nullify_outliers":
    case "remove_outliers":
      return col ? `outlier:${col}` : null;
    case "convert_column_type":
      return op.column ? `type:${op.column}` : null;
    case "standardize_categories":
      return op.column ? `category:${op.column}` : null;
    case "standardize_dates":
      return op.column ? `date:${op.column}` : null;
    case "replace_with_missing":
      return col ? `disguised:${col}` : null;
    case "lowercase_column":
      return col ? `case:${col}` : null;
    default:
      return null;
  }
}

function areCleaningOperationsEqual(a: CleaningOperation, b: CleaningOperation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildSnapshotFromDataset(dataset: DatasetWorkspace["dataset"]): Record<string, unknown> {
  const summary = (dataset.summary_json ?? {}) as Record<string, unknown>;
  return {
    source_name: dataset.original_filename,
    file_type: dataset.file_format,
    size_bytes: dataset.size_bytes,
    records: dataset.preview_json ?? [],
    columns: dataset.columns_json ?? [],
    preview: dataset.preview_json ?? [],
    summary: dataset.summary_json ?? {
      row_count: dataset.row_count ?? 0,
      column_count: dataset.column_count ?? 0,
      missing_cells: Number(summary.missing_cells ?? 0),
      duplicate_rows: Number(summary.duplicate_rows ?? 0),
      size_bytes: dataset.size_bytes,
    },
  };
}

const DATE_FORMAT_LABELS: Record<DateOutputFormat, string> = {
  iso: "ISO (2024-01-08)",
  us: "US (01/08/2024)",
  eu: "EU (08/01/2024)",
};

export default function DatasetWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const datasetId = Number(params.id);

  const [workspace, setWorkspace] = useState<DatasetWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [prepareSubTab, setPrepareSubTab] = useState<PrepareSubTab>("overview");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportDatasetFormat>("csv");

  // Modals
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showCodeExport, setShowCodeExport] = useState(false);
  const [codeExportCopied, setCodeExportCopied] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [versionList, setVersionList] = useState<DatasetVersionSummary[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(null);
  const [pendingRestore, setPendingRestore] = useState<DatasetVersionSummary | null>(null);
  const [saveMode, setSaveMode] = useState<"replace" | "new">("replace");
  const [newDatasetName, setNewDatasetName] = useState("");

  // Cleaning
  const [cleaningDetection, setCleaningDetection] = useState<CleanDetectResponse | null>(null);
  const [cleaningDetecting, setCleaningDetecting] = useState(false);
  const [cleaningScanFailed, setCleaningScanFailed] = useState(false);
  const [cleaningOperations, setCleaningOperations] = useState<CleaningOperation[]>([]);
  const [cleaningResult, setCleaningResult] = useState<CleanApplyResponse | null>(null);
  const [missingValueStrategies, setMissingValueStrategies] = useState<Record<string, MissingStrategy>>({});
  const [dateFormatChoices, setDateFormatChoices] = useState<Record<string, DateOutputFormat>>({});
  const [dayfirstChoices, setDayfirstChoices] = useState<Record<string, DayFirstHint>>({});
  const [cumulativeAppliedOperations, setCumulativeAppliedOperations] = useState<CleaningOperation[]>([]);
  const [categoryMappingEdits, setCategoryMappingEdits] = useState<Record<string, Record<string, string>>>({});
  const [sortColumn, setSortColumn] = useState("");
  const [sortAscending, setSortAscending] = useState(true);

  // Filter
  const [filterPredicates, setFilterPredicates] = useState<FilterPredicate[]>([]);
  const [filterCombine, setFilterCombine] = useState<"and" | "or">("and");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [filterResult, setFilterResult] = useState<FilterResponse | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [draftFilterColumn, setDraftFilterColumn] = useState("");
  const [draftFilterOp, setDraftFilterOp] = useState<FilterOp>("eq");
  const [draftFilterValue, setDraftFilterValue] = useState("");
  const [draftFilterLower, setDraftFilterLower] = useState("");
  const [draftFilterUpper, setDraftFilterUpper] = useState("");

  // Overview pagination
  const [overviewExtraRows, setOverviewExtraRows] = useState<Record<string, unknown>[]>([]);
  const [overviewTotalRows, setOverviewTotalRows] = useState<number | null>(null);
  const [overviewLoadingMore, setOverviewLoadingMore] = useState(false);

  // Explore
  const [analysisStats, setAnalysisStats] = useState<AnalyzeStatsResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [structureSummary, setStructureSummary] = useState<StructureSummaryResponse | null>(null);
  const [selectedDistColumn, setSelectedDistColumn] = useState<string | null>(null);
  const [distributionData, setDistributionData] = useState<DistributionResponse | null>(null);
  const [distributionLoading, setDistributionLoading] = useState(false);
  const [aggregationGroupBy, setAggregationGroupBy] = useState("");
  const [aggregateColumn, setAggregateColumn] = useState("");
  const [aggregationOperation, setAggregationOperation] = useState("sum");
  const [groupResult, setGroupResult] = useState<GroupByResponse | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [saveGroupAsOpen, setSaveGroupAsOpen] = useState(false);
  const [saveGroupAsName, setSaveGroupAsName] = useState("");
  const [saveGroupAsSaving, setSaveGroupAsSaving] = useState(false);
  const [trendData, setTrendData] = useState<TrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [selectedTrendColumn, setSelectedTrendColumn] = useState("");

  // Detect
  const [anomalyData, setAnomalyData] = useState<AnomalyResponse | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [correlationData, setCorrelationData] = useState<CorrelationResponse | null>(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);
  const [correlationMethod, setCorrelationMethod] = useState<CorrelationMethod>("pearson");

  // Edit tab
  const [editTabIsDirty, setEditTabIsDirty] = useState(false);

  // Browser-level warning when closing or refreshing with unsaved editor changes.
  useEffect(() => {
    if (!editTabIsDirty) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editTabIsDirty]);

  // Predict
  const [predictionInputColumn, setPredictionInputColumn] = useState("");
  const [predictionTargetColumn, setPredictionTargetColumn] = useState("");
  const [predictionSteps, setPredictionSteps] = useState(5);
  const [predictionResult, setPredictionResult] = useState<PredictResponse | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);

  const availableColumns = workspace?.dataset.columns_json?.map((c) => String(c.name ?? "")).filter(Boolean) ?? [];
  const cleaningIssues = cleaningDetection?.issues ?? [];

  // AI contexts are built only once ALL of a tab's results have loaded, so the AI never
  // summarizes half the picture (e.g. correlations without the outliers).
  const exploreAIContext: AIAnalyzeContext | null =
    analysisStats && trendData && workspace
      ? {
          dataset_name: workspace.dataset.original_filename ?? "dataset",
          row_count: analysisStats.row_count,
          col_count: analysisStats.col_count,
          column_stats: analysisStats.column_stats.slice(0, 10).map((c) => ({
            name: c.name,
            dtype: c.dtype,
            missing_pct: c.missing_pct,
            mean: c.mean ?? null,
            min: c.min ?? null,
            max: c.max ?? null,
            std: c.std ?? null,
          })),
          trends: (trendData?.columns ?? []).slice(0, 5).map((t) => ({
            column: t.column,
            direction: t.direction,
            slope: t.slope,
            r_squared: t.r_squared,
          })),
          anomalies: [],
          top_correlations: [],
        }
      : null;

  const detectAIContext: AIAnalyzeContext | null =
    anomalyData && correlationData && workspace
      ? {
          dataset_name: workspace.dataset.original_filename ?? "dataset",
          row_count: workspace.dataset.row_count ?? 0,
          col_count: workspace.dataset.column_count ?? 0,
          column_stats: [],
          trends: [],
          anomalies: (anomalyData?.columns ?? []).slice(0, 5).map((a) => ({
            column: a.column,
            outlier_count: a.outlier_count,
            outlier_pct: a.outlier_pct,
            lower_fence: a.lower_fence,
            upper_fence: a.upper_fence,
          })),
          top_correlations: (() => {
            if (!correlationData) return [];
            const { columns, matrix } = correlationData;
            const pairs: Array<{ col_a: string; col_b: string; r: number }> = [];
            for (let i = 0; i < columns.length; i++)
              for (let j = i + 1; j < columns.length; j++) {
                const r = matrix[columns[i]]?.[columns[j]] ?? NaN;
                if (!isNaN(r)) pairs.push({ col_a: columns[i], col_b: columns[j], r });
              }
            return pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 5);
          })(),
        }
      : null;

  const cleaningAIContext: AIContext | null =
    cleaningDetection && workspace
      ? {
          dataset_name: workspace.dataset.original_filename ?? "dataset",
          row_count: Number(cleaningResult?.summary?.row_count ?? workspace.dataset.row_count ?? 0) || null,
          column_types: cleaningDetection.column_types ?? {},
          missing_values: cleaningDetection.missing_values ?? {},
          duplicates: cleaningDetection.duplicates ?? 0,
          issues: (cleaningDetection.issues as unknown as Array<Record<string, unknown>>) ?? [],
          pattern_suggestions: (cleaningDetection.pattern_suggestions as unknown as Array<Record<string, unknown>>) ?? [],
          outliers: (cleaningDetection.outliers as unknown as Array<Record<string, unknown>>) ?? [],
        }
      : null;

  // ── Ask AI: one panel shared by every tab ───────────────────────────────────
  // Summaries are cached by topic + the exact context sent, so switching tabs never asks
  // the AI again; a new summary is made only when the data changes or on Regenerate.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSummaries, setAiSummaries] = useState<Record<string, AISummaryState>>({});
  const [aiChat, setAiChat] = useState<AIChatMessage[]>([]);
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatError, setAiChatError] = useState<string | null>(null);
  const aiInFlight = useRef(new Set<string>());

  const aiTopic: AITopic =
    activeTab === "explore" || activeTab === "predict" ? "analysis" : activeTab === "detect" ? "detect" : "cleaning";
  const aiTopicContext = aiTopic === "cleaning" ? cleaningAIContext : aiTopic === "analysis" ? exploreAIContext : detectAIContext;
  const aiKey = aiTopicContext ? `${aiTopic}|${JSON.stringify(aiTopicContext)}` : null;

  useEffect(() => {
    // Open by default on wide screens; afterwards remember the user's choice.
    let open = window.matchMedia("(min-width: 1280px)").matches;
    try {
      const saved = window.localStorage.getItem(AI_PANEL_KEY);
      if (saved !== null) open = saved === "1";
    } catch {
      // storage unavailable: keep the default
    }
    setAiOpen(open);
  }, []);

  function setAiPanelOpen(open: boolean) {
    setAiOpen(open);
    try {
      window.localStorage.setItem(AI_PANEL_KEY, open ? "1" : "0");
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  }

  useEffect(() => {
    if (!aiOpen || !token || !aiKey || !aiTopicContext) return;
    if (aiSummaries[aiKey] || aiInFlight.current.has(aiKey)) return;
    aiInFlight.current.add(aiKey);
    setAiSummaries((s) => ({ ...s, [aiKey]: { status: "loading" } }));
    const request = aiTopic === "cleaning"
      ? getAISuggestion(aiTopicContext as AIContext, token).then((r) => r.suggestion)
      : getAIInsight(aiTopicContext as AIAnalyzeContext, token).then((r) => r.insight);
    request
      .then((text) => setAiSummaries((s) => ({ ...s, [aiKey]: { status: "done", text } })))
      .catch((e: unknown) => setAiSummaries((s) => ({ ...s, [aiKey]: { status: "error", error: e instanceof Error ? e.message : "" } })))
      .finally(() => aiInFlight.current.delete(aiKey));
  }, [aiOpen, token, aiKey, aiTopic, aiTopicContext, aiSummaries]);

  function handleRegenerateAI() {
    if (!aiKey) return;
    setAiSummaries((s) => {
      const next = { ...s };
      delete next[aiKey];
      return next;
    });
  }

  async function handleAskAI(message: string) {
    if (!token || !aiTopicContext) return;
    const history = aiChat;
    setAiChat([...history, { role: "user", content: message }]);
    setAiChatLoading(true);
    setAiChatError(null);
    try {
      const res = aiTopic === "cleaning"
        ? await sendAIChat(aiTopicContext as AIContext, message, history, token)
        : await sendAIAnalyzeChat(aiTopicContext as AIAnalyzeContext, message, history, token);
      setAiChat((c) => [...c, { role: "assistant", content: res.reply }]);
    } catch (e: unknown) {
      setAiChatError(e instanceof Error ? e.message : "Could not get a reply.");
    } finally {
      setAiChatLoading(false);
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) { router.replace("/login"); return; }
    setToken(storedToken);
    if (!Number.isFinite(datasetId)) { router.replace("/dashboard"); return; }
    getDatasetWorkspace(datasetId, storedToken)
      .then((ws) => {
        setWorkspace(ws);
        const cols = ws.dataset.columns_json ?? [];
        const firstName = String((cols[0] as { name?: string })?.name ?? "");
        const textCol = cols.find((c) => {
          const t = String((c as { data_type?: string }).data_type ?? "");
          return t === "object" || t === "string" || t === "category" || t === "bool";
        });
        const numCol = cols.find((c) => {
          const t = String((c as { data_type?: string }).data_type ?? "");
          return t.startsWith("int") || t.startsWith("float") || t.startsWith("Int") || t.startsWith("Float");
        });
        if (firstName) {
          setAggregationGroupBy(String((textCol as { name?: string })?.name ?? firstName));
          setAggregateColumn(String((numCol as { name?: string })?.name ?? firstName));
          setPredictionInputColumn(""); // no date column: row order is the time axis
          setPredictionTargetColumn(String((numCol as { name?: string })?.name ?? firstName));
          setSortColumn(firstName);
        }
      })
      .catch(() => { clearStoredToken(); router.replace("/login"); })
      .finally(() => setLoading(false));
  }, [datasetId, router]);

  // ── Lazy data loaders ──────────────────────────────────────────────────────
  // The data scan feeds both Overview ("Issues Found") and Prepare, so it runs as soon as
  // the workspace loads (and again whenever a save/discard resets it), on any tab.
  useEffect(() => {
    if (!workspace || !token || cleaningDetection || cleaningDetecting || cleaningScanFailed) return;
    setCleaningDetecting(true);
    detectCleaningIssues(workspace.dataset.id, token)
      .then(setCleaningDetection)
      .catch(() => { setCleaningScanFailed(true); toast.error("Could not detect cleaning issues."); })
      .finally(() => setCleaningDetecting(false));
  }, [workspace, token, cleaningDetection, cleaningDetecting, cleaningScanFailed]);

  // Column statistics and trends feed Explore, Predict's column list and the AI panel on both tabs.
  useEffect(() => {
    if ((activeTab !== "explore" && activeTab !== "predict") || !workspace || !token || analysisStats) return;
    setAnalysisLoading(true);
    Promise.all([analyzeStats(workspace.dataset.id, token), getStructureSummary(workspace.dataset.id, token)])
      .then(([stats, structure]) => { setAnalysisStats(stats); setStructureSummary(structure); })
      .catch(() => toast.error("Could not load column statistics."))
      .finally(() => setAnalysisLoading(false));
  }, [activeTab, workspace, token, analysisStats]);

  useEffect(() => {
    if ((activeTab !== "explore" && activeTab !== "predict") || !workspace || !token || trendData) return;
    setTrendLoading(true);
    getTrends(workspace.dataset.id, token)
      .then((data) => { setTrendData(data); if (data.columns[0]) setSelectedTrendColumn(data.columns[0].column); })
      .catch(() => toast.error("Could not load trend data."))
      .finally(() => setTrendLoading(false));
  }, [activeTab, workspace, token, trendData]);

  useEffect(() => {
    if (activeTab !== "detect" || !workspace || !token || anomalyData) return;
    setAnomalyLoading(true);
    getAnomalies(workspace.dataset.id, token)
      .then(setAnomalyData)
      .catch(() => toast.error("Could not load anomaly data."))
      .finally(() => setAnomalyLoading(false));
  }, [activeTab, workspace, token, anomalyData]);

  useEffect(() => {
    if (activeTab !== "detect" || !workspace || !token) return;
    if (correlationData && correlationData.method === correlationMethod) return;
    setCorrelationLoading(true);
    getCorrelation(workspace.dataset.id, token, null, correlationMethod)
      .then(setCorrelationData)
      .catch(() => toast.error("Could not load correlation data."))
      .finally(() => setCorrelationLoading(false));
  }, [activeTab, workspace, token, correlationData, correlationMethod]);

  // Distribution loads on column selection
  useEffect(() => {
    if (!workspace || !token || !selectedDistColumn) return;
    if (distributionData && distributionData.column === selectedDistColumn) return;
    setDistributionLoading(true);
    getDistribution(workspace.dataset.id, selectedDistColumn, token, { bins: 20 })
      .then(setDistributionData)
      .catch((e) => { toast.error(e instanceof Error ? e.message : "Could not load distribution."); setDistributionData(null); })
      .finally(() => setDistributionLoading(false));
  }, [workspace, token, selectedDistColumn, distributionData]);

  // Filters fire on predicate changes
  useEffect(() => {
    if (!workspace || !token) return;
    if (filterPredicates.length === 0) { setFilterResult(null); return; }
    let cancelled = false;
    setFilterLoading(true);
    const snapshot = (cleaningResult?.data_snapshot ?? null) as Record<string, unknown> | null;
    filterDatasetRows(workspace.dataset.id, { predicates: filterPredicates, combine: filterCombine, offset: 0, limit: 50, data_snapshot: snapshot }, token)
      .then((res) => { if (!cancelled) setFilterResult(res); })
      .catch((e) => { if (!cancelled) { toast.error(e instanceof Error ? e.message : "Could not apply filters."); setFilterResult(null); } })
      .finally(() => { if (!cancelled) setFilterLoading(false); });
    return () => { cancelled = true; };
  }, [workspace, token, filterPredicates, filterCombine, cleaningResult]);

  // Reset pagination on tab switch
  useEffect(() => { setOverviewExtraRows([]); setOverviewTotalRows(null); }, [activeTab]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function hasQueuedOperation(operation: CleaningOperation): boolean {
    return cleaningOperations.some((op) => areCleaningOperationsEqual(op, operation));
  }

  function toggleOperation(operation: CleaningOperation, addMessage: string, removeMessage: string) {
    setCleaningOperations((ops) => {
      const exists = ops.some((op) => areCleaningOperationsEqual(op, operation));
      if (exists) { toast.warning(removeMessage); return ops.filter((op) => !areCleaningOperationsEqual(op, operation)); }
      // Auto-replace any queued op that targets the same per-column "concern"
      // (e.g. a different fill method, or remove-rows vs convert-to-empty) so the
      // queue can never hold contradictory fixes for one column.
      const concern = getOperationConcern(operation);
      const conflicting = concern ? ops.filter((op) => getOperationConcern(op) === concern) : [];
      const kept = conflicting.length ? ops.filter((op) => getOperationConcern(op) !== concern) : ops;
      if (conflicting.length) {
        const col = concern!.split(":")[1];
        toast.success(`Replaced the previous fix for "${col}".`);
      } else {
        toast.success(addMessage);
      }
      return [...kept, operation];
    });
  }

  function addMissingValueOperation(col: string) {
    const strategy = missingValueStrategies[col] ?? getDefaultMissingStrategy(col, cleaningDetection);
    const op = buildMissingValueOperation(col, strategy);
    toggleOperation(op, `Added fill for "${col}".`, `Removed fill for "${col}" from queue.`);
  }

  function toggleDuplicateRows() {
    toggleOperation(buildDuplicateOperation(), "Added remove duplicate rows.", "Removed duplicate rows from queue.");
  }

  function toggleTrimWhitespace() {
    const textCols = getTextColumns(cleaningDetection, availableColumns);
    if (textCols.length === 0) { toast.warning("No text columns found for trimming."); return; }
    toggleOperation(buildTrimWhitespaceOperation(textCols), "Added trim whitespace.", "Removed trim whitespace from queue.");
  }

  function toggleLowercaseColumn(col: string) {
    toggleOperation(buildLowercaseOperation(col), `Added lowercase for "${col}".`, `Removed lowercase for "${col}".`);
  }

  function toggleConvertType(col: string, targetType: "numeric" | "datetime") {
    toggleOperation(buildConvertTypeOperation(col, targetType), `Added convert "${col}" to ${targetType}.`, `Removed convert "${col}" from queue.`);
  }

  function toggleSortValues() {
    if (!sortColumn) return;
    toggleOperation(buildSortValuesOperation(sortColumn, sortAscending), `Added sort by "${sortColumn}".`, `Removed sort by "${sortColumn}" from queue.`);
  }

  function togglePatternImputation(targetCol: string, keyCol: string) {
    toggleOperation(buildPatternImputationOperation(targetCol, keyCol), `Added smart fill for "${targetCol}".`, `Removed smart fill for "${targetCol}".`);
  }

  function toggleStandardizeDates(col: string) {
    const fmt = dateFormatChoices[col] ?? "iso";
    const hint = dayfirstChoices[col] ?? "auto";
    toggleOperation(buildStandardizeDatesOperation(col, fmt, hint), `Added standardize dates in "${col}" (${DATE_FORMAT_LABELS[fmt]}).`, `Removed standardize dates for "${col}".`);
  }

  function toggleStandardizeCategories(col: string, mapping: Record<string, string>) {
    if (Object.keys(mapping).length === 0) { toast.warning(`No value changes to apply for "${col}".`); return; }
    toggleOperation(buildStandardizeCategoriesOperation(col, mapping), `Added standardize values in "${col}".`, `Removed standardize values for "${col}".`);
  }

  function toggleReplaceWithMissing(col: string) {
    toggleOperation(buildReplaceWithMissingOperation(col), `Added convert disguised-missing to empty in "${col}".`, `Removed disguised-missing fix for "${col}".`);
  }

  function toggleRemoveOutliers(col: string) {
    toggleOperation(buildRemoveOutliersOperation(col), `Added remove outlier rows for "${col}".`, `Removed outlier-removal for "${col}".`);
  }

  function toggleNullifyOutliers(col: string) {
    toggleOperation(buildNullifyOutliersOperation(col), `Added convert outliers to empty for "${col}".`, `Removed outlier conversion for "${col}".`);
  }

  function setCategoryCanonical(col: string, suggested: string, edited: string) {
    setCategoryMappingEdits((prev) => ({ ...prev, [col]: { ...(prev[col] ?? {}), [suggested]: edited } }));
  }

  function addFilterPredicate() {
    if (!draftFilterColumn) return;
    let predicate: FilterPredicate;
    if (draftFilterOp === "is_null" || draftFilterOp === "not_null") {
      predicate = { column: draftFilterColumn, op: draftFilterOp };
    } else if (draftFilterOp === "between") {
      if (!draftFilterLower || !draftFilterUpper) { toast.warning("Provide both lower and upper values for 'between'."); return; }
      predicate = { column: draftFilterColumn, op: "between", lower: draftFilterLower, upper: draftFilterUpper };
    } else if (draftFilterOp === "in") {
      const values = draftFilterValue.split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) { toast.warning("Provide at least one value (comma-separated) for 'in'."); return; }
      predicate = { column: draftFilterColumn, op: "in", values };
    } else {
      if (!draftFilterValue.trim()) { toast.warning("Provide a value to filter by."); return; }
      predicate = { column: draftFilterColumn, op: draftFilterOp, value: draftFilterValue };
    }
    setFilterPredicates((prev) => [...prev, predicate]);
    setDraftFilterValue(""); setDraftFilterLower(""); setDraftFilterUpper("");
  }

  function removeFilterPredicate(index: number) {
    setFilterPredicates((prev) => prev.filter((_, i) => i !== index));
  }

  function clearAllFilters() { setFilterPredicates([]); setFilterResult(null); }

  function handleRescanData() {
    setCleaningDetection(null); setCleaningResult(null); setCumulativeAppliedOperations([]);
  }

  function clearAnalysisState() {
    setAnalysisStats(null);
    setTrendData(null);
    setAnomalyData(null);
    setCorrelationData(null);
    setDistributionData(null);
    setStructureSummary(null);
    setGroupResult(null);
  }

  function handleDiscardResult() {
    setCleaningResult(null); setCleaningDetection(null); setCleaningOperations([]); setCumulativeAppliedOperations([]);
    toast.info("Changes discarded.");
  }

  async function handleApplyCleaning() {
    if (!workspace || !token || cleaningOperations.length === 0) {
      toast.warning("Add at least one cleaning operation before applying."); return;
    }
    setApplying(true);
    try {
      const allOps = [...cumulativeAppliedOperations, ...cleaningOperations];
      const sourceVersionId = cleaningDetection?.dataset_version_id ?? null;
      const response = await applyCleaningOperations(workspace.dataset.id, allOps, token, sourceVersionId);
      setCleaningDetection(response);
      setCleaningResult(response);
      setCumulativeAppliedOperations(allOps);
      setCleaningOperations([]);
      setActiveTab("prepare");
      setPrepareSubTab("overview");
      toast.success(cleaningResult ? "Cleaning re-applied — previous result replaced. Save to make it permanent." : "Cleaning applied — overview updated. Save to make it permanent.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply cleaning operations.");
    } finally {
      setApplying(false);
    }
  }

  async function handleSaveResult() {
    if (!workspace || !token) return;
    if (saveMode === "new" && !newDatasetName.trim()) { toast.warning("Please enter a dataset name."); return; }
    const resultSnapshot = cleaningResult?.data_snapshot ?? buildSnapshotFromDataset(workspace.dataset);
    setSaving(true);
    try {
      const response = await saveDatasetResult(workspace.dataset.id, { replace_current: saveMode === "replace", dataset_name: newDatasetName.trim() || null, description: workspace.dataset.description, data_snapshot: resultSnapshot }, token);
      setShowSaveModal(false);
      if (saveMode === "replace") {
        setWorkspace({ ...workspace, dataset: response.dataset });
        setCleaningResult(null); setCleaningDetection(null); setCumulativeAppliedOperations([]);
        setOverviewExtraRows([]); setOverviewTotalRows(null);
        clearAnalysisState();
        toast.success("Result replaced the current dataset.");
      } else {
        setCleaningResult(null); setCumulativeAppliedOperations([]);
        toast.success("Result saved as a new dataset.");
        router.replace(`/dataset/${response.dataset.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save result.");
    } finally {
      setSaving(false);
    }
  }

  async function openHistory() {
    if (!workspace || !token) return;
    setShowHistoryModal(true); setPendingRestore(null); setVersionsLoading(true);
    try {
      setVersionList(await listDatasetVersions(workspace.dataset.id, token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load version history.");
      setVersionList([]);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function confirmRestore(version: DatasetVersionSummary) {
    if (!workspace || !token) return;
    setRestoringVersionId(version.id);
    try {
      const response = await restoreDatasetVersion(workspace.dataset.id, version.id, token);
      setWorkspace({ ...workspace, dataset: response.dataset });
      setCleaningResult(null); setCleaningDetection(null); setCumulativeAppliedOperations([]);
      setOverviewExtraRows([]); setOverviewTotalRows(null);
      clearAnalysisState();
      toast.success(response.message);
      setVersionList(await listDatasetVersions(workspace.dataset.id, token));
      setPendingRestore(null); setShowHistoryModal(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore version.");
    } finally {
      setRestoringVersionId(null);
    }
  }

  async function handleLoadMoreOverviewRows() {
    if (!token || !workspace) return;
    const loaded = (workspace.dataset.preview_json ?? []).length + overviewExtraRows.length;
    setOverviewLoadingMore(true);
    try {
      const res = await getDatasetRows(workspace.dataset.id, loaded, 10, token);
      setOverviewExtraRows((prev) => [...prev, ...res.rows]);
      setOverviewTotalRows(res.total);
    } catch {
      toast.error("Could not load more rows.");
    } finally {
      setOverviewLoadingMore(false);
    }
  }

  async function handleExportResult() {
    if (!workspace || !token) return;
    setExporting(true);
    try {
      const sessionSnapshot = (cleaningResult?.data_snapshot ?? null) as Record<string, unknown> | null;
      const { blob, filename } = await exportDataset(workspace.dataset.id, { format: exportFormat, data_snapshot: sessionSnapshot }, token);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Export started.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export dataset.");
    } finally {
      setExporting(false);
    }
  }

  async function handleGenerateAggregation() {
    if (!workspace || !token) return;
    setGroupLoading(true);
    try {
      setGroupResult(await groupDataset(workspace.dataset.id, {
        group_by: aggregationGroupBy,
        aggregate_column: aggregationOperation === "count" ? aggregationGroupBy : aggregateColumn,
        aggregate_func: aggregationOperation,
      }, token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate aggregation.");
    } finally {
      setGroupLoading(false);
    }
  }

  function handleExportGroupCSV() {
    if (!groupResult) return;
    const opLabel = aggregationOperation === "mean" ? "Average" : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1);
    const header = `"${groupResult.group_by}","${opLabel} of ${groupResult.aggregate_column}"`;
    const rows = groupResult.results.map((r) => `"${String(r.group).replace(/"/g, '""')}",${r.value}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${groupResult.group_by}_${aggregationOperation}_${groupResult.aggregate_column}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveGroupAsDataset() {
    if (!groupResult || !token) return;
    const name = saveGroupAsName.trim() || `${groupResult.group_by} ${aggregationOperation} ${groupResult.aggregate_column}`;
    const opLabel = aggregationOperation === "mean" ? "Average" : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1);
    const header = `"${groupResult.group_by}","${opLabel} of ${groupResult.aggregate_column}"`;
    const rows = groupResult.results.map((r) => `"${String(r.group).replace(/"/g, '""')}",${r.value}`);
    const csv = [header, ...rows].join("\n");
    const file = new File([csv], `${name}.csv`, { type: "text/csv" });
    setSaveGroupAsSaving(true);
    try {
      await uploadDataset(file, `Aggregation: ${opLabel} of ${groupResult.aggregate_column} grouped by ${groupResult.group_by}`, token);
      toast.success(`Saved "${name}" as a new dataset.`);
      setSaveGroupAsOpen(false); setSaveGroupAsName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save dataset.");
    } finally {
      setSaveGroupAsSaving(false);
    }
  }

  async function handleRunPrediction() {
    if (!workspace || !token) return;
    setPredictionLoading(true);
    try {
      setPredictionResult(await predictDataset(workspace.dataset.id, {
        input_column: predictionInputColumn || predictionTargetColumn,
        target_column: predictionTargetColumn,
        future_steps: predictionSteps,
        time_column: predictionInputColumn || null,
      }, token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run prediction.");
    } finally {
      setPredictionLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <main className="min-h-screen px-4 py-10 text-slate-900">Loading workspace...</main>;
  if (!workspace) return null;

  const tabs: { key: WorkspaceTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "prepare", label: "Prepare" },
    { key: "explore", label: "Explore" },
    { key: "detect", label: "Detect" },
    { key: "predict", label: "Predict" },
    { key: "edit", label: "Edit" },
  ];

  function handleTabChange(key: WorkspaceTab) {
    if (activeTab === "edit" && editTabIsDirty) {
      if (!window.confirm("You have unsaved changes in the editor. Leave anyway?")) return;
    }
    setActiveTab(key);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className={`mx-auto w-full max-w-7xl px-4 py-8 ${aiOpen ? "xl:max-w-420" : ""}`}>
        {/* Page header */}
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-indigo-500">Dataset workspace</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-950">{workspace.dataset.original_filename}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {workspace.dataset.row_count?.toLocaleString() ?? "?"} rows · {workspace.dataset.column_count ?? "?"} cols
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {cleaningResult && (
              <button
                type="button"
                className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                onClick={() => { setCodeExportCopied(false); setShowCodeExport(true); }}
              >
                Export Python
              </button>
            )}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1">
              <select
                className="border-none bg-transparent py-1 text-sm text-slate-700 outline-none"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportDatasetFormat)}
                disabled={exporting}
              >
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
                <option value="json">JSON</option>
                <option value="parquet">Parquet</option>
              </select>
              <button
                type="button"
                className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                onClick={handleExportResult}
                disabled={exporting}
              >
                {exporting ? "Exporting…" : "Export"}
              </button>
            </div>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={openHistory}
            >
              History
            </button>
            <button
              type="button"
              aria-pressed={aiOpen}
              onClick={() => setAiPanelOpen(!aiOpen)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${aiOpen ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-indigo-700 hover:bg-indigo-50"}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Ask AI
            </button>
            <button
              type="button"
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${cleaningResult ? "bg-indigo-600 text-white hover:bg-indigo-500" : "cursor-not-allowed bg-slate-100 text-slate-400"}`}
              disabled={!cleaningResult}
              onClick={() => setShowSaveModal(true)}
            >
              {saving ? "Saving…" : "Save Result"}
            </button>
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {/* Unsaved cleaning banner */}
        {cleaningResult && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="flex items-center gap-2">
              <span>⚠</span>
              <span>Cleaning applied — unsaved changes. Overview now shows the cleaned preview.</span>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900" onClick={handleDiscardResult}>
                Discard
              </button>
              <button type="button" className="rounded-full bg-amber-600 px-4 py-1.5 font-medium text-white hover:bg-amber-500" onClick={() => setShowSaveModal(true)}>
                Save changes →
              </button>
            </div>
          </div>
        )}

        {/* Sticky tab bar */}
        <div className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1 border-b border-slate-200 bg-slate-50 px-4 py-2 backdrop-blur-sm">
          {tabs.map(({ key, label }) => {
            const hasBadge = key === "prepare" && cleaningResult !== null;
            const hasEditBadge = key === "edit" && editTabIsDirty;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleTabChange(key)}
                className={`relative rounded-full px-5 py-2 text-sm font-medium transition ${
                  activeTab === key ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-indigo-700"
                }`}
              >
                {label}
                {hasBadge && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-50" />
                )}
                {hasEditBadge && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-50" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content; on wide screens it leaves room for the docked Ask AI panel when open */}
        <div className={`flex items-start gap-6 ${aiOpen ? "xl:pr-100" : ""}`}>
        <div className="w-full min-w-0 flex-1">
          {activeTab === "overview" && workspace && (
            <TabErrorBoundary tabName="Overview">
              <OverviewTab
                workspace={workspace}
                cleaningDetection={cleaningDetection}
                onNavigate={(tab) => setActiveTab(tab as WorkspaceTab)}
                extraRows={overviewExtraRows}
                totalRows={overviewTotalRows}
                loadingMore={overviewLoadingMore}
                onLoadMore={handleLoadMoreOverviewRows}
                scanFailed={cleaningScanFailed}
                onRetryScan={() => setCleaningScanFailed(false)}
              />
            </TabErrorBoundary>
          )}

          {activeTab === "prepare" && workspace && (
            <TabErrorBoundary tabName="Prepare">
            <PrepareTab
              workspace={workspace}
              subTab={prepareSubTab}
              setSubTab={setPrepareSubTab}
              cleaningDetection={cleaningDetection}
              cleaningDetecting={cleaningDetecting}
              cleaningResult={cleaningResult}
              cleaningOperations={cleaningOperations}
              setCleaningOperations={setCleaningOperations}
              missingValueStrategies={missingValueStrategies}
              setMissingValueStrategies={setMissingValueStrategies}
              dateFormatChoices={dateFormatChoices}
              setDateFormatChoices={setDateFormatChoices}
              dayfirstChoices={dayfirstChoices}
              setDayfirstChoices={setDayfirstChoices}
              overviewExtraRows={overviewExtraRows}
              overviewTotalRows={overviewTotalRows}
              overviewLoadingMore={overviewLoadingMore}
              filterPredicates={filterPredicates}
              setFilterPredicates={setFilterPredicates}
              filterCombine={filterCombine}
              setFilterCombine={setFilterCombine}
              filterPanelOpen={filterPanelOpen}
              setFilterPanelOpen={setFilterPanelOpen}
              filterResult={filterResult}
              filterLoading={filterLoading}
              draftFilterColumn={draftFilterColumn}
              setDraftFilterColumn={setDraftFilterColumn}
              draftFilterOp={draftFilterOp}
              setDraftFilterOp={setDraftFilterOp}
              draftFilterValue={draftFilterValue}
              setDraftFilterValue={setDraftFilterValue}
              draftFilterLower={draftFilterLower}
              setDraftFilterLower={setDraftFilterLower}
              draftFilterUpper={draftFilterUpper}
              setDraftFilterUpper={setDraftFilterUpper}
              cumulativeAppliedOperations={cumulativeAppliedOperations}
              applying={applying}
              sortColumn={sortColumn}
              setSortColumn={setSortColumn}
              sortAscending={sortAscending}
              setSortAscending={setSortAscending}
              handleApplyCleaning={handleApplyCleaning}
              handleLoadMoreOverviewRows={handleLoadMoreOverviewRows}
              addFilterPredicate={addFilterPredicate}
              removeFilterPredicate={removeFilterPredicate}
              clearAllFilters={clearAllFilters}
              handleRescanData={handleRescanData}
              toggleDuplicateRows={toggleDuplicateRows}
              toggleTrimWhitespace={toggleTrimWhitespace}
              toggleLowercaseColumn={toggleLowercaseColumn}
              toggleConvertType={toggleConvertType}
              toggleSortValues={toggleSortValues}
              toggleStandardizeDates={toggleStandardizeDates}
              togglePatternImputation={togglePatternImputation}
              addMissingValueOperation={addMissingValueOperation}
              categoryMappingEdits={categoryMappingEdits}
              setCategoryCanonical={setCategoryCanonical}
              toggleStandardizeCategories={toggleStandardizeCategories}
              toggleReplaceWithMissing={toggleReplaceWithMissing}
              toggleRemoveOutliers={toggleRemoveOutliers}
              toggleNullifyOutliers={toggleNullifyOutliers}
              buildStandardizeCategoriesOperation={buildStandardizeCategoriesOperation}
              buildReplaceWithMissingOperation={buildReplaceWithMissingOperation}
              buildRemoveOutliersOperation={buildRemoveOutliersOperation}
              buildNullifyOutliersOperation={buildNullifyOutliersOperation}
              hasQueuedOperation={hasQueuedOperation}
              getColumnType={(col) => getColumnType(col, cleaningDetection)}
              isLowercaseCandidate={isLowercaseCandidate}
              getDefaultMissingStrategy={(col) => getDefaultMissingStrategy(col, cleaningDetection)}
              buildDuplicateOperation={buildDuplicateOperation}
              buildTrimWhitespaceOperation={(cols) => buildTrimWhitespaceOperation(cols)}
              buildMissingValueOperation={buildMissingValueOperation}
              buildConvertTypeOperation={buildConvertTypeOperation}
              buildSortValuesOperation={buildSortValuesOperation}
              buildStandardizeDatesOperation={buildStandardizeDatesOperation}
              buildPatternImputationOperation={buildPatternImputationOperation}
            />
            </TabErrorBoundary>
          )}

          {activeTab === "explore" && (
            <TabErrorBoundary tabName="Explore">
            <ExploreTab
              workspace={workspace}
              availableColumns={availableColumns}
              analysisStats={analysisStats}
              analysisLoading={analysisLoading}
              structureSummary={structureSummary}
              selectedDistColumn={selectedDistColumn}
              setSelectedDistColumn={setSelectedDistColumn}
              distributionData={distributionData}
              setDistributionData={setDistributionData}
              distributionLoading={distributionLoading}
              aggregationGroupBy={aggregationGroupBy}
              setAggregationGroupBy={setAggregationGroupBy}
              aggregateColumn={aggregateColumn}
              setAggregateColumn={setAggregateColumn}
              aggregationOperation={aggregationOperation}
              setAggregationOperation={setAggregationOperation}
              groupResult={groupResult}
              groupLoading={groupLoading}
              saveGroupAsOpen={saveGroupAsOpen}
              setSaveGroupAsOpen={setSaveGroupAsOpen}
              saveGroupAsName={saveGroupAsName}
              setSaveGroupAsName={setSaveGroupAsName}
              saveGroupAsSaving={saveGroupAsSaving}
              trendData={trendData}
              trendLoading={trendLoading}
              selectedTrendColumn={selectedTrendColumn}
              setSelectedTrendColumn={setSelectedTrendColumn}
              cleaningResult={cleaningResult}
              setShowSaveModal={setShowSaveModal}
              setActiveGroupTab={setActiveTab}
              handleGenerateAggregation={handleGenerateAggregation}
              handleExportGroupCSV={handleExportGroupCSV}
              handleSaveGroupAsDataset={handleSaveGroupAsDataset}
            />
            </TabErrorBoundary>
          )}

          {activeTab === "detect" && (
            <TabErrorBoundary tabName="Detect">
            <DetectTab
              anomalyData={anomalyData}
              anomalyLoading={anomalyLoading}
              correlationData={correlationData}
              correlationLoading={correlationLoading}
              correlationMethod={correlationMethod}
              setCorrelationMethod={setCorrelationMethod}
              onSwitchTab={(tab) => setActiveTab(tab)}
            />
            </TabErrorBoundary>
          )}

          {activeTab === "predict" && (
            <TabErrorBoundary tabName="Predict">
            <PredictTab
              availableColumns={availableColumns}
              dateColumns={findDateColumns(
                workspace.dataset.preview_json ?? [],
                availableColumns,
                analysisStats?.column_stats.filter((c) => c.dtype === "datetime").map((c) => c.name) ?? [],
              )}
              analysisStats={analysisStats}
              predictionResult={predictionResult}
              predictionLoading={predictionLoading}
              predictionInputColumn={predictionInputColumn}
              setPredictionInputColumn={setPredictionInputColumn}
              predictionTargetColumn={predictionTargetColumn}
              setPredictionTargetColumn={setPredictionTargetColumn}
              predictionSteps={predictionSteps}
              setPredictionSteps={setPredictionSteps}
              handleRunPrediction={handleRunPrediction}
            />
            </TabErrorBoundary>
          )}

          {activeTab === "edit" && workspace && token && (
            <TabErrorBoundary tabName="Edit">
            <EditTab
              workspace={workspace}
              token={token}
              onDirtyChange={setEditTabIsDirty}
              onSaved={() => {
                getDatasetWorkspace(datasetId, token).then((ws) => {
                  setWorkspace(ws);
                  setEditTabIsDirty(false);
                  clearAnalysisState();
                  toast.success("Manual edits saved as a new version.");
                }).catch(() => toast.error("Saved, but could not reload workspace."));
              }}
            />
            </TabErrorBoundary>
          )}
        </div>

        {aiOpen && token && (
          <AskAIPanel
            onClose={() => setAiPanelOpen(false)}
            summaryTitle={AI_TOPIC_COPY[aiTopic].title}
            summary={aiKey ? aiSummaries[aiKey] ?? { status: "loading" } : null}
            waitingHint={AI_TOPIC_COPY[aiTopic].waiting}
            onRegenerate={handleRegenerateAI}
            chat={aiChat}
            chatLoading={aiChatLoading}
            chatError={aiChatError}
            canChat={aiTopicContext !== null}
            onSend={(m) => void handleAskAI(m)}
          />
        )}
        </div>
      </div>

      {/* History modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-indigo-500">Version history</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">{workspace.dataset.original_filename}</h2>
                <p className="mt-1 text-sm text-slate-500">Restoring copies the snapshot into a new version — nothing is overwritten.</p>
              </div>
              <button type="button" className="rounded-full px-3 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => { setShowHistoryModal(false); setPendingRestore(null); }}>
                ×
              </button>
            </div>
            <div className="mt-5 max-h-[55vh] overflow-y-auto rounded-2xl border border-slate-200">
              {versionsLoading ? (
                <p className="px-4 py-6 text-sm text-slate-500">Loading history…</p>
              ) : !versionList || versionList.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">No version history available yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {versionList.map((v) => (
                    <li key={v.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${v.is_current ? "bg-indigo-50/40" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold text-slate-950">v{v.version_number}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{v.operation_type}</span>
                          {v.is_current && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">current</span>}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {new Date(v.created_at).toLocaleString()} · {v.row_count ?? "?"} rows · {v.column_count ?? "?"} cols
                          {v.missing_cells != null ? ` · ${v.missing_cells} missing` : ""}
                          {v.duplicate_rows != null ? ` · ${v.duplicate_rows} duplicates` : ""}
                        </p>
                      </div>
                      <button type="button" className="shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setPendingRestore(v)} disabled={v.is_current || restoringVersionId !== null}>
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {pendingRestore && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">Restore v{pendingRestore.version_number}?</p>
                <p className="mt-1">A new version will be created from this snapshot and become current.</p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100" onClick={() => setPendingRestore(null)} disabled={restoringVersionId !== null}>
                    Cancel
                  </button>
                  <button type="button" className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-70" onClick={() => confirmRestore(pendingRestore)} disabled={restoringVersionId !== null}>
                    {restoringVersionId === pendingRestore.id ? "Restoring…" : "Confirm restore"}
                  </button>
                </div>
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setShowHistoryModal(false); setPendingRestore(null); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Code export modal */}
      {showCodeExport && cleaningResult && (() => {
        const script = operationsToPandasScript(cleaningResult.operations_applied ?? [], workspace.dataset.original_filename);
        const safeFile = (workspace.dataset.original_filename || "cleaning_script").replace(/[^A-Za-z0-9_.-]/g, "_").replace(/\.[^.]+$/, "");
        async function copyScript() {
          try { await navigator.clipboard.writeText(script); setCodeExportCopied(true); globalThis.setTimeout(() => setCodeExportCopied(false), 2000); } catch { setCodeExportCopied(false); }
        }
        function downloadScript() {
          const blob = new Blob([script], { type: "text/x-python" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `${safeFile}_cleaning.py`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
            <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-indigo-500">Reproducibility</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-950">Export as Python (pandas) script</h2>
                  <p className="mt-1 text-sm text-slate-500">{cleaningResult.operations_applied.length} applied operation{cleaningResult.operations_applied.length === 1 ? "" : "s"}.</p>
                </div>
                <button type="button" className="rounded-full px-3 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowCodeExport(false)}>×</button>
              </div>
              <pre className="mt-5 max-h-[55vh] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-relaxed text-slate-100">{script}</pre>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setShowCodeExport(false)}>Close</button>
                <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={copyScript}>{codeExportCopied ? "Copied!" : "Copy script"}</button>
                <button type="button" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500" onClick={downloadScript}>Download .py</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-indigo-500">Save Result</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">Choose how to save</h2>
              </div>
              <button type="button" className="rounded-full px-3 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowSaveModal(false)}>×</button>
            </div>
            <div className="mt-6 space-y-3">
              <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${saveMode === "replace" ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                <input className="mt-1 h-4 w-4 accent-indigo-600" type="radio" checked={saveMode === "replace"} onChange={() => setSaveMode("replace")} />
                <div>
                  <p className="font-medium text-slate-950">Replace <span className="text-indigo-700">{workspace.dataset.original_filename}</span></p>
                  <p className="mt-1 text-sm text-slate-500">Overwrites the current dataset with the cleaned result.</p>
                  <p className="mt-1 text-xs font-medium text-amber-700">This becomes the current version. You can restore the previous one anytime from History.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${saveMode === "new" ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                <input className="mt-1 h-4 w-4 accent-indigo-600" type="radio" checked={saveMode === "new"} onChange={() => setSaveMode("new")} />
                <div className="w-full">
                  <p className="font-medium text-slate-950">Save as new dataset</p>
                  <p className="mt-1 text-sm text-slate-500">Create a separate dataset from this result.</p>
                  {saveMode === "new" && (
                    <input className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-500" value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} placeholder="Enter a dataset name" />
                  )}
                </div>
              </label>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button type="button" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-70" onClick={handleSaveResult} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
