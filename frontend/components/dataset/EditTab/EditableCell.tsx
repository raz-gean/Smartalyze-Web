"use client";

import { useRef, useState } from "react";
import { SuggestionBadge } from "./SuggestionBadge";

interface EditableCellProps {
  value: unknown;
  rowIndex: number;
  colName: string;
  isDirty: boolean;
  isMissing: boolean;
  isDuplicate: boolean;
  isOutlier: boolean;
  suggestion: unknown;
  onCommit: (rowIndex: number, colName: string, newValue: unknown) => void;
  onAcceptSuggestion: (rowIndex: number, colName: string, suggested: unknown) => void;
}

export function EditableCell({
  value,
  rowIndex,
  colName,
  isDirty,
  isMissing,
  isDuplicate,
  isOutlier,
  suggestion,
  onCommit,
  onAcceptSuggestion,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = value === null || value === undefined ? "" : String(value);

  function startEdit() {
    setDraft(displayValue);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const committed = trimmed === "" ? null : trimmed;
    if (committed !== value) {
      onCommit(rowIndex, colName, committed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }

  function handleAccept() {
    setEditing(false);
    onAcceptSuggestion(rowIndex, colName, suggestion);
  }

  const hasSuggestion = suggestion !== undefined && suggestion !== null;

  let cellClass = "relative w-full px-3 py-2 text-sm select-none cursor-pointer transition-colors";
  if (isMissing && !isDirty) cellClass += " bg-red-50";
  // Same look as outlier cells in Prepare's Data view.
  if (isOutlier && !isDirty) cellClass += " border-l-2 border-l-teal-300 bg-teal-50";
  if (isDirty) cellClass += " border-l-2 border-l-amber-400 bg-amber-50/40";

  if (editing) {
    return (
      <div className="relative px-1 py-1">
        <input
          ref={inputRef}
          className="w-full rounded border border-indigo-400 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-300"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        {hasSuggestion && (
          <SuggestionBadge suggested={suggestion} onAccept={handleAccept} />
        )}
      </div>
    );
  }

  return (
    <div
      className={cellClass}
      onClick={startEdit}
      title={
        isOutlier && !isDirty
          ? "Unusual value: far outside the typical range. It could be a rare real event or a typing mistake; check it before changing it. Click to edit."
          : "Click to edit"
      }
    >
      {isOutlier && !isDirty && (
        <span className="absolute right-1 top-0.5 rounded bg-teal-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-teal-700">
          unusual
        </span>
      )}
      {isMissing && !isDirty ? (
        <span className="text-slate-300 italic text-xs">
          {hasSuggestion ? `Suggested: ${String(suggestion)}` : "empty"}
        </span>
      ) : value === "" && !isDirty ? (
        <span className="font-mono text-xs text-slate-400">&quot;&quot;</span>
      ) : (
        <span className={isDirty ? "text-amber-800 font-medium" : isOutlier ? "text-teal-800 font-medium" : "text-slate-800"}>{displayValue}</span>
      )}
    </div>
  );
}
