"use client";

import { useEffect, useRef, useState } from "react";
import type { AIChatMessage } from "@/lib/api";
import { AIText } from "@/components/dataset/AIText";

export type AISummaryState = { status: "loading" | "done" | "error"; text?: string; error?: string };

export interface AskAIPanelProps {
  onClose: () => void;
  /** e.g. "Cleaning plan", "What your data shows". */
  summaryTitle: string;
  /** null = the current tab has no results to summarize yet. */
  summary: AISummaryState | null;
  /** Shown instead of a summary while the tab's results are still loading. */
  waitingHint: string;
  onRegenerate: () => void;
  chat: AIChatMessage[];
  chatLoading: boolean;
  chatError: string | null;
  canChat: boolean;
  onSend: (message: string) => void;
}

/**
 * One Ask AI assistant shared by every workspace tab. Narrow side panel on wide
 * screens, bottom sheet on smaller ones. State lives in the workspace page so the
 * summary and the conversation survive tab switches.
 */
export function AskAIPanel(props: AskAIPanelProps) {
  const { onClose, summaryTitle, summary, waitingHint, onRegenerate, chat, chatLoading, chatError, canChat, onSend } = props;
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length, chatLoading]);

  function send() {
    const msg = input.trim();
    if (!msg || chatLoading || !canChat) return;
    onSend(msg);
    setInput("");
  }

  return (
    <aside
      aria-label="Ask AI"
      // Fixed on every screen size so it never scrolls out of view: a bottom sheet on smaller
      // screens, a column docked to the right (below the 70px site header) on wide ones.
      className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl xl:inset-x-auto xl:bottom-4 xl:right-4 xl:top-21.5 xl:z-30 xl:h-auto xl:w-95 xl:rounded-2xl xl:shadow-lg"
    >
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Ask AI</p>
          <p className="text-xs text-slate-500">Same assistant on every tab</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Ask AI" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section aria-label={summaryTitle} className="rounded-xl bg-indigo-50/70 p-4">
          <div className="mb-2 flex items-center gap-2">
            <p className="flex-1 text-sm font-semibold text-indigo-800">{summaryTitle}</p>
            {summary && summary.status !== "loading" && (
              <button type="button" onClick={onRegenerate} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>
                Regenerate
              </button>
            )}
          </div>
          {!summary && <p className="text-sm text-slate-600">{waitingHint}</p>}
          {summary?.status === "loading" && (
            <p className="flex items-center gap-2 text-sm text-indigo-700">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
              Reading your results…
            </p>
          )}
          {summary?.status === "error" && (
            <p className="text-sm text-red-700">AI is unavailable right now. {summary.error} Try Regenerate in a moment.</p>
          )}
          {summary?.status === "done" && summary.text && <div className="text-slate-800"><AIText text={summary.text} /></div>}
          {summary?.status === "done" && (
            <p className="mt-3 text-xs text-slate-500">Made once for this version of your data while this page is open. It updates after you apply or save changes.</p>
          )}
        </section>

        {chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3 py-2 text-sm text-white">{m.content}</div>
          ) : (
            <div key={i} className="mr-auto max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-slate-800"><AIText text={m.content} /></div>
          ),
        )}
        {chatLoading && <div className="mr-auto rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm italic text-slate-500">Thinking…</div>}
        {chatError && <p className="text-center text-xs text-red-600">{chatError}</p>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 px-4 pb-4 pt-3">
        <label htmlFor="ask-ai-input" className="mb-1.5 block text-xs text-slate-500">Ask about your data</label>
        <div className="flex gap-2">
          <textarea
            id="ask-ai-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            disabled={!canChat}
            placeholder={canChat ? "e.g. Is the 950 sale a mistake?" : "Waiting for this tab's results…"}
            className="min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || chatLoading || !canChat}
            aria-label="Send question"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></svg>
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Only a summary of your data is sent, never the rows.</p>
      </div>
    </aside>
  );
}
