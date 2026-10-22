"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export type HelpTab = "overview" | "prepare" | "explore" | "detect" | "predict" | "edit";

type TabHelp = { heading: string; steps: ReactNode[] };

// Steps use the exact labels on each tab, so users can match the words to the screen.
const TAB_HELP: Record<HelpTab, TabHelp> = {
  overview: {
    heading: "Overview",
    steps: [
      <>The <strong>health score</strong> (0–100) sums up how clean your data is. 100 means no problems were found.</>,
      <><strong>Issues found</strong> lists what the automatic scan detected, such as empty cells or duplicate rows.</>,
      <>The <strong>data preview</strong> shows your first rows. Empty cells show as &ldquo;—&rdquo;.</>,
      <>Use the cards at the bottom to go to <strong>Prepare</strong> to fix problems, or to <strong>Explore</strong> and <strong>Detect</strong>.</>,
    ],
  },
  prepare: {
    heading: "Prepare your data",
    steps: [
      <>The <strong>Data</strong> view shows your table with problem cells highlighted, for example empty cells in red.</>,
      <>Switch to <strong>Clean</strong>. The recommended fixes are already ticked; untick any you don&apos;t want.</>,
      <>Click the <strong>Apply</strong> button at the bottom (for example &ldquo;Apply 4 Fixes&rdquo;) to preview the result. Nothing is saved yet.</>,
      <>If it looks right, click <strong>Save Result</strong> and choose to replace your dataset or save it as a new one.</>,
    ],
  },
  explore: {
    heading: "Explore your data",
    steps: [
      <><strong>Column Analysis</strong> shows statistics for every column. Click a row to see how its values are spread.</>,
      <><strong>Aggregation</strong>: pick one of the <strong>Suggested for your data</strong> cards, or choose a group, a number column and a function, then <strong>Generate result</strong>.</>,
      <><strong>Trends</strong> shows whether a number column goes up or down from the first row to the last, using a straight trend line (linear regression).</>,
    ],
  },
  detect: {
    heading: "Detect unusual values and relationships",
    steps: [
      <><strong>Anomaly Detection</strong> marks unusual values in each number column using the IQR rule: below Q1 − 1.5 × IQR or above Q3 + 1.5 × IQR.</>,
      <>An unusual value can be a real rare event or a typing mistake. Check it before changing it; Prepare can turn it into an empty cell.</>,
      <><strong>Correlation</strong> shows which number columns move together, from −1 (opposite) to +1 (together). Near 0 means no straight-line relationship.</>,
    ],
  },
  predict: {
    heading: "Predict future values",
    steps: [
      <>Optional: pick a <strong>Date column</strong> to forecast by date, for example the next months. Without one, rows are used in their current order.</>,
      <>Choose the <strong>Column to forecast</strong> and how many <strong>Steps ahead</strong>, then click <strong>Run prediction</strong>.</>,
      <>The forecast follows a straight trend line (linear regression). The <strong>likely range (95%)</strong> is where the real value should land 95 times out of 100.</>,
      <>The confidence badge shows how well the line fits your data. Forecasts work best with 20 or more rows.</>,
    ],
  },
  edit: {
    heading: "Edit your data",
    steps: [
      <>Click any cell to change it. Double-click a column header to rename it.</>,
      <>Empty cells show a suggested value. <strong>Apply all suggested fixes</strong> fills them all; you can undo it.</>,
      <>Use the toolbar to add or delete rows, and <strong>Undo</strong> / <strong>Redo</strong> (Ctrl+Z / Ctrl+Y).</>,
      <>Click <strong>Save</strong> to keep your changes as a new version. Unsaved edits stay in this browser until you save or cancel.</>,
    ],
  },
};

const SEEN_KEY = "smartalyze:help-seen";

function readSeen(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function markSeen(tab: HelpTab) {
  try {
    const seen = readSeen();
    if (!seen.includes(tab)) window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, tab]));
  } catch {
    // storage unavailable: the guide just opens again next time
  }
}

/**
 * The tab's heading with a "How to use this page" button. The steps open on click (hover only
 * shows the label) and open by themselves the first time each tab is shown in this browser.
 * Render it with `key={tab}` so each tab starts with its own first-visit check.
 * It only renders after the workspace has loaded in the browser, so reading storage is safe.
 */
export function WorkspaceHelp({ tab }: { tab: HelpTab }) {
  const help = TAB_HELP[tab];
  // First visit to a tab: show the steps once, without moving the user's focus.
  const [open, setOpen] = useState(() => !readSeen().includes(tab));
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gotItRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    markSeen(tab);
  }, [tab]);

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      gotItRef.current?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const hadFocus = containerRef.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (hadFocus) buttonRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function toggle() {
    focusOnOpen.current = !open;
    setOpen(!open);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative mb-5 flex items-center gap-2">
      <h2 className="text-lg font-semibold text-slate-950">{help.heading}</h2>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="How to use this page"
        title="How to use this page"
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-indigo-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          open ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:bg-indigo-50"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      <span className="hidden text-sm text-slate-500 sm:inline">How to use this page</span>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="absolute left-0 top-11 z-20 w-90 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/70"
        >
          <p id={titleId} className="text-sm font-semibold text-slate-950">How to use {help.heading.split(" ")[0]}</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
            {help.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">Opens by itself on your first visit.</span>
            <button
              ref={gotItRef}
              type="button"
              onClick={close}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
