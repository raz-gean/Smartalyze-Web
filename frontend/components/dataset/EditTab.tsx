"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { detectCleaningIssues, getDatasetRows, saveManualEdit } from "@/lib/api";
import type { CleanDetectResponse, CleaningIssue, DatasetWorkspace, OutlierColumnSummary } from "@/lib/api";
import { columnNames, orderColumns } from "@/lib/columnOrder";
import { columnTypeInfo } from "@/lib/columnTypes";
import { readEditDraft, removeEditDraft, writeEditDraft } from "@/lib/editDraft";
import type { EditDraft } from "@/lib/editDraft";
import { DatasetHealthPanel } from "./EditTab/DatasetHealthPanel";
import { EditableCell } from "./EditTab/EditableCell";
import { EditToolbar } from "./EditTab/EditToolbar";
import { IssuesPanel } from "./EditTab/IssuesPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// wasEdited: the cell already held an unsaved edit before this change, so undo restores
// oldValue as that edit; otherwise undo removes the edit and the saved value shows again.
type CellChange = { rowIndex: number; colName: string; oldValue: unknown; newValue: unknown; wasEdited: boolean };

type EditOperation =
  | ({ type: "cell_edit" } & CellChange)
  | { type: "row_delete"; rowIndex: number; row: Row }
  | { type: "row_insert"; rowIndex: number }
  | { type: "col_rename"; oldName: string; newName: string }
  | { type: "bulk_suggest"; changes: CellChange[] }
  | { type: "col_delete"; colName: string; colIndex: number; deletedEdits: Array<[string, unknown]> }
  | { type: "col_insert"; colName: string; colIndex: number };

function describeOperation(op: EditOperation): string {
  switch (op.type) {
    case "cell_edit": return `cell edit in "${op.colName}"`;
    case "row_delete": return "row deletion";
    case "row_insert": return "row insertion";
    case "col_rename": return `column rename`;
    case "bulk_suggest": return `${op.changes.length} suggested fix${op.changes.length !== 1 ? "es" : ""}`;
    case "col_delete": return `deletion of column "${op.colName}"`;
    case "col_insert": return `addition of column "${op.colName}"`;
  }
}

interface SortConfig {
  col: string;
  dir: "asc" | "desc";
}

export interface EditTabProps {
  workspace: DatasetWorkspace;
  token: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}

// ─── Type badge helper ────────────────────────────────────────────────────────

