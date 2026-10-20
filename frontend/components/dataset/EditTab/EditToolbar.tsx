"use client";

interface SortConfig {
  col: string;
  dir: "asc" | "desc";
}

interface EditToolbarProps {
  columns: string[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  sortConfig: SortConfig | null;
  setSortConfig: (v: SortConfig | null) => void;
  onAddRow: () => void;
  selectedRows: Set<number>;
  onDeleteSelected: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onApplyAllSuggestions: () => void;
  suggestionCount: number;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

export function EditToolbar({
  columns,
  searchQuery,
  setSearchQuery,
  sortConfig,
  setSortConfig,
  onAddRow,
  selectedRows,
  onDeleteSelected,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onApplyAllSuggestions,
  suggestionCount,
  isDirty,
  onSave,
  onCancel,
  saving,
}: EditToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {/* Search */}
      <input
        type="text"
        placeholder="Search rows…"
        className="h-8 w-44 rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* Sort */}
      <select
        className="h-8 rounded-xl border border-slate-300 bg-slate-50 px-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none"
        value={sortConfig?.col ?? ""}
        onChange={(e) => {
          const col = e.target.value;
          if (!col) { setSortConfig(null); return; }
          setSortConfig({ col, dir: sortConfig?.dir ?? "asc" });
        }}
      >
        <option value="">Sort by…</option>
        {columns.map((c, i) => <option key={`${i}-${c}`} value={c}>{c}</option>)}
      </select>

      {sortConfig && (
        <button
          type="button"
          className="h-8 rounded-xl border border-slate-300 bg-slate-50 px-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
          onClick={() => setSortConfig({ col: sortConfig.col, dir: sortConfig.dir === "asc" ? "desc" : "asc" })}
          title="Toggle sort direction"
        >
          {sortConfig.dir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
      )}

      <div className="h-6 w-px bg-slate-200" />

      {/* Row actions */}
      <button
        type="button"
        className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        onClick={onAddRow}
      >
        <span className="text-base leading-none">+</span> Add row
      </button>

      {selectedRows.size > 0 && (
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
          onClick={onDeleteSelected}
        >
          Delete selected ({selectedRows.size})
        </button>
      )}

      {suggestionCount > 0 && (
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
          onClick={onApplyAllSuggestions}
        >
          Apply all suggested fixes ({suggestionCount})
        </button>
      )}

      <div className="h-6 w-px bg-slate-200" />

      {/* Undo / Redo */}
      <button
        type="button"
        className="h-8 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        ↩ Undo
      </button>
      <button
        type="button"
        className="h-8 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
      >
        ↪ Redo
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="h-8 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="h-8 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50 hover:bg-indigo-500 transition-colors"
          onClick={onSave}
          disabled={!isDirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
