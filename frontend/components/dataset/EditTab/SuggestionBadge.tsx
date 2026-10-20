"use client";

interface SuggestionBadgeProps {
  suggested: unknown;
  onAccept: () => void;
}

export function SuggestionBadge({ suggested, onAccept }: SuggestionBadgeProps) {
  const display = suggested === null || suggested === undefined ? "(empty)" : String(suggested);
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      <span className="text-slate-400 italic">Suggested: {display}</span>
      <button
        type="button"
        className="rounded px-1.5 py-0.5 text-indigo-600 font-medium hover:bg-indigo-50 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          onAccept();
        }}
      >
        Accept
      </button>
    </div>
  );
}
