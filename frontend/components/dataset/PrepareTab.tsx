"use client";

import { useEffect, useState } from "react";
import {
  CategoryStandardizationSuggestion,
  CleanApplyResponse,
  CleanDetectResponse,
  CleaningOperation,
  DatasetWorkspace,
  DateOutputFormat,
  DayFirstHint,
  FilterOp,
  FilterPredicate,
  FilterResponse,
  PatternImputationResult,
  UnparseableDateRow,
} from "@/lib/api";
import { AIAdvisorPanel } from "@/components/dataset/AIAdvisorPanel";

type MissingStrategy = "fill_mean" | "fill_median" | "fill_mode" | "drop_rows";
type PrepareSubTab = "overview" | "cleaning";

const DATE_FORMAT_LABELS: Record<DateOutputFormat, string> = {
  iso: "ISO (2024-01-08)",
  us: "US (01/08/2024)",
  eu: "EU (08/01/2024)",
};

const DAYFIRST_LABELS: Record<DayFirstHint, string> = {
  auto: "Auto-detect",
  day: "Day-first",
  month: "Month-first",
};

function getOperationLabel(op: CleaningOperation): string {
  switch (op.operation_type) {
    case "remove_all_duplicates": return "Remove duplicate rows";
    case "fill_mean": return op.column ? `Fill "${op.column}" with average` : "Fill with average";
    case "fill_median": return op.column ? `Fill "${op.column}" with median` : "Fill with median";
    case "fill_mode": return op.column ? `Fill "${op.column}" with mode` : "Fill with mode";
    case "drop_rows": return op.column ? `Drop rows missing "${op.column}"` : "Drop rows with missing";
    case "trim_whitespace": return "Trim whitespace";
    case "lowercase_column": return op.column ? `Lowercase "${op.column}"` : "Lowercase text";
    case "convert_column_type": return op.column ? `Convert "${op.column}" → ${op.target_type ?? "numeric"}` : "Convert column type";
    case "standardize_dates": return op.column ? `Standardize dates in "${op.column}"` : "Standardize dates";
    case "sort_values": return op.column ? `Sort by "${op.column}" (${op.ascending === false ? "desc" : "asc"})` : "Sort data";
    case "fill_pattern": return op.column && op.key_column ? `Smart fill "${op.column}" using "${op.key_column}"` : "Smart fill";
    case "derive_column": return op.new_column_name ? `Derived column "${op.new_column_name}"` : "Derived column";
    case "standardize_categories": return op.column ? `Standardize values in "${op.column}"` : "Standardize values";
    case "replace_with_missing": return op.column ? `Convert disguised-missing in "${op.column}"` : "Convert disguised-missing to empty";
    case "nullify_outliers": return op.column ? `Blank out potential errors in "${op.column}"` : "Blank out potential errors";
    case "remove_outliers": return op.column ? `Drop error rows in "${op.column}"` : "Drop error rows";
    default: return "Cleaning action";
  }
}

function getOperationDetail(op: CleaningOperation): string {
  switch (op.operation_type) {
    case "trim_whitespace": return op.columns?.length ? `Columns: ${op.columns.join(", ")}` : "All text columns";
    case "standardize_dates": {
      const fmt = op.output_format ? DATE_FORMAT_LABELS[op.output_format] : DATE_FORMAT_LABELS.iso;
      const hint = op.dayfirst_hint ? DAYFIRST_LABELS[op.dayfirst_hint] : DAYFIRST_LABELS.auto;
      return op.column ? `Format ${fmt} · ${hint}` : fmt;
    }
    case "derive_column": return op.expression ? `Formula: ${op.expression}` : "";
    case "fill_pattern": return op.key_column ? `Key: ${op.key_column}` : "";
    default: return op.columns?.length ? `Columns: ${op.columns.join(", ")}` : "";
  }
}

function strategyLabel(s: MissingStrategy): string {
  switch (s) {
    case "fill_mean": return "Average";
    case "fill_median": return "Median";
    case "fill_mode": return "Most common value";
    case "drop_rows": return "Drop rows";
    default: return s;
  }
}

type CleaningImpactMetric = {
  key: "row_count" | "column_count" | "missing_cells" | "duplicate_rows";
  label: string;
  unit: string;
  original: number | null;
  cleaned: number | null;
  improvementMetric: boolean;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetricValue(value: number | null): string {
  return value === null ? "-" : value.toLocaleString();
}

function getOriginalSummaryValue(workspace: DatasetWorkspace, key: CleaningImpactMetric["key"]): number | null {
  const summary = workspace.dataset.summary_json ?? {};
  if (key === "row_count") return toFiniteNumber(summary.row_count) ?? toFiniteNumber(workspace.dataset.row_count);
  if (key === "column_count") return toFiniteNumber(summary.column_count) ?? toFiniteNumber(workspace.dataset.column_count);
  return toFiniteNumber(summary[key]);
}

function getCleanedSummaryValue(cleaningResult: CleanApplyResponse, key: CleaningImpactMetric["key"]): number | null {
  return toFiniteNumber(cleaningResult.summary?.[key]);
}

function getImpactTone(metric: CleaningImpactMetric): string {
  if (!metric.improvementMetric || metric.original === null || metric.cleaned === null) {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  if (metric.cleaned < metric.original) return "border-green-200 bg-green-50 text-green-800";
  if (metric.cleaned > metric.original) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getImpactDescription(metric: CleaningImpactMetric): string {
  if (metric.original === null || metric.cleaned === null) return "Comparison unavailable";

  const diff = metric.cleaned - metric.original;
  const amount = Math.abs(diff).toLocaleString();
  const pluralUnit = Math.abs(diff) === 1 ? metric.unit : `${metric.unit}s`;

  if (diff === 0) return `No change in ${metric.label.toLowerCase()}`;

  if (metric.key === "missing_cells" && diff < 0) return `${amount} missing ${pluralUnit} removed or resolved`;
  if (metric.key === "missing_cells" && diff > 0) return `${amount} missing ${pluralUnit} added`;
  if (metric.key === "duplicate_rows" && diff < 0) return `${amount} duplicate ${pluralUnit} removed`;
  if (metric.key === "duplicate_rows" && diff > 0) return `${amount} duplicate ${pluralUnit} added`;

  return `${diff > 0 ? "+" : "-"}${amount} ${pluralUnit}`;
}

type CellIssue = "missing" | "type_mismatch" | "pseudo_null" | "variant" | "outlier" | "format_mismatch" | null;

const PSEUDO_NULL_TOKENS = new Set([
  "na", "n/a", "n.a", "n.a.", "not applicable", "not available",
  "none", "null", "nil", "nan", "-", "--", "---", "?", "??",
  "unknown", "unk", "missing", "tbd", "blank", "empty",
]);

const _DATE_FP: Array<[string, RegExp]> = [
  ["iso",            /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/],
  ["datetime_iso",   /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[T ]\d{1,2}:\d{2}/],
  ["numeric",        /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/],
  ["month_name",     /^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$/],
  ["day_month_name", /^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}$/],
  ["compact",        /^\d{8}$/],
  ["oracle",         /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/],
];
const _DATE_FP_FAMILY: Record<string, string> = { iso: "iso_family", datetime_iso: "iso_family" };

function dateFingerprintFamily(value: string): string | null {
  const s = value.trim();
  for (const [name, re] of _DATE_FP) {
    if (re.test(s)) {
      const family = _DATE_FP_FAMILY[name] ?? name;
      // For ISO-family dates (YYYY?MM?DD), also track the separator so
      // "2024-01-05" (dash) vs "2024/01/06" (slash) count as distinct sub-families.
      if (family === "iso_family") return `iso_family:${s[4]}`;
      return family;
    }
  }
  return null;
}

function computeDominantDateFormats(
  rows: Array<Record<string, unknown>>,
  cols: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const col of cols) {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const v = row[col];
      if (v == null || v === "") continue;
      const fam = dateFingerprintFamily(String(v));
      if (fam) counts[fam] = (counts[fam] ?? 0) + 1;
    }
    let best: string | null = null, max = 0;
    for (const [fam, n] of Object.entries(counts)) if (n > max) { max = n; best = fam; }
    if (best) result[col] = best;
  }
  return result;
}