// Column types from the data scan, shown as a short badge; the hover tip comes from lib/columnTypes.
const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  numeric:         { label: "123",  cls: "bg-blue-50 text-blue-600 border-blue-200" },
  numeric_string:  { label: "123",  cls: "bg-amber-50 text-amber-700 border-amber-200" },
  text:            { label: "Aa",   cls: "bg-slate-100 text-slate-500 border-slate-200" },
  categorical:     { label: "Aa",   cls: "bg-slate-100 text-slate-500 border-slate-200" },
  datetime:        { label: "date", cls: "bg-violet-50 text-violet-600 border-violet-200" },
  datetime_string: { label: "date", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  boolean:         { label: "T/F",  cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
};
const UNKNOWN_BADGE = { label: "?", cls: "bg-slate-100 text-slate-400 border-slate-200" };

function TypeBadge({ type }: { type: string }) {
  const t = TYPE_BADGES[type.toLowerCase()] ?? UNKNOWN_BADGE;
  const { label, tip } = columnTypeInfo(type);
  return (
    <span
      title={tip}
      aria-label={label}
      className={`inline-block rounded border px-1 text-[10px] font-medium leading-4 ${t.cls}`}
    >
      {t.label}
    </span>
  );
}

// ─── Suggested-fix helpers ────────────────────────────────────────────────────

type FillPlan = { count: number; description: string };

const isBlank = (value: unknown) => value === null || value === undefined || value === "";
// Same grouping key as smart fill on the server: "Panabo", "panabo " and "PANABO" match.
const normalizeKey = (value: unknown) => String(value).trim().toLowerCase();

function mostCommon(values: unknown[]): unknown {
  const counts = new Map<string, { value: unknown; n: number }>();
  for (const value of values) {
    const entry = counts.get(String(value));
    if (entry) entry.n += 1;
    else counts.set(String(value), { value, n: 1 });
  }
  // Ties go to the first value in sorted order, like pandas mode().
  const sorted = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let best: { value: unknown; n: number } | undefined;
  for (const [, entry] of sorted) if (!best || entry.n > best.n) best = entry;
  return best?.value;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Suggest the same fix the Prepare tab recommends for each empty cell: smart fill
 * (the usual value for the related column) when the scan found one, otherwise the
 * median for numbers or the most common value for text.
 */
function buildFillSuggestions(rows: Row[], detection: CleanDetectResponse) {
  const suggestions = new Map<string, unknown>();
  const plans: Record<string, FillPlan> = {};

  for (const [col, missing] of Object.entries(detection.missing_values ?? {})) {
    if (!missing) continue;
    const blanks = rows.flatMap((row, idx) => (isBlank(row[col]) ? [idx] : []));
    const known = rows.map((row) => row[col]).filter((value) => !isBlank(value));
    if (blanks.length === 0 || known.length === 0) continue;

    const pattern = (detection.pattern_suggestions ?? [])
      .filter((p) => p.target_column === col)
      .sort((a, b) => b.weighted_confidence - a.weighted_confidence)[0];
    if (pattern) {
      const valuesByKey = new Map<string, unknown[]>();
      for (const row of rows) {
        const key = row[pattern.key_column];
        if (isBlank(key) || isBlank(row[col])) continue;
        const group = valuesByKey.get(normalizeKey(key));
        if (group) group.push(row[col]);
        else valuesByKey.set(normalizeKey(key), [row[col]]);
      }
      let count = 0;
      for (const idx of blanks) {
        const key = rows[idx][pattern.key_column];
        const group = isBlank(key) ? undefined : valuesByKey.get(normalizeKey(key));
        if (!group) continue;
        suggestions.set(`${idx}::${col}`, mostCommon(group));
        count += 1;
      }
      if (count > 0) {
        plans[col] = { count, description: `Smart fill: the usual ${col} for each ${pattern.key_column}` };
        continue;
      }
    }

    const numbers = known.map(Number);
    const type = detection.column_types?.[col];
    let fill: unknown;
    let description: string;
    if ((type === "numeric" || type === "numeric_string") && numbers.every(Number.isFinite)) {
      fill = median(numbers);
      description = `Fill with the median (${(fill as number).toLocaleString(undefined, { maximumFractionDigits: 2 })})`;
    } else {
      fill = mostCommon(known);
      description = `Fill with the most common value ("${String(fill)}")`;
    }
    blanks.forEach((idx) => suggestions.set(`${idx}::${col}`, fill));
    plans[col] = { count: blanks.length, description };
  }
  return { suggestions, plans };
}

/** Cells outside the IQR fences found by the data scan (same rule as the Detect tab). */
function findOutlierCells(rows: Row[], outliers: OutlierColumnSummary[]): Set<string> {
  const cells = new Set<string>();
  for (const { column, lower_fence, upper_fence } of outliers) {
    rows.forEach((row, idx) => {
      if (isBlank(row[column])) return;
      const n = Number(row[column]);
      if (Number.isFinite(n) && (n < lower_fence || n > upper_fence)) cells.add(`${idx}::${column}`);
    });
  }
  return cells;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditTab({ workspace, token, onDirtyChange, onSaved }: EditTabProps) {
  const datasetId = workspace.dataset.id;
  const totalRows = workspace.dataset.row_count ?? 0;
  const baseVersionId = workspace.dataset.current_version_id ?? null;
  // Read at load time without re-fetching rows whenever the workspace object changes.
  const columnOrderRef = useRef<string[]>([]);
  columnOrderRef.current = columnNames(workspace.dataset.columns_json);

  // ── Core data state ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const originalRows = useRef<Row[]>([]);
  const originalColumns = useRef<string[]>([]);

  // ── Edit tracking ────────────────────────────────────────────────────────
  const [editedCells, setEditedCells] = useState<Map<string, unknown>>(new Map());
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [insertedRows, setInsertedRows] = useState<Map<number, Row>>(new Map());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  // Original column name -> current name. Renames rewrite `rows` keys, so a saved
  // draft needs this to rebuild them from the freshly loaded rows.
  const columnRenames = useRef<Map<string, string>>(new Map());

  // ── Draft (unsaved edits kept in the browser across refresh) ─────────────
  const [pendingDraft, setPendingDraft] = useState<EditDraft | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const draftWarned = useRef(false);
  // Latest draft not yet written by the debounce, flushed if the page or tab goes away first.
  const unsavedDraft = useRef<EditDraft | null>(null);

  // ── Undo / redo ──────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<EditOperation[]>([]);
  const [redoStack, setRedoStack] = useState<EditOperation[]>([]);

  // ── Suggested fixes (from the rule-based data scan) ───────────────────────
  const [suggestions, setSuggestions] = useState<Map<string, unknown>>(new Map());
  const [fillPlans, setFillPlans] = useState<Record<string, FillPlan>>({});
  const [duplicateRowIndices, setDuplicateRowIndices] = useState<Set<number>>(new Set());
  const [outlierCells, setOutlierCells] = useState<Set<string>>(new Set());
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [missingValuesPerCol, setMissingValuesPerCol] = useState<Record<string, number>>({});
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [allIssues, setAllIssues] = useState<CleaningIssue[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQueryRaw] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [addColumnDraft, setAddColumnDraft] = useState("");
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Dirty detection ──────────────────────────────────────────────────────
  const columnsChanged =
    columns.length !== originalColumns.current.length ||
    columns.some((c, i) => c !== originalColumns.current[i]);
  const isDirty = editedCells.size > 0 || deletedRows.size > 0 || insertedRows.size > 0 || columnsChanged;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);
  // Leaving the tab unmounts the editor; its edits are no longer on screen (the draft keeps them).
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Suggested fixes not yet applied: a cell the user has filled or edited drops out
  // (Undo brings it back), so the fill buttons and counts reflect what is left to do.
  const pendingSuggestions = useMemo(
    () => new Map([...suggestions].filter(([key]) => !editedCells.has(key))),
    [suggestions, editedCells],
  );
  const pendingFillPlans = useMemo(() => {
    const counts: Record<string, number> = {};
    pendingSuggestions.forEach((_, key) => {
      const col = key.slice(key.indexOf("::") + 2);
      counts[col] = (counts[col] ?? 0) + 1;
    });
    return Object.fromEntries(
      Object.entries(fillPlans)
        .filter(([col]) => counts[col])
        .map(([col, plan]) => [col, { ...plan, count: counts[col] }]),
    );
  }, [pendingSuggestions, fillPlans]);
  // Columns whose suggested fixes have all been applied (not saved yet).
  const filledColumns = useMemo(
    () => new Set(Object.keys(fillPlans).filter((col) => !pendingFillPlans[col])),
    [fillPlans, pendingFillPlans],
  );

  // ── Search debounce ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const setSearchQuery = useCallback((v: string) => setSearchQueryRaw(v), []);

  // ── Load all rows on mount ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoadingRows(true);
      setLoadProgress({ loaded: 0, total: totalRows });
      const PAGE = 100;
      const accumulated: Row[] = [];
      let offset = 0;
      let fetchedTotal = 0;

      try {
        while (true) {
          const res = await getDatasetRows(datasetId, offset, PAGE, token);
          if (cancelled) return;
          accumulated.push(...res.rows);
          fetchedTotal = res.total;
          setLoadProgress({ loaded: accumulated.length, total: fetchedTotal });
          if (accumulated.length >= res.total || res.rows.length === 0) break;
          offset += PAGE;
        }

        const cols = orderColumns(accumulated.length > 0 ? Object.keys(accumulated[0]) : [], columnOrderRef.current);
        setRows(accumulated);
        setColumns(cols);
        originalRows.current = accumulated.map((r) => ({ ...r }));
        originalColumns.current = [...cols];
        columnRenames.current = new Map();
      } catch (err) {
        if (!cancelled) setErrorMsg(String(err));
      } finally {
        if (!cancelled) setLoadingRows(false);
      }
    }
    loadAll();
    return () => { cancelled = true; };
  }, [datasetId, token, totalRows]);

  // ── Look for a saved draft once rows are loaded ──────────────────────────
  useEffect(() => {
    if (loadingRows || draftChecked) return;
    const draft = readEditDraft(datasetId);
    if (draft) {
      if (draft.baseVersionId === baseVersionId) {
        setPendingDraft(draft);
      } else {
        removeEditDraft(datasetId);
        toast.info("Your earlier unsaved edits were cleared because this dataset has changed since.");
      }
    }
    setDraftChecked(true);
  }, [loadingRows, draftChecked, datasetId, baseVersionId]);

  // ── Autosave the draft while there are unsaved edits ─────────────────────
  // Paused until the user decides what to do with a found draft, so it isn't overwritten.
  const storeDraft = useCallback((draft: EditDraft) => {
    unsavedDraft.current = null;
    if (!writeEditDraft(datasetId, draft) && !draftWarned.current) {
      draftWarned.current = true;
      toast.warning("These edits are too large to keep as a backup in your browser. Save before leaving the page.");
    }
  }, [datasetId]);

  useEffect(() => {
    if (loadingRows || !draftChecked || pendingDraft) {
      unsavedDraft.current = null;
      return;
    }
    if (!isDirty) {
      unsavedDraft.current = null;
      removeEditDraft(datasetId);
      return;
    }
    const draft: EditDraft = {
      baseVersionId,
      savedAt: new Date().toISOString(),
      editedCells: [...editedCells.entries()],
      deletedRows: [...deletedRows],
      insertedRows: [...insertedRows.entries()],
      columns,
      columnRenames: [...columnRenames.current.entries()],
    };
    unsavedDraft.current = draft;
    const timer = setTimeout(() => storeDraft(draft), 500);
    return () => clearTimeout(timer);
  }, [loadingRows, draftChecked, pendingDraft, isDirty, datasetId, baseVersionId, editedCells, deletedRows, insertedRows, columns, storeDraft]);

  // Don't lose the last half-second of edits to a refresh, a closed tab, or leaving the Edit tab.
  useEffect(() => {
    function flush() {
      if (unsavedDraft.current) storeDraft(unsavedDraft.current);
    }
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [storeDraft]);

  function handleRestoreDraft() {
    if (!pendingDraft) return;
    const renames = new Map(pendingDraft.columnRenames);
    setRows(
      originalRows.current.map((row) => {
        const next: Row = {};
        for (const [k, v] of Object.entries(row)) next[renames.get(k) ?? k] = v;
        return next;
      })
    );
    columnRenames.current = renames;
    setColumns(pendingDraft.columns);
    setEditedCells(new Map(pendingDraft.editedCells));
    setDeletedRows(new Set(pendingDraft.deletedRows));
    setInsertedRows(new Map(pendingDraft.insertedRows));
    setSelectedRows(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setPendingDraft(null);
    toast.success("Your unsaved edits are back.");
  }

  function handleDiscardDraft() {
    removeEditDraft(datasetId);
    setPendingDraft(null);
  }

  // ── Fetch suggested fixes after rows loaded ──────────────────────────────
  useEffect(() => {
    if (loadingRows || rows.length === 0) return;
    let cancelled = false;
    async function fetchSuggestions() {
      setSuggestionsLoading(true);
      try {
        const result = await detectCleaningIssues(datasetId, token);
        if (cancelled) return;

        const { suggestions: sugMap, plans } = buildFillSuggestions(rows, result);
        const outlierSet = findOutlierCells(rows, result.outliers ?? []);
        const dupSet = new Set<number>();

        // Duplicate rows
        if (result.duplicates > 0) {
          const seen = new Map<string, number>();
          rows.forEach((row, idx) => {
            const key = JSON.stringify(row);
            if (seen.has(key)) {
              dupSet.add(idx);
            } else {
              seen.set(key, idx);
            }
          });
        }

        setSuggestions(sugMap);
        setFillPlans(plans);
        setDuplicateRowIndices(dupSet);
        setOutlierCells(outlierSet);
        setMissingValuesPerCol(result.missing_values ?? {});
        setColumnTypes(result.column_types ?? {});
        setAllIssues(result.issues ?? []);
      } catch {
        // Suggestions are non-blocking — silently ignore errors
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }
    fetchSuggestions();
    return () => { cancelled = true; };
  }, [loadingRows, datasetId, token, rows]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undoRef.current(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redoRef.current(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Undo / redo helpers ──────────────────────────────────────────────────
  function pushUndo(op: EditOperation) {
    setUndoStack((s) => [...s.slice(-49), op]);
    setRedoStack([]);
  }

  // Side effects stay outside the state updaters: React may run an updater twice (StrictMode),
  // which would push the same operation twice and show two toasts.
  function handleUndo() {
    const op = undoStack[undoStack.length - 1];
    if (!op) return;
    applyReverse(op);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((r) => [...r, op]);
    toast.info(`Undone: ${describeOperation(op)}`);
  }

  function handleRedo() {
    const op = redoStack[redoStack.length - 1];
    if (!op) return;
    applyForward(op);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((u) => [...u, op]);
    toast.info(`Redone: ${describeOperation(op)}`);
  }

  function applyReverse(op: EditOperation) {
    if (op.type === "cell_edit") {
      setEditedCells((m) => {
        const next = new Map(m);
        const key = `${op.rowIndex}::${op.colName}`;
        if (op.wasEdited) next.set(key, op.oldValue);
        else next.delete(key);
        return next;
      });
    } else if (op.type === "row_delete") {
      setDeletedRows((s) => { const n = new Set(s); n.delete(op.rowIndex); return n; });
    } else if (op.type === "row_insert") {
      setInsertedRows((m) => { const n = new Map(m); n.delete(op.rowIndex); return n; });
    } else if (op.type === "col_rename") {
      renameColumnInState(op.newName, op.oldName);
    } else if (op.type === "bulk_suggest") {
      setEditedCells((m) => {
        const next = new Map(m);
        for (const c of op.changes) {
          const key = `${c.rowIndex}::${c.colName}`;
          if (c.wasEdited) next.set(key, c.oldValue);
          else next.delete(key);
        }
        return next;
      });
    } else if (op.type === "col_delete") {
      setColumns((cs) => {
        const next = [...cs];
        next.splice(op.colIndex, 0, op.colName);
        return next;
      });
      setEditedCells((m) => {
        const next = new Map(m);
        for (const [k, v] of op.deletedEdits) next.set(k, v);
        return next;
      });
    } else if (op.type === "col_insert") {
      setColumns((cs) => cs.filter((c) => c !== op.colName));
      setEditedCells((m) => {
        const next = new Map(m);
        for (const key of next.keys()) {
          if (key.endsWith(`::${op.colName}`)) next.delete(key);
        }
        return next;
      });
    }
  }

  function applyForward(op: EditOperation) {
    if (op.type === "cell_edit") {
      setEditedCells((m) => {
        const next = new Map(m);
        next.set(`${op.rowIndex}::${op.colName}`, op.newValue);
        return next;
      });
    } else if (op.type === "row_delete") {
      setDeletedRows((s) => new Set([...s, op.rowIndex]));
    } else if (op.type === "row_insert") {
      setInsertedRows((m) => {
        const blank: Row = {};
        columns.forEach((c) => { blank[c] = null; });
        return new Map([...m, [op.rowIndex, blank]]);
      });
    } else if (op.type === "col_rename") {
      renameColumnInState(op.oldName, op.newName);
    } else if (op.type === "bulk_suggest") {
      setEditedCells((m) => {
        const next = new Map(m);
        for (const c of op.changes) { next.set(`${c.rowIndex}::${c.colName}`, c.newValue); }
        return next;
      });
    } else if (op.type === "col_delete") {
      setColumns((cs) => cs.filter((c) => c !== op.colName));
      setEditedCells((m) => {
        const next = new Map(m);
        for (const [k] of op.deletedEdits) next.delete(k);
        return next;
      });
    } else if (op.type === "col_insert") {
      setColumns((cs) => {
        const next = [...cs];
        next.splice(op.colIndex, 0, op.colName);
        return next;
      });
    }
  }

  // ── Column rename helpers ────────────────────────────────────────────────
  function renameColumnInState(oldName: string, newName: string) {
    const renames = columnRenames.current;
    const original = [...renames.entries()].find(([, current]) => current === oldName)?.[0] ?? oldName;
    if (original === newName) renames.delete(original);
    else renames.set(original, newName);
    setColumns((cols) => cols.map((c) => (c === oldName ? newName : c)));
    setRows((rs) =>
      rs.map((row) => {
        if (!(oldName in row)) return row;
        const next: Row = {};
        for (const [k, v] of Object.entries(row)) { next[k === oldName ? newName : k] = v; }
        return next;
      })
    );
    setEditedCells((m) => {
      const next = new Map<string, unknown>();
      m.forEach((v, k) => {
        const [ri, col] = k.split("::");
        next.set(`${ri}::${col === oldName ? newName : col}`, v);
      });
      return next;
    });
  }

  function commitRename() {
    if (!renamingCol) return;
    const newName = renameDraft.trim().slice(0, 100);
    if (!newName || newName === renamingCol) { setRenamingCol(null); return; }
    if (columns.includes(newName)) { setRenamingCol(null); return; }
    const op: EditOperation = { type: "col_rename", oldName: renamingCol, newName };
    renameColumnInState(renamingCol, newName);
    pushUndo(op);
    setRenamingCol(null);
  }

  function handleDeleteColumn(colName: string) {
    const colIndex = columns.indexOf(colName);
    if (colIndex === -1) return;
    const deletedEdits: Array<[string, unknown]> = [];
    for (const [key, val] of editedCells.entries()) {
      if (key.endsWith(`::${colName}`)) deletedEdits.push([key, val]);
    }
    pushUndo({ type: "col_delete", colName, colIndex, deletedEdits });
    setColumns((cs) => cs.filter((c) => c !== colName));
    setEditedCells((m) => {
      const next = new Map(m);
      for (const [k] of deletedEdits) next.delete(k);
      return next;
    });
    setMissingValuesPerCol((prev) => { const n = { ...prev }; delete n[colName]; return n; });
    setColumnTypes((prev) => { const n = { ...prev }; delete n[colName]; return n; });
  }

  function commitAddColumn() {
    const name = addColumnDraft.trim().slice(0, 100);
    if (!name) { setAddingColumn(false); setAddColumnDraft(""); return; }
    if (columns.includes(name)) {
      toast.error(`A column named "${name}" already exists.`);
      return;
    }
    const colIndex = columns.length;
    setColumns((cs) => [...cs, name]);
    pushUndo({ type: "col_insert", colName: name, colIndex });
    setAddingColumn(false);
    setAddColumnDraft("");
  }

  // ── Cell commit ──────────────────────────────────────────────────────────
  function handleCellCommit(rowIndex: number, colName: string, newValue: unknown) {
    const key = `${rowIndex}::${colName}`;
    const wasEdited = editedCells.has(key);
    const oldValue = wasEdited ? editedCells.get(key) : rows[rowIndex]?.[colName] ?? insertedRows.get(rowIndex)?.[colName] ?? null;
    const op: EditOperation = { type: "cell_edit", rowIndex, colName, oldValue, newValue, wasEdited };

    setEditedCells((m) => {
      const next = new Map(m);
      next.set(key, newValue);
      return next;
    });
    pushUndo(op);
  }

  function handleAcceptSuggestion(rowIndex: number, colName: string, suggested: unknown) {
    handleCellCommit(rowIndex, colName, suggested);
  }

  // ── Add / delete rows ────────────────────────────────────────────────────
  function handleAddRow() {
    // Next unused index: rows.length + size would reuse a key after an inserted row is undone.
    const newIndex = Math.max(rows.length - 1, ...insertedRows.keys()) + 1;
    const blank: Row = {};
    columns.forEach((c) => { blank[c] = null; });
    setInsertedRows((m) => new Map([...m, [newIndex, blank]]));
    pushUndo({ type: "row_insert", rowIndex: newIndex });
  }

  function handleDeleteSelected() {
    setDeletedRows((s) => new Set([...s, ...selectedRows]));
    for (const idx of selectedRows) {
      pushUndo({ type: "row_delete", rowIndex: idx, row: rows[idx] ?? {} });
    }
    setSelectedRows(new Set());
  }

  // ── Apply all suggestions ────────────────────────────────────────────────
  function handleApplyAllSuggestions() {
    const changes: CellChange[] = [];
    pendingSuggestions.forEach((suggested, key) => {
      const [riStr, colName] = key.split("::");
      const rowIndex = Number(riStr);
      const wasEdited = editedCells.has(key);
      const oldValue = wasEdited ? editedCells.get(key) : rows[rowIndex]?.[colName] ?? null;
      changes.push({ rowIndex, colName, oldValue, newValue: suggested, wasEdited });
    });
    if (changes.length === 0) return;
    setEditedCells((m) => {
      const next = new Map(m);
      changes.forEach(({ rowIndex, colName, newValue }) => next.set(`${rowIndex}::${colName}`, newValue));
      return next;
    });
    pushUndo({ type: "bulk_suggest", changes });
  }

  // ── Apply suggestions for a single column ───────────────────────────────
  function handleApplyColumnSuggestions(colName: string) {
    const changes: CellChange[] = [];
    pendingSuggestions.forEach((suggested, key) => {
      const [riStr, col] = key.split("::");
      if (col !== colName) return;
      const rowIndex = Number(riStr);
      const wasEdited = editedCells.has(key);
      const oldValue = wasEdited ? editedCells.get(key) : rows[rowIndex]?.[colName] ?? null;
      changes.push({ rowIndex, colName, oldValue, newValue: suggested, wasEdited });
    });
    if (changes.length === 0) return;
    setEditedCells((m) => {
      const next = new Map(m);
      changes.forEach(({ rowIndex, colName: c, newValue }) => next.set(`${rowIndex}::${c}`, newValue));
      return next;
    });
    pushUndo({ type: "bulk_suggest", changes });
  }

  // ── Mark all duplicate rows for deletion ────────────────────────────────
  function handleMarkDuplicatesForDeletion() {
    if (duplicateRowIndices.size === 0) return;
    setDeletedRows((s) => new Set([...s, ...duplicateRowIndices]));
    duplicateRowIndices.forEach((idx) => {
      pushUndo({ type: "row_delete", rowIndex: idx, row: rows[idx] ?? {} });
    });
  }

  // ── Cancel ───────────────────────────────────────────────────────────────
  function handleCancel() {
    if (isDirty && !window.confirm("Discard all unsaved changes?")) return;
    setRows(originalRows.current.map((r) => ({ ...r })));
    setColumns([...originalColumns.current]);
    columnRenames.current = new Map();
    setEditedCells(new Map());
    setDeletedRows(new Set());
    setInsertedRows(new Map());
    setSelectedRows(new Set());
    setUndoStack([]);
    setRedoStack([]);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setErrorMsg(null);
    try {
      // Build final records: base rows (excluding deleted) with edits applied, then inserted rows
      const records: Row[] = [];
      rows.forEach((row, idx) => {
        if (deletedRows.has(idx)) return;
        const merged: Row = { ...row };
        columns.forEach((col) => {
          const key = `${idx}::${col}`;
          if (editedCells.has(key)) merged[col] = editedCells.get(key);
        });
        records.push(merged);
      });
      insertedRows.forEach((row, idx) => {
        if (deletedRows.has(idx)) return;
        const merged: Row = { ...row };
        columns.forEach((col) => {
          const key = `${idx}::${col}`;
          if (editedCells.has(key)) merged[col] = editedCells.get(key);
        });
        records.push(merged);
      });

      await saveManualEdit(datasetId, { records, columns }, token);

      // Sync local state to exactly what was just persisted -- the "load on
      // mount" effect is keyed on [datasetId, token, totalRows], none of which
      // necessarily change after a save (e.g. adding a column or editing a cell
      // doesn't change row count), so it won't refire and pick up the new
      // baseline on its own.
      setRows(records.map((r) => ({ ...r })));
      originalRows.current = records.map((r) => ({ ...r }));
      originalColumns.current = [...columns];
      columnRenames.current = new Map();

      // Reset dirty state before reloading workspace
      setEditedCells(new Map());
      setDeletedRows(new Set());
      setInsertedRows(new Map());
      setSelectedRows(new Set());
      setUndoStack([]);
      setRedoStack([]);
      onSaved();
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Derived visible rows ─────────────────────────────────────────────────
  type VisibleRow = { realIndex: number; isInserted: boolean; isDeleted: boolean; data: Row };

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const result: VisibleRow[] = [];

    rows.forEach((row, idx) => {
      const merged: Row = { ...row };
      columns.forEach((col) => {
        const key = `${idx}::${col}`;
        if (editedCells.has(key)) merged[col] = editedCells.get(key);
      });
      result.push({ realIndex: idx, isInserted: false, isDeleted: deletedRows.has(idx), data: merged });
    });

    insertedRows.forEach((row, idx) => {
      const merged: Row = { ...row };
      columns.forEach((col) => {
        const key = `${idx}::${col}`;
        if (editedCells.has(key)) merged[col] = editedCells.get(key);
      });
      result.push({ realIndex: idx, isInserted: true, isDeleted: deletedRows.has(idx), data: merged });
    });

    // Apply search filter
    const q = debouncedSearch.toLowerCase();
    const filtered = q
      ? result.filter((r) => columns.some((col) => String(r.data[col] ?? "").toLowerCase().includes(q)))
      : result;

    // Apply sort
    if (sortConfig) {
      const { col, dir } = sortConfig;
      filtered.sort((a, b) => {
        const av = String(a.data[col] ?? "");
        const bv = String(b.data[col] ?? "");
        const n = av.localeCompare(bv, undefined, { numeric: true });
        return dir === "asc" ? n : -n;
      });
    }

    return filtered;
  }, [rows, columns, editedCells, deletedRows, insertedRows, debouncedSearch, sortConfig]);

  // ── Virtual scrolling ────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    measureElement: typeof window !== "undefined"
      ? (el) => el.getBoundingClientRect().height
      : undefined,
    overscan: 8,
  });

  // ── Select all ───────────────────────────────────────────────────────────
  const allVisibleIndices = visibleRows.map((r) => r.realIndex);
  const allSelected = allVisibleIndices.length > 0 && allVisibleIndices.every((i) => selectedRows.has(i));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(allVisibleIndices));
    }
  }

  function toggleSelectRow(realIndex: number) {
    setSelectedRows((s) => {
      const n = new Set(s);
      if (n.has(realIndex)) n.delete(realIndex); else n.add(realIndex);
      return n;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loadingRows) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-medium text-slate-700">
            Loading rows… {loadProgress.loaded.toLocaleString()} / {loadProgress.total.toLocaleString()}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: loadProgress.total > 0 ? `${(loadProgress.loaded / loadProgress.total) * 100}%` : "0%" }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">Editing will be available once all rows are loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Guidance banner */}
      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
        <p className="text-sm font-semibold text-sky-900">Manual Dataset Editor</p>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Click any cell to edit it. Double-click a column header to rename it. Use the toolbar to add rows, delete selected rows, and undo changes.{" "}
          <span className="text-slate-400">Saves create a new version — your history is preserved.</span>
        </p>
      </div>

      {suggestionsLoading && (
        <p className="text-xs text-slate-400 px-1">Loading suggested fixes…</p>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {pendingDraft && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <span className="font-semibold">You have unsaved edits from {new Date(pendingDraft.savedAt).toLocaleString()}.</span>{" "}
            Restore them or discard them to continue editing. (Undo history starts fresh.)
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Restore edits
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {isDirty && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>⚠</span>
          <span>You have unsaved changes. A backup is kept in this browser until you save or cancel.</span>
        </div>
      )}

      <DatasetHealthPanel
        totalRows={rows.length + insertedRows.size}
        totalCols={columns.length}
        missingValuesPerCol={missingValuesPerCol}
        duplicates={duplicateRowIndices.size}
        outlierCount={outlierCells.size}
        suggestionCount={pendingSuggestions.size}
        loading={suggestionsLoading}
      />

      {/* Locked until the user restores or discards a found draft, so new edits can't be silently replaced. */}
      <div inert={pendingDraft !== null} className={`space-y-3 ${pendingDraft ? "opacity-50" : ""}`}>
      <IssuesPanel
        issues={allIssues}
        fillPlans={pendingFillPlans}
        filledColumns={filledColumns}
        duplicates={duplicateRowIndices.size}
        duplicateRowCount={duplicateRowIndices.size}
        onFixMissingColumn={handleApplyColumnSuggestions}
        onMarkDuplicatesForDeletion={handleMarkDuplicatesForDeletion}
        loading={suggestionsLoading}
      />

      <EditToolbar
        columns={columns}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortConfig={sortConfig}
        setSortConfig={setSortConfig}
        onAddRow={handleAddRow}
        selectedRows={selectedRows}
        onDeleteSelected={handleDeleteSelected}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onApplyAllSuggestions={handleApplyAllSuggestions}
        suggestionCount={pendingSuggestions.size}
        isDirty={isDirty}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={saving}
      />

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Sticky header */}
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                {/* Checkbox column */}
                <th className="w-10 border-b border-slate-200 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                  />
                </th>
                {/* Row number */}
                <th className="w-12 border-b border-slate-200 px-3 py-3 text-left text-xs font-medium text-slate-400">#</th>
                {/* Data columns */}
                {columns.map((col) => (
                  <th
                    key={col}
                    className="group border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      {renamingCol === col ? (
                        <input
                          autoFocus
                          className="w-32 rounded border border-indigo-400 bg-white px-2 py-0.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-300"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setRenamingCol(null);
                          }}
                        />
                      ) : (
                        <span
                          onDoubleClick={() => { setRenamingCol(col); setRenameDraft(col); }}
                          title="Double-click to rename"
                          className="cursor-pointer hover:text-indigo-600 transition-colors"
                        >
                          {col}
                        </span>
                      )}
                      {renamingCol !== col && (
                        <button
                          onClick={() => handleDeleteColumn(col)}
                          title="Delete column"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 ml-0.5 leading-none"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {columnTypes[col] && <TypeBadge type={columnTypes[col]} />}
                      {(missingValuesPerCol[col] ?? 0) > 0 && (
                        <span className="text-[10px] font-medium text-red-500">
                          {missingValuesPerCol[col]} missing
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                {/* Add column */}
                <th className="border-b border-slate-200 px-3 py-2 text-left whitespace-nowrap">
                  {addingColumn ? (
                    <input
                      autoFocus
                      className="w-32 rounded border border-indigo-400 bg-white px-2 py-0.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-300"
                      placeholder="Column name…"
                      value={addColumnDraft}
                      onChange={(e) => setAddColumnDraft(e.target.value)}
                      onBlur={commitAddColumn}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitAddColumn();
                        if (e.key === "Escape") { setAddingColumn(false); setAddColumnDraft(""); }
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setAddingColumn(true)}
                      title="Add column"
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      + Add column
                    </button>
                  )}
                </th>
              </tr>
            </thead>
          </table>
        </div>

        {/* Virtualised body */}
        <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "520px" }}>
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const vRow = visibleRows[vItem.index];
              if (!vRow) return null;
              const { realIndex, isInserted, isDeleted, data } = vRow;
              const isSelected = selectedRows.has(realIndex);
              const isDuplicate = duplicateRowIndices.has(realIndex);

              let rowClass = "flex items-start border-b border-slate-100 transition-colors";
              if (isDeleted) rowClass += " opacity-40 line-through bg-red-50";
              else if (isSelected) rowClass += " bg-indigo-50/60";
              else if (isDuplicate) rowClass += " bg-amber-50/60";
              else rowClass += " hover:bg-slate-50/60";

              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: `${vItem.start}px`, left: 0, right: 0 }}
                >
                  <table className="min-w-full border-collapse">
                    <tbody>
                      <tr className={rowClass}>
                        {/* Checkbox */}
                        <td className="w-10 px-3 py-2 flex items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(realIndex)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                          />
                        </td>
                        {/* Row number */}
                        <td className="w-12 px-3 py-2 flex items-start text-xs text-slate-400 select-none">
                          {isInserted ? (
                            <span className="rounded bg-green-100 px-1 text-green-700 text-xs">new</span>
                          ) : (
                            realIndex + 1
                          )}
                          {isDuplicate && (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700 text-xs">dup</span>
                          )}
                        </td>
                        {/* Data cells */}
                        {columns.map((col) => {
                          const key = `${realIndex}::${col}`;
                          const cellVal = data[col];
                          const isMissing = cellVal === null || cellVal === undefined || cellVal === "";
                          const isDirtyCel = editedCells.has(key);
                          const suggestion = suggestions.get(key);
                          const isOutlier = outlierCells.has(key);

                          return (
                            <td
                              key={col}
                              className="min-w-30 max-w-65 border-r border-slate-100 last:border-r-0 p-0"
                            >
                              {!isDeleted && (
                                <EditableCell
                                  value={cellVal}
                                  rowIndex={realIndex}
                                  colName={col}
                                  isDirty={isDirtyCel}
                                  isMissing={isMissing}
                                  isDuplicate={isDuplicate}
                                  isOutlier={isOutlier}
                                  suggestion={suggestion}
                                  onCommit={handleCellCommit}
                                  onAcceptSuggestion={handleAcceptSuggestion}
                                />
                              )}
                              {isDeleted && (
                                <span className="px-3 py-2 text-sm text-slate-400">{String(cellVal ?? "")}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        {visibleRows.length === 0 && !loadingRows && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            {debouncedSearch ? "No rows match your search." : "No rows in this dataset."}
          </div>
        )}
      </div>
      </div>

      {/* Footer summary */}
      <p className="text-xs text-slate-400 px-1">
        {visibleRows.length.toLocaleString()} rows shown
        {debouncedSearch && ` (filtered from ${rows.length + insertedRows.size})`}
        {deletedRows.size > 0 && ` · ${deletedRows.size} marked for deletion`}
        {insertedRows.size > 0 && ` · ${insertedRows.size} new row${insertedRows.size > 1 ? "s" : ""}`}
        {editedCells.size > 0 && ` · ${editedCells.size} edited cell${editedCells.size > 1 ? "s" : ""}`}
      </p>
    </div>
  );
}