type DetectContext = {
  columnTypes: Record<string, string>;
  pseudoNullCols?: Set<string>;
  outlierFences?: Record<string, { low: number; high: number }>;
  variantValues?: Record<string, Set<string>>;
  formatInconsistentCols?: Set<string>;
  dominantDateFormats?: Record<string, string>;
};

function getCellIssue(value: unknown, colName: string, ctx: DetectContext): CellIssue {
  if (value === null || value === undefined || value === "") return "missing";
  if (ctx.pseudoNullCols?.has(colName) && PSEUDO_NULL_TOKENS.has(String(value).trim().toLowerCase())) return "pseudo_null";
  if (ctx.variantValues?.[colName]?.has(String(value))) return "variant";
  const fences = ctx.outlierFences?.[colName];
  if (fences) {
    const n = Number(value);
    if (!isNaN(n) && (n < fences.low || n > fences.high)) return "outlier";
  }
  const t = ctx.columnTypes[colName];
  if ((t === "int64" || t === "float64") && isNaN(Number(value))) return "type_mismatch";
  if (t === "numeric_string") {
    const cleaned = String(value).trim().replace(/^[$€£¥₱]+/, "").replace(/[$€£¥₱]+$/, "").replace(/,/g, "");
    if (cleaned !== "" && isNaN(parseFloat(cleaned))) return "type_mismatch";
  }
  const dominant = ctx.dominantDateFormats?.[colName];
  if (dominant !== undefined) {
    const family = dateFingerprintFamily(String(value));
    if (family !== null && family !== dominant) return "format_mismatch";
  }
  return null;
}

function InsightCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm italic text-sky-800">
      {text}
    </div>
  );
}

export type PrepareTabProps = {
  workspace: DatasetWorkspace;
  token: string | null;
  subTab: PrepareSubTab;
  setSubTab: (t: PrepareSubTab) => void;
  cleaningDetection: CleanDetectResponse | null;
  cleaningDetecting: boolean;
  cleaningResult: CleanApplyResponse | null;
  cleaningOperations: CleaningOperation[];
  setCleaningOperations: React.Dispatch<React.SetStateAction<CleaningOperation[]>>;
  missingValueStrategies: Record<string, MissingStrategy>;
  setMissingValueStrategies: React.Dispatch<React.SetStateAction<Record<string, MissingStrategy>>>;
  dateFormatChoices: Record<string, DateOutputFormat>;
  setDateFormatChoices: React.Dispatch<React.SetStateAction<Record<string, DateOutputFormat>>>;
  dayfirstChoices: Record<string, DayFirstHint>;
  setDayfirstChoices: React.Dispatch<React.SetStateAction<Record<string, DayFirstHint>>>;
  overviewExtraRows: Record<string, unknown>[];
  overviewTotalRows: number | null;
  overviewLoadingMore: boolean;
  filterPredicates: FilterPredicate[];
  setFilterPredicates: React.Dispatch<React.SetStateAction<FilterPredicate[]>>;
  filterCombine: "and" | "or";
  setFilterCombine: React.Dispatch<React.SetStateAction<"and" | "or">>;
  filterPanelOpen: boolean;
  setFilterPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  filterResult: FilterResponse | null;
  filterLoading: boolean;
  draftFilterColumn: string;
  setDraftFilterColumn: React.Dispatch<React.SetStateAction<string>>;
  draftFilterOp: FilterOp;
  setDraftFilterOp: React.Dispatch<React.SetStateAction<FilterOp>>;
  draftFilterValue: string;
  setDraftFilterValue: React.Dispatch<React.SetStateAction<string>>;
  draftFilterLower: string;
  setDraftFilterLower: React.Dispatch<React.SetStateAction<string>>;
  draftFilterUpper: string;
  setDraftFilterUpper: React.Dispatch<React.SetStateAction<string>>;
  cumulativeAppliedOperations: CleaningOperation[];
  applying: boolean;
  sortColumn: string;
  setSortColumn: React.Dispatch<React.SetStateAction<string>>;
  sortAscending: boolean;
  setSortAscending: React.Dispatch<React.SetStateAction<boolean>>;
  // handlers
  handleApplyCleaning: () => void;
  handleLoadMoreOverviewRows: () => void;
  addFilterPredicate: () => void;
  removeFilterPredicate: (i: number) => void;
  clearAllFilters: () => void;
  handleRescanData: () => void;
  toggleDuplicateRows: () => void;
  toggleTrimWhitespace: () => void;
  toggleLowercaseColumn: (col: string) => void;
  toggleConvertType: (col: string, type: "numeric" | "datetime") => void;
  toggleSortValues: () => void;
  toggleStandardizeDates: (col: string) => void;
  togglePatternImputation: (target: string, key: string) => void;
  addMissingValueOperation: (col: string) => void;
  categoryMappingEdits: Record<string, Record<string, string>>;
  setCategoryCanonical: (col: string, suggested: string, edited: string) => void;
  toggleStandardizeCategories: (col: string, mapping: Record<string, string>) => void;
  toggleReplaceWithMissing: (col: string) => void;
  toggleRemoveOutliers: (col: string) => void;
  toggleNullifyOutliers: (col: string) => void;
  buildStandardizeCategoriesOperation: (col: string, mapping: Record<string, string>) => CleaningOperation;
  buildReplaceWithMissingOperation: (col: string) => CleaningOperation;
  buildRemoveOutliersOperation: (col: string) => CleaningOperation;
  buildNullifyOutliersOperation: (col: string) => CleaningOperation;
  hasQueuedOperation: (op: CleaningOperation) => boolean;
  getColumnType: (col: string) => string;
  isLowercaseCandidate: (type: string) => boolean;
  getDefaultMissingStrategy: (col: string) => MissingStrategy;
  buildDuplicateOperation: () => CleaningOperation;
  buildTrimWhitespaceOperation: (cols: string[]) => CleaningOperation;
  buildMissingValueOperation: (col: string, strategy: MissingStrategy) => CleaningOperation;
  buildConvertTypeOperation: (col: string, type: "numeric" | "datetime") => CleaningOperation;
  buildSortValuesOperation: (col: string, asc: boolean) => CleaningOperation;
  buildStandardizeDatesOperation: (col: string, fmt: DateOutputFormat, hint: DayFirstHint) => CleaningOperation;
  buildPatternImputationOperation: (target: string, key: string) => CleaningOperation;
};

export function PrepareTab(props: PrepareTabProps) {
  const {
    workspace, token, subTab, setSubTab,
    cleaningDetection, cleaningDetecting, cleaningResult, cleaningOperations, setCleaningOperations,
    missingValueStrategies, setMissingValueStrategies,
    dateFormatChoices, setDateFormatChoices,
    dayfirstChoices, setDayfirstChoices,
    overviewExtraRows, overviewTotalRows, overviewLoadingMore,
    filterPredicates, setFilterPredicates, filterCombine, setFilterCombine,
    filterPanelOpen, setFilterPanelOpen, filterResult, filterLoading,
    draftFilterColumn, setDraftFilterColumn, draftFilterOp, setDraftFilterOp,
    draftFilterValue, setDraftFilterValue, draftFilterLower, setDraftFilterLower, draftFilterUpper, setDraftFilterUpper,
    cumulativeAppliedOperations, applying,
    sortColumn, setSortColumn, sortAscending, setSortAscending,
    handleApplyCleaning, handleLoadMoreOverviewRows,
    addFilterPredicate, removeFilterPredicate, clearAllFilters,
    handleRescanData, toggleDuplicateRows, toggleTrimWhitespace,
    toggleLowercaseColumn, toggleConvertType, toggleSortValues,
    toggleStandardizeDates, togglePatternImputation, addMissingValueOperation,
    categoryMappingEdits, setCategoryCanonical, toggleStandardizeCategories, toggleReplaceWithMissing, toggleRemoveOutliers, toggleNullifyOutliers,
    buildStandardizeCategoriesOperation, buildReplaceWithMissingOperation, buildRemoveOutliersOperation, buildNullifyOutliersOperation,
    hasQueuedOperation, getColumnType, isLowercaseCandidate, getDefaultMissingStrategy,
    buildDuplicateOperation, buildTrimWhitespaceOperation, buildMissingValueOperation,
    buildConvertTypeOperation, buildSortValuesOperation, buildStandardizeDatesOperation, buildPatternImputationOperation,
  } = props;

  const [expandedSmartFill, setExpandedSmartFill] = useState<Set<string>>(new Set());
  const [selectedSmartFillKey, setSelectedSmartFillKey] = useState<Record<string, string>>({});
  const [cleanedPreviewLimit, setCleanedPreviewLimit] = useState(10);
  const [dataIssuesOpen, setDataIssuesOpen] = useState(true);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [textCleanupOpen, setTextCleanupOpen] = useState(false);
  const [statInsightsOpen, setStatInsightsOpen] = useState(true);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnExpression, setNewColumnExpression] = useState("");
  const [newColumnError, setNewColumnError] = useState<string | null>(null);

  useEffect(() => {
    setCleanedPreviewLimit(10);
  }, [cleaningResult]);

  // Auto-expand Formatting group when scan finds formatting issues
  useEffect(() => {
    if (!cleaningDetection) return;
    const hasFormattingIssues =
      cleaningIssues.some((i) => i.kind === "type_inconsistency" && i.column) ||
      cleaningIssues.some((i) => i.kind === "format_inconsistency" && i.column) ||
      (cleaningDetection.category_suggestions?.length ?? 0) > 0;
    setFormattingOpen(hasFormattingIssues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleaningDetection?.dataset_version_id]);

  // Auto-populate queue with AI-recommended fixes when a new scan arrives
  useEffect(() => {
    if (!cleaningDetection || cleaningOperations.length > 0) return;
    const autoOps: CleaningOperation[] = [];
    if ((cleaningDetection.duplicates ?? 0) > 0) autoOps.push(buildDuplicateOperation());
    for (const issue of cleaningIssues.filter((i) => i.kind === "missing_values" && i.column)) {
      const col = issue.column ?? "";
      autoOps.push(buildMissingValueOperation(col, getDefaultMissingStrategy(col)));
    }
    if (autoOps.length > 0) setCleaningOperations(autoOps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleaningDetection?.dataset_version_id]);

  const availableColumns = workspace.dataset.columns_json?.map((c) => String(c.name ?? "")).filter(Boolean) ?? [];
  const cleaningIssues = cleaningDetection?.issues ?? [];
  const queuedDerivedColumns = cleaningOperations.filter((op) => op.operation_type === "derive_column");
  const cleaningImpactMetrics: CleaningImpactMetric[] = [
    { key: "row_count", label: "Row count", unit: "row", original: getOriginalSummaryValue(workspace, "row_count"), cleaned: cleaningResult ? getCleanedSummaryValue(cleaningResult, "row_count") : null, improvementMetric: false },
    { key: "column_count", label: "Column count", unit: "column", original: getOriginalSummaryValue(workspace, "column_count"), cleaned: cleaningResult ? getCleanedSummaryValue(cleaningResult, "column_count") : null, improvementMetric: false },
    { key: "missing_cells", label: "Missing cells", unit: "cell", original: getOriginalSummaryValue(workspace, "missing_cells"), cleaned: cleaningResult ? getCleanedSummaryValue(cleaningResult, "missing_cells") : null, improvementMetric: true },
    { key: "duplicate_rows", label: "Duplicate rows", unit: "row", original: getOriginalSummaryValue(workspace, "duplicate_rows"), cleaned: cleaningResult ? getCleanedSummaryValue(cleaningResult, "duplicate_rows") : null, improvementMetric: true },
  ];

  function handleAddDerivedColumn() {
    const name = newColumnName.trim();
    const expression = newColumnExpression.trim();
    if (!name) { setNewColumnError("Enter a name for the new column."); return; }
    if (!expression) { setNewColumnError("Enter a formula for the new column."); return; }
    if (availableColumns.some((col) => col.toLowerCase() === name.toLowerCase())) {
      setNewColumnError(`"${name}" already exists as a column.`);
      return;
    }
    if (queuedDerivedColumns.some((op) => (op.new_column_name ?? "").toLowerCase() === name.toLowerCase())) {
      setNewColumnError(`"${name}" is already queued as a new column.`);
      return;
    }
    setCleaningOperations((ops) => [
      ...ops,
      { operation_type: "derive_column", columns: [], column: null, target_type: null, drop_all_missing: true, errors: "coerce", new_column_name: name, expression },
    ]);
    setNewColumnName("");
    setNewColumnExpression("");
    setNewColumnError(null);
  }

  function handleRemoveDerivedColumn(name: string | null | undefined) {
    setCleaningOperations((ops) => ops.filter((op) => !(op.operation_type === "derive_column" && op.new_column_name === name)));
  }

  function renderPreviewTable(
    rows: Array<Record<string, unknown>> = workspace.dataset.preview_json ?? [],
    detectCtx?: DetectContext | null
  ) {
    if (rows.length === 0) return <p className="text-sm text-slate-600">No preview available.</p>;
    const cols = Object.keys(rows[0] ?? {});
    const formatBadgeCols = detectCtx?.formatInconsistentCols ?? new Set<string>();
    const cellStyles: Record<string, { cls: string; title: string }> = {
      missing: { cls: "px-4 py-3 bg-red-50 text-red-700 border-l-2 border-red-300", title: "This cell is empty — no data here" },
      type_mismatch: { cls: "px-4 py-3 bg-amber-50 text-amber-700 border-l-2 border-amber-300", title: "This value doesn't look like a number — check your data" },
      pseudo_null: { cls: "px-4 py-3 bg-orange-50 text-orange-700 border-l-2 border-orange-300", title: "This looks like a disguised missing value (e.g. NA) — convert it to empty in Cleaning" },
      variant: { cls: "px-4 py-3 bg-purple-50 text-purple-700 border-l-2 border-purple-300", title: "Inconsistent value — looks like a variant of another value in this column" },
      outlier: { cls: "px-4 py-3 bg-teal-50 text-teal-700 border-l-2 border-teal-300", title: "Statistical outlier — unusually far from the typical range. Could be a rare valid event (e.g. heavy rainfall, sales spike) or a data entry error — investigate before removing." },
      format_mismatch: { cls: "px-4 py-3 bg-sky-50 text-sky-700 border-l-2 border-sky-300", title: "Different date format — this date is written differently from the rest of the column. Fix it in the Clean tab." },
    };
    return (
      <>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>{cols.map((c) => (
                <th key={c} className="px-4 py-3 text-left font-medium text-slate-600">
                  {c}
                  {formatBadgeCols.has(c) && (
                    <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700" title="This column mixes multiple date formats">mixed formats</span>
                  )}
                </th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const issue = detectCtx ? getCellIssue(row[c], c, detectCtx) : null;
                    const style = issue ? cellStyles[issue] : null;
                    return (
                      <td key={c} className={style?.cls ?? "px-4 py-3 text-slate-800"} title={style?.title}>
                        {issue === "missing"
                          ? <span className="italic text-xs">empty</span>
                          : String(row[c] ?? "-")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detectCtx && (
          <div className="mt-2 flex flex-wrap items-center gap-4 px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-red-300 shrink-0" /> Empty cell</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-orange-300 shrink-0" /> Disguised missing</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-purple-300 shrink-0" /> Inconsistent value</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-teal-300 shrink-0" /> Outlier</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-amber-300 shrink-0" /> Type mismatch</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-sky-300 shrink-0" /> Inconsistent date format</span>
          </div>
        )}
      </>
    );
  }

  function buildCategoryMapping(sug: CategoryStandardizationSuggestion): Record<string, string> {
    const edits = categoryMappingEdits[sug.column] ?? {};
    const mapping: Record<string, string> = {};
    for (const g of sug.groups) {
      const finalCanonical = (edits[g.canonical] ?? g.canonical).trim() || g.canonical;
      for (const member of [g.canonical, ...g.variants]) {
        if (member !== finalCanonical) mapping[member] = finalCanonical;
      }
    }
    return mapping;
  }

  function buildOverviewDetectCtx(det: CleanDetectResponse, rows: Array<Record<string, unknown>>): DetectContext {
    const pseudoNullCols = new Set((det.pseudo_nulls ?? []).map((p) => p.column));
    const outlierFences: Record<string, { low: number; high: number }> = {};
    for (const o of det.outliers ?? []) outlierFences[o.column] = { low: o.lower_fence, high: o.upper_fence };
    const variantValues: Record<string, Set<string>> = {};
    for (const s of det.category_suggestions ?? []) {
      const set = new Set<string>();
      for (const g of s.groups) for (const v of g.variants) set.add(v);
      variantValues[s.column] = set;
    }
    const formatInconsistentCols = new Set(
      (det.issues ?? []).filter((i) => i.kind === "format_inconsistency" && i.column).map((i) => i.column as string)
    );
    const dominantDateFormats = computeDominantDateFormats(rows, formatInconsistentCols);
    return { columnTypes: det.column_types, pseudoNullCols, outlierFences, variantValues, formatInconsistentCols, dominantDateFormats };
  }


  // -- Overview sub-tab --
  const allOverviewRows = [...(workspace.dataset.preview_json ?? []), ...overviewExtraRows];
  const overviewTotal = overviewTotalRows ?? workspace.dataset.row_count ?? 0;
  const overviewLoaded = allOverviewRows.length;
  const canLoadMore = overviewLoaded < overviewTotal;
  const displayPreview = cleaningResult ? cleaningResult.preview : allOverviewRows;

  const filterOps: { value: FilterOp; label: string }[] = [
    { value: "eq", label: "= equals" }, { value: "neq", label: "≠ not equal" },
    { value: "gt", label: "> greater than" }, { value: "gte", label: "≥ greater or equal" },
    { value: "lt", label: "< less than" }, { value: "lte", label: "≤ less or equal" },
    { value: "contains", label: "contains" }, { value: "starts_with", label: "starts with" },
    { value: "in", label: "in (comma list)" }, { value: "between", label: "between" },
    { value: "is_null", label: "is empty" }, { value: "not_null", label: "is not empty" },
  ];
  const opLabel = (op: FilterOp) => filterOps.find((o) => o.value === op)?.label ?? op;
  const predicateChip = (p: FilterPredicate): string => {
    if (p.op === "is_null") return `${p.column} is empty`;
    if (p.op === "not_null") return `${p.column} is not empty`;
    if (p.op === "between") return `${p.column} between ${String(p.lower)} and ${String(p.upper)}`;
    if (p.op === "in") return `${p.column} in (${(p.values ?? []).join(", ")})`;
    return `${p.column} ${opLabel(p.op).split(" ")[0]} ${String(p.value)}`;
  };
  const isUnary = draftFilterOp === "is_null" || draftFilterOp === "not_null";
  const isRange = draftFilterOp === "between";

  // -- Cleaning sub-tab --
  const duplicateCount = cleaningDetection?.duplicates ?? 0;
  const missingIssues = cleaningIssues.filter((i) => i.kind === "missing_values" && i.column);
  const typeIssues = cleaningIssues.filter((i) => i.kind === "type_inconsistency" && i.column);
  const formatIssues = cleaningIssues.filter((i) => i.kind === "format_inconsistency" && i.column);
  const categorySuggestions = cleaningDetection?.category_suggestions ?? [];
  const pseudoNullSummaries = cleaningDetection?.pseudo_nulls ?? [];
  const outlierSummaries = cleaningDetection?.outliers ?? [];
  const patternSuggestions = cleaningDetection?.pattern_suggestions ?? [];
  const smartFillByTarget = new Map<string, (typeof patternSuggestions)[0][]>();
  for (const s of patternSuggestions) {
    if (!smartFillByTarget.has(s.target_column)) smartFillByTarget.set(s.target_column, []);
    smartFillByTarget.get(s.target_column)!.push(s);
  }
  const dateCols = availableColumns.filter((col) => {
    const t = getColumnType(col);
    return t === "datetime" || t === "datetime_string";
  });
  const unparseableMap = (cleaningResult?.summary.unparseable_dates ?? {}) as Record<string, import("@/lib/api").UnparseableDateRow[]>;
  const dataIssueCount =
    (duplicateCount > 0 ? 1 : 0) +
    missingIssues.length +
    pseudoNullSummaries.length +
    smartFillByTarget.size;
  const formattingIssueCount = typeIssues.length + formatIssues.length + categorySuggestions.length;
  const totalIssueCount = dataIssueCount + formattingIssueCount;
  const textColumns = availableColumns.filter((col) => {
    const type = getColumnType(col);
    return ["text", "categorical", "numeric_string", "datetime_string"].includes(type);
  });
  const duplicateQueued = hasQueuedOperation(buildDuplicateOperation());
  const trimQueued = hasQueuedOperation(buildTrimWhitespaceOperation(textColumns));

  return (
    <div className="space-y-6">
      {/* Guided workflow hint */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
        <p className="text-sm font-semibold text-indigo-800">How to use this tab</p>
        <p className="text-sm text-indigo-700 mt-0.5">
          Browse your live data in the <strong>Data</strong> view — cells highlighted red are missing, yellow have a type problem. Switch to <strong>Clean</strong> to queue operations and apply them.
        </p>
      </div>
      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {(["overview", "cleaning"] as PrepareSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${subTab === t ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"}`}
          >
            {t === "overview" ? "Data" : "Clean"}
            {t === "cleaning" && cleaningResult && (
              <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {subTab === "overview" && (
        <div className="space-y-6">
          {cleaningResult && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>Showing cleaned preview — save to make this permanent.</span>
              <button type="button" className="shrink-0 font-medium underline underline-offset-4 decoration-amber-400 hover:text-amber-900" onClick={() => setSubTab("cleaning")}>
                Go to Clean →
              </button>
            </div>
          )}

          {/* Filters */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setFilterPanelOpen((o) => !o)}>
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-950">Filters</span>
                {filterPredicates.length > 0 ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{filterPredicates.length} active</span>
                ) : (
                  <span className="text-xs text-slate-500">Narrow your dataset by column predicates.</span>
                )}
              </span>
              <span className="text-slate-400">{filterPanelOpen ? "▾" : "▸"}</span>
            </button>

            {filterPredicates.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {filterPredicates.map((p, i) => (
                  <span key={`${p.column}-${p.op}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                    {predicateChip(p)}
                    <button type="button" className="text-indigo-500 hover:text-indigo-900" onClick={() => removeFilterPredicate(i)} aria-label="Remove filter">×</button>
                  </span>
                ))}
                {filterPredicates.length > 1 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                    Combine:
                    <button type="button" className={`rounded-full px-2 py-0.5 ${filterCombine === "and" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`} onClick={() => setFilterCombine("and")}>AND</button>
                    <button type="button" className={`rounded-full px-2 py-0.5 ${filterCombine === "or" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`} onClick={() => setFilterCombine("or")}>OR</button>
                  </span>
                )}
                <button type="button" className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline underline-offset-4" onClick={clearAllFilters}>Clear all</button>
              </div>
            )}

            {filterPanelOpen && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,180px)_minmax(0,1fr)_auto]">
                <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" value={draftFilterColumn} onChange={(e) => setDraftFilterColumn(e.target.value)}>
                  <option value="">Column…</option>
                  {availableColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
                <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" value={draftFilterOp} onChange={(e) => setDraftFilterOp(e.target.value as FilterOp)}>
                  {filterOps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {isUnary ? (
                  <div className="self-center px-2 text-xs text-slate-500">No value needed.</div>
                ) : isRange ? (
                  <div className="flex items-center gap-2">
                    <input type="text" placeholder="lower" value={draftFilterLower} onChange={(e) => setDraftFilterLower(e.target.value)} className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" />
                    <span className="text-xs text-slate-500">to</span>
                    <input type="text" placeholder="upper" value={draftFilterUpper} onChange={(e) => setDraftFilterUpper(e.target.value)} className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" />
                  </div>
                ) : (
                  <input type="text" placeholder={draftFilterOp === "in" ? "value1, value2, …" : "value"} value={draftFilterValue} onChange={(e) => setDraftFilterValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFilterPredicate(); } }} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" />
                )}
                <button type="button" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50" onClick={addFilterPredicate} disabled={!draftFilterColumn}>Add filter</button>
              </div>
            )}

            {filterPredicates.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                {filterLoading ? "Filtering…" : filterResult
                  ? `Showing ${Math.min(filterResult.limit, filterResult.rows.length)} of ${filterResult.total_matched.toLocaleString()} matching rows.`
                  : "No filter result yet."}
              </p>
            )}
          </div>

          {/* Data table */}
          {filterPredicates.length > 0 && filterResult ? renderPreviewTable(filterResult.rows) : (
            <>
              {renderPreviewTable(
                displayPreview,
                !cleaningResult && cleaningDetection ? buildOverviewDetectCtx(cleaningDetection, displayPreview) : null
              )}
              {!cleaningResult && canLoadMore ? (
                <button onClick={handleLoadMoreOverviewRows} disabled={overviewLoadingMore} className="w-full rounded-xl border border-slate-200 bg-white py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {overviewLoadingMore ? "Loading…" : `Load 10 more (${overviewLoaded} of ${overviewTotal} shown)`}
                </button>
              ) : !cleaningResult && overviewLoaded > 10 ? (
                <p className="text-center text-xs text-slate-400">All {overviewTotal} rows shown</p>
              ) : null}
            </>
          )}
        </div>
      )}

      <div className={subTab !== "cleaning" ? "hidden" : "space-y-6"}>
          {cleaningDetecting ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Detecting cleaning issues…
            </div>
          ) : (
            <>
              <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
                {/* LEFT: Fix checklist */}
                <div className="space-y-3">

                  {/* AI Summary Strip */}
                  <div className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-linear-to-r from-indigo-50 to-emerald-50 px-4 py-3">
                    <p className="flex-1 text-sm text-indigo-800">
                      {cleaningDetection ? (
                        totalIssueCount > 0 ? (
                          <>
                            <strong>{dataIssueCount} data</strong>
                            {formattingIssueCount > 0 && <> · <strong>{formattingIssueCount} formatting</strong></>}
                            {outlierSummaries.length > 0 && <> · <strong>{outlierSummaries.length} statistical</strong></>}
                            {" "}issue{totalIssueCount !== 1 ? "s" : ""} found — {cleaningOperations.length} fix{cleaningOperations.length !== 1 ? "es" : ""} selected. Uncheck anything you don&apos;t want, then hit Apply.
                          </>
                        ) : (
                          <strong>Your data looks clean — no issues detected.</strong>
                        )
                      ) : (
                        "Click Re-scan to check for data issues."
                      )}
                    </p>
                    <button type="button" onClick={handleRescanData} className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition">
                      ↻ Re-scan
                    </button>
                  </div>

                  {/* Data Issues Group */}
                  {cleaningDetection && dataIssueCount > 0 && (
                    <div className="rounded-2xl border border-red-200 bg-white overflow-hidden shadow-sm">
                      <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100 text-left hover:bg-slate-100 transition" onClick={() => setDataIssuesOpen((o) => !o)}>
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" />
                        <span className="font-semibold text-slate-950 text-sm">Data Issues</span>
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 ml-1">{dataIssueCount} found</span>
                        <span className="ml-auto text-slate-400 text-xs">{dataIssuesOpen ? "▾" : "▸"}</span>
                      </button>

                      {dataIssuesOpen && (
                        <div className="divide-y divide-slate-100">

                          {/* Duplicates */}
                          {duplicateCount > 0 && (() => {
                            const op = buildDuplicateOperation();
                            const queued = hasQueuedOperation(op);
                            return (
                              <div className="flex items-start gap-3 px-5 py-3.5">
                                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={toggleDuplicateRows} aria-label="Toggle remove duplicates">
                                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-950">Remove {duplicateCount} duplicate row{duplicateCount !== 1 ? "s" : ""}</p>
                                  <p className="text-xs text-slate-500 mt-0.5">Keeps one copy of each repeated record.</p>
                                </div>
                                <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Critical</span>
                              </div>
                            );
                          })()}

                          {/* Missing values */}
                          {missingIssues.map((issue) => {
                            const col = issue.column ?? "";
                            const strategy = missingValueStrategies[col] ?? getDefaultMissingStrategy(col);
                            const op = buildMissingValueOperation(col, strategy);
                            const queued = hasQueuedOperation(op);
                            const count = Number(issue.details?.missing_values ?? 0);
                            const pct = (workspace.dataset.row_count ?? 0) > 0 ? ((count / (workspace.dataset.row_count ?? 1)) * 100).toFixed(1) : "0.0";
                            const aiPick = getDefaultMissingStrategy(col);
                            return (
                              <div key={col} className="flex items-start gap-3 px-5 py-3.5">
                                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => addMissingValueOperation(col)} aria-label={`Toggle fix for ${col}`}>
                                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-950">Fill <span className="text-indigo-600">&quot;{col}&quot;</span> — {count} empty cells ({pct}%)</p>
                                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-slate-500">Strategy:</span>
                                    <select
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                                      value={strategy}
                                      onChange={(e) => {
                                        setMissingValueStrategies((s) => ({ ...s, [col]: e.target.value as MissingStrategy }));
                                      }}
                                    >
                                      <option value={aiPick}>{strategyLabel(aiPick)} (AI pick)</option>
                                      {(["fill_mean", "fill_median", "fill_mode", "drop_rows"] as MissingStrategy[])
                                        .filter((s) => s !== aiPick)
                                        .map((s) => <option key={s} value={s}>{strategyLabel(s)}</option>)}
                                    </select>
                                  </div>
                                </div>
                                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Missing</span>
                              </div>
                            );
                          })}

                          {/* Pseudo-nulls */}
                          {pseudoNullSummaries.map((pn) => {
                            const queued = hasQueuedOperation(buildReplaceWithMissingOperation(pn.column));
                            return (
                              <div key={`pn-${pn.column}`} className="flex items-start gap-3 px-5 py-3.5">
                                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleReplaceWithMissing(pn.column)} aria-label={`Toggle pseudo-null fix for ${pn.column}`}>
                                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-950">Convert disguised blanks in <span className="text-indigo-600">&quot;{pn.column}&quot;</span></p>
                                  <p className="text-xs text-slate-500 mt-0.5">{pn.total} cells contain &quot;{Object.keys(pn.tokens).join('", "')}&quot; — treated as missing.</p>
                                </div>
                                <span className="shrink-0 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Pseudo-null</span>
                              </div>
                            );
                          })}

                          {/* Smart Fill */}
                          {[...smartFillByTarget.entries()].map(([target, options]) => {
                            const selectedKey = selectedSmartFillKey[target] ?? options[0].key_column;
                            const activeSuggestion = options.find((s) => s.key_column === selectedKey) ?? options[0];
                            const op = buildPatternImputationOperation(target, selectedKey);
                            const queued = hasQueuedOperation(op);
                            const confidencePct = Math.round(activeSuggestion.weighted_confidence * 100);
                            const isExpanded = expandedSmartFill.has(target);
                            const topGroups = [...activeSuggestion.groups].sort((a, b) => b.fillable_count - a.fillable_count).slice(0, 5);
                            const extraCount = activeSuggestion.groups.length - topGroups.length;
                            return (
                              <div key={`sf-${target}`} className="px-5 py-3.5">
                                <div className="flex items-start gap-3">
                                  <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white hover:border-emerald-400"}`} onClick={() => togglePatternImputation(target, selectedKey)} aria-label={`Toggle smart fill for ${target}`}>
                                    {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-950">Smart fill <span className="text-emerald-600">&quot;{target}&quot;</span></p>
                                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                                      <span className="text-xs text-slate-500">Using:</span>
                                      <select
                                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-emerald-400 focus:outline-none"
                                        value={selectedKey}
                                        onChange={(e) => setSelectedSmartFillKey((prev) => ({ ...prev, [target]: e.target.value }))}
                                      >
                                        {options.map((o) => (
                                          <option key={o.key_column} value={o.key_column}>{o.key_column}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-2">
                                      <div className="h-1.5 w-16 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${confidencePct}%` }} /></div>
                                      <span className="text-xs font-medium text-emerald-700">{confidencePct}% match</span>
                                      {topGroups.length > 0 && (
                                        <button type="button" className="text-xs text-indigo-500 hover:text-indigo-700 underline underline-offset-2 transition"
                                          onClick={() => setExpandedSmartFill((prev) => { const next = new Set(prev); if (next.has(target)) next.delete(target); else next.add(target); return next; })}>
                                          {isExpanded ? "Hide example ▴" : "Show example ▾"}
                                        </button>
                                      )}
                                    </div>
                                    {isExpanded && topGroups.length > 0 && (
                                      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                                        <table className="min-w-full text-xs">
                                          <thead className="bg-slate-100 text-slate-500">
                                            <tr>
                                              <th className="px-3 py-2 text-left font-medium">When &quot;{selectedKey}&quot; is…</th>
                                              <th className="px-3 py-2 text-left font-medium">Fill &quot;{target}&quot; with</th>
                                              <th className="px-3 py-2 text-right font-medium">Cells</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 bg-white">
                                            {topGroups.map((g) => (
                                              <tr key={g.key_value}>
                                                <td className="px-3 py-1.5 font-mono text-slate-700">{g.key_value}</td>
                                                <td className="px-3 py-1.5 text-emerald-700 font-medium">{g.fill_value !== null && g.fill_value !== undefined ? String(g.fill_value) : "—"}</td>
                                                <td className="px-3 py-1.5 text-right text-slate-500">{g.fillable_count}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                        {extraCount > 0 && <p className="px-3 py-1.5 text-xs text-slate-400 bg-slate-50 text-right">+{extraCount} more group{extraCount !== 1 ? "s" : ""}</p>}
                                      </div>
                                    )}
                                  </div>
                                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Smart Fill</span>
                                </div>
                              </div>
                            );
                          })}

                        </div>
                      )}
                    </div>
                  )}

                  {/* Statistical Insights Group */}
                  {cleaningDetection && outlierSummaries.length > 0 && (
                    <div className="rounded-2xl border border-teal-200 bg-white overflow-hidden shadow-sm">
                      <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100 text-left hover:bg-slate-100 transition" onClick={() => setStatInsightsOpen((o) => !o)}>
                        <span className="h-2.5 w-2.5 rounded-full bg-teal-500 shrink-0" />
                        <span className="font-semibold text-slate-950 text-sm">Statistical Insights</span>
                        <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700 ml-1">{outlierSummaries.length} column{outlierSummaries.length !== 1 ? "s" : ""}</span>
                        <span className="ml-auto text-slate-400 text-xs">{statInsightsOpen ? "▾" : "▸"}</span>
                      </button>
                      {statInsightsOpen && (
                        <div className="divide-y divide-slate-100">
                          <div className="px-5 py-3 text-xs text-slate-500 bg-teal-50/40">
                            These values are statistically unusual — not necessarily errors. Review the flagged values before deciding to act.
                          </div>
                          {outlierSummaries.map((o) => {
                            const nullifyQueued = hasQueuedOperation(buildNullifyOutliersOperation(o.column));
                            const removeQueued = hasQueuedOperation(buildRemoveOutliersOperation(o.column));
                            return (
                              <div key={`out-${o.column}`} className="divide-y divide-slate-100">
                                <div className="flex items-start gap-3 px-5 py-3.5">
                                  <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${nullifyQueued ? "border-amber-500 bg-amber-500" : "border-slate-300 bg-white hover:border-amber-400"}`} onClick={() => toggleNullifyOutliers(o.column)}>
                                    {nullifyQueued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-950">Potential outliers in <span className="text-teal-600">&quot;{o.column}&quot;</span></p>
                                    <p className="text-xs text-slate-500 mt-0.5">{o.outlier_count} values outside the typical range ({o.lower_fence}–{o.upper_fence}). If these are errors, convert them to empty — rows are kept.</p>
                                    {o.sample_values.length > 0 && (
                                      <p className="mt-0.5 text-xs text-teal-700">Flagged values: {o.sample_values.map(String).join(", ")}</p>
                                    )}
                                  </div>
                                  <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">Stat. Outlier</span>
                                </div>
                                <div className="flex items-start gap-3 px-5 py-3 bg-slate-50/60">
                                  <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${removeQueued ? "border-amber-500 bg-amber-500" : "border-slate-300 bg-white hover:border-amber-400"}`} onClick={() => toggleRemoveOutliers(o.column)}>
                                    {removeQueued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-950">Drop rows with outliers in <span className="text-teal-600">&quot;{o.column}&quot;</span></p>
                                    <p className="text-xs text-slate-500 mt-0.5">If these are errors, drops the entire rows containing them. Only use if you&apos;re sure the rows are invalid.</p>
                                  </div>
                                  <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">Stat. Outlier</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Formatting Group */}
                  {cleaningDetection && (
                    <div className="rounded-2xl border border-purple-200 bg-white overflow-hidden shadow-sm">
                      <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100 text-left hover:bg-slate-100 transition" onClick={() => setFormattingOpen((o) => !o)}>
                        <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shrink-0" />
                        <span className="font-semibold text-slate-950 text-sm">Formatting</span>
                        {formattingIssueCount > 0
                          ? <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700 ml-1">{formattingIssueCount} found</span>
                          : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ml-1">none detected</span>}
                        <span className="ml-auto text-slate-400 text-xs">{formattingOpen ? "▾" : "▸"}</span>
                      </button>

                      {formattingOpen && (
                        <div className="divide-y divide-slate-100">

                          {/* Type inconsistencies */}
                          {(() => {
                            const pseudoCols = new Set(pseudoNullSummaries.map((p) => p.column));
                            const overlap = typeIssues
                              .filter((i) => i.column && pseudoCols.has(i.column))
                              .map((i) => i.column as string);
                            if (overlap.length === 0) return null;
                            return (
                              <div className="mx-5 my-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                <strong>{overlap.join(", ")}</strong>{overlap.length === 1 ? " has" : " have"} disguised empty values — replacing them first (in Data Issues above) gives a cleaner type conversion.
                              </div>
                            );
                          })()}
                          {typeIssues.map((issue) => {
                            const col = issue.column ?? "";
                            const inferred = String(issue.details?.inferred_type ?? "");
                            const target: "numeric" | "datetime" = inferred === "datetime_string" ? "datetime" : "numeric";
                            const queued = hasQueuedOperation(buildConvertTypeOperation(col, target));
                            const invalidSamples = Array.isArray(issue.details?.invalid_value_samples)
                              ? (issue.details.invalid_value_samples as string[])
                              : [];
                            return (
                              <div key={col} className="flex items-start gap-3 px-5 py-3.5">
                                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleConvertType(col, target)}>
                                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-950">Convert <span className="text-indigo-600">&quot;{col}&quot;</span> from text → {target}</p>
                                  <p className="text-xs text-slate-500 mt-0.5">This column contains {target} values stored as text. AI is confident this is a mistake.</p>
                                  {invalidSamples.length > 0 && (
                                    <p className="mt-0.5 text-xs text-amber-700">
                                      Non-{target === "numeric" ? "numeric" : "date"} value{invalidSamples.length > 1 ? "s" : ""}: {invalidSamples.map((v) => `"${v}"`).join(", ")}
                                    </p>
                                  )}
                                </div>
                                <span className="shrink-0 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">Type Fix</span>
                              </div>
                            );
                          })}

                          {/* Date standardization */}
                          {dateCols.map((col) => {
                            const fmt = dateFormatChoices[col] ?? "iso";
                            const hint = dayfirstChoices[col] ?? "auto";
                            const queued = hasQueuedOperation(buildStandardizeDatesOperation(col, fmt, hint));
                            const unparseable = unparseableMap[col] ?? [];
                            return (
                              <div key={col} className="px-5 py-3.5">
                                <div className="flex items-start gap-3">
                                  <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleStandardizeDates(col)}>
                                    {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-950">Standardize dates in <span className="text-indigo-600">&quot;{col}&quot;</span></p>
                                    <div className="mt-1.5 flex flex-wrap gap-3">
                                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                        Format
                                        <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none" value={fmt} onChange={(e) => setDateFormatChoices((c) => ({ ...c, [col]: e.target.value as DateOutputFormat }))}>
                                          {(["iso", "us", "eu"] as DateOutputFormat[]).map((f) => <option key={f} value={f}>{DATE_FORMAT_LABELS[f]}</option>)}
                                        </select>
                                      </label>
                                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                        Order
                                        <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none" value={hint} onChange={(e) => setDayfirstChoices((c) => ({ ...c, [col]: e.target.value as DayFirstHint }))}>
                                          {(["auto", "day", "month"] as DayFirstHint[]).map((h) => <option key={h} value={h}>{DAYFIRST_LABELS[h]}</option>)}
                                        </select>
                                      </label>
                                    </div>
                                    {unparseable.length > 0 && <p className="mt-1.5 text-xs text-amber-700">{unparseable.length} cell{unparseable.length !== 1 ? "s" : ""} could not be parsed — original values preserved.</p>}
                                  </div>
                                  <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">Dates</span>
                                </div>
                              </div>
                            );
                          })}

                          {/* Category standardization */}
                          {categorySuggestions.map((sug) => {
                            const mapping = buildCategoryMapping(sug);
                            const queued = hasQueuedOperation(buildStandardizeCategoriesOperation(sug.column, mapping));
                            const edits = categoryMappingEdits[sug.column] ?? {};
                            return (
                              <div key={`cat-${sug.column}`} className="px-5 py-3.5">
                                <div className="flex items-start gap-3">
                                  <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleStandardizeCategories(sug.column, mapping)}>
                                    {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-950">Fix inconsistent values in <span className="text-indigo-600">&quot;{sug.column}&quot;</span></p>
                                    <div className="mt-2 space-y-1.5">
                                      {sug.groups.map((g) => (
                                        <div key={`${sug.column}-${g.canonical}`} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                          <span className="flex flex-wrap gap-1">
                                            {g.variants.map((v) => (
                                              <span key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 line-through">{v}</span>
                                            ))}
                                          </span>
                                          <span className="text-slate-400">→</span>
                                          <input type="text" className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-900 outline-none focus:border-indigo-500" value={edits[g.canonical] ?? g.canonical} onChange={(e) => setCategoryCanonical(sug.column, g.canonical, e.target.value)} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">Categories</span>
                                </div>
                              </div>
                            );
                          })}

                          {formattingIssueCount === 0 && (
                            <div className="px-5 py-4 text-sm text-slate-500">No formatting issues detected.</div>
                          )}

                        </div>
                      )}
                    </div>
                  )}

                  {/* Text Cleanup Group */}
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 text-left hover:bg-slate-100 transition" onClick={() => setTextCleanupOpen((o) => !o)}>
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-950 text-sm">Text Cleanup</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ml-1">optional</span>
                      <span className="ml-auto text-slate-400 text-xs">{textCleanupOpen ? "▾" : "▸"}</span>
                    </button>
                    {textCleanupOpen && (
                      <div className="divide-y divide-slate-100">
                        <div className="flex items-start gap-3 px-5 py-3.5">
                          <button type="button" disabled={textColumns.length === 0} className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition disabled:opacity-40 ${trimQueued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={toggleTrimWhitespace}>
                            {trimQueued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-950">Trim whitespace</p>
                            <p className="text-xs text-slate-500 mt-0.5">Remove leading and trailing spaces from all text columns.</p>
                          </div>
                        </div>
                        {textColumns.filter((col) => isLowercaseCandidate(getColumnType(col))).map((col) => {
                          const queued = hasQueuedOperation({ operation_type: "lowercase_column", columns: [col], column: col, target_type: null, drop_all_missing: true, errors: "coerce" });
                          return (
                            <div key={col} className="flex items-start gap-3 px-5 py-3.5">
                              <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleLowercaseColumn(col)}>
                                {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                              </button>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-950">Lowercase <span className="text-indigo-600">&quot;{col}&quot;</span></p>
                                <p className="text-xs text-slate-500 mt-0.5">Make text values consistent for comparisons.</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Sort Data */}
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-950 text-sm">Sort Data</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ml-1">optional</span>
                    </div>
                    <div className="p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortColumn} onChange={(e) => setSortColumn(e.target.value)}>
                          <option value="">Column…</option>
                          {availableColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                        </select>
                        <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortAscending ? "asc" : "desc"} onChange={(e) => setSortAscending(e.target.value === "asc")}>
                          <option value="asc">Ascending (A→Z, 0→9)</option>
                          <option value="desc">Descending (Z→A, 9→0)</option>
                        </select>
                        {(() => {
                          const op = sortColumn ? buildSortValuesOperation(sortColumn, sortAscending) : null;
                          const queued = op ? hasQueuedOperation(op) : false;
                          return (
                            <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-700 text-white hover:bg-slate-600"}`} onClick={toggleSortValues} disabled={!sortColumn}>
                              {queued ? "Added" : "Add"}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Add Column */}
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-950 text-sm">Add Column</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ml-1">optional</span>
                    </div>
                    <div className="p-5 space-y-3">
                      <p className="text-xs text-slate-500">
                        Create a new column from a formula using existing column names, e.g. <code className="rounded bg-slate-100 px-1 py-0.5">price * quantity</code> or <code className="rounded bg-slate-100 px-1 py-0.5">total - discount</code>.
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="text"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none w-48"
                          placeholder="New column name…"
                          value={newColumnName}
                          onChange={(e) => { setNewColumnName(e.target.value); setNewColumnError(null); }}
                        />
                        <input
                          type="text"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none flex-1 min-w-50"
                          placeholder="Formula, e.g. price * quantity"
                          value={newColumnExpression}
                          onChange={(e) => { setNewColumnExpression(e.target.value); setNewColumnError(null); }}
                        />
                        <button
                          type="button"
                          className="rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 bg-slate-700 text-white hover:bg-slate-600"
                          onClick={handleAddDerivedColumn}
                          disabled={!newColumnName.trim() || !newColumnExpression.trim()}
                        >
                          Add
                        </button>
                      </div>
                      {newColumnError && <p className="text-xs text-red-600">{newColumnError}</p>}
                      {availableColumns.length > 0 && (
                        <p className="text-xs text-slate-400">
                          Available columns: {availableColumns.join(", ")}
                        </p>
                      )}
                      {queuedDerivedColumns.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {queuedDerivedColumns.map((op) => (
                            <span key={op.new_column_name} className="inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs text-indigo-700">
                              <span><strong>{op.new_column_name}</strong> = {op.expression}</span>
                              <button
                                type="button"
                                className="text-indigo-400 hover:text-indigo-700"
                                onClick={() => handleRemoveDerivedColumn(op.new_column_name)}
                                aria-label={`Remove derived column ${op.new_column_name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sticky Apply bar */}
                  <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm px-5 py-4 shadow-lg">
                    <p className="text-sm text-slate-600">
                      {cleaningOperations.length > 0 ? (
                        <><strong className="text-slate-950">{cleaningOperations.length} fix{cleaningOperations.length !== 1 ? "es" : ""}</strong> selected · Applied in safe order automatically.</>
                      ) : (
                        <span className="text-slate-400">No fixes selected yet.</span>
                      )}
                    </p>
                    <button type="button" className="shrink-0 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50" onClick={handleApplyCleaning} disabled={applying || cleaningOperations.length === 0}>
                      {applying ? "Applying…" : `Apply ${cleaningOperations.length} Fix${cleaningOperations.length !== 1 ? "es" : ""}`}
                    </button>
                  </div>

                </div>{/* /LEFT */}

                {/* RIGHT: AI sidebar */}
                <div className="xl:sticky xl:top-20 h-fit">
                  {cleaningDetection && token && (
                    <AIAdvisorPanel
                      detectResult={cleaningDetection}
                      dataset={workspace.dataset}
                      token={token}
                    />
                  )}
                </div>
              </div>

              {/* Cleaned Preview */}
              {cleaningResult && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold text-slate-950">Cleaned Preview</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Preview the result before saving. Showing {Math.min(cleanedPreviewLimit, cleaningResult.preview.length)} of {cleaningResult.preview.length} rows.
                  </p>
                  <div className="mt-4">
                    {renderPreviewTable(cleaningResult.preview.slice(0, cleanedPreviewLimit))}
                  </div>
                  {cleaningResult.preview.length > cleanedPreviewLimit && (
                    <button
                      type="button"
                      onClick={() => setCleanedPreviewLimit((n) => Math.min(n + 20, cleaningResult.preview.length))}
                      className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
                    >
                      Show {Math.min(20, cleaningResult.preview.length - cleanedPreviewLimit)} more rows ({cleaningResult.preview.length - cleanedPreviewLimit} remaining)
                    </button>
                  )}
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h4 className="font-semibold text-slate-950">Cleaning Impact Summary</h4>
                        <p className="mt-1 text-sm text-slate-600">Original dataset compared with the cleaned preview.</p>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {cleaningImpactMetrics.map((metric) => {
                        const diff = metric.original !== null && metric.cleaned !== null ? metric.cleaned - metric.original : null;
                        return (
                          <div key={metric.key} className={`rounded-xl border p-3 ${getImpactTone(metric)}`}>
                            <dt className="text-xs font-medium text-slate-500">{metric.label}</dt>
                            <dd className="mt-2 text-lg font-semibold text-slate-950">
                              {formatMetricValue(metric.original)}
                              <span className="mx-2 text-sm font-medium text-slate-400">&rarr;</span>
                              {formatMetricValue(metric.cleaned)}
                            </dd>
                            <p className="mt-1 text-xs font-medium">
                              {diff !== null && diff !== 0 && (
                                <span className={metric.improvementMetric && diff < 0 ? "text-green-700" : "text-slate-500"}>
                                  {diff > 0 ? "+" : "-"}{Math.abs(diff).toLocaleString()}
                                  {" "}
                                </span>
                              )}
                              {getImpactDescription(metric)}
                            </p>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}
