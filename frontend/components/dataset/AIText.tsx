"use client";

import type { ReactNode } from "react";

// Renders the small subset of markdown the AI is told to use (**bold**, numbered and
// bullet lists, paragraphs) as plain React elements. Never injects HTML.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      // *single-asterisk emphasis* and stray markers: keep the words, drop the asterisks
      : part.replace(/\*+/g, ""),
  );
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "ol" | "ul"; items: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    // "**1. Step** text" (a bolded list number) is still a numbered list item.
    const line = raw.trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*(\d+[.)])\s+/, "$1 **");
    if (!line) continue;
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const bulleted = line.match(/^[-*•]\s+(.*)$/);
    const kind = numbered ? "ol" : bulleted ? "ul" : "p";
    const content = numbered?.[1] ?? bulleted?.[1] ?? line;
    const last = blocks[blocks.length - 1];
    if (kind !== "p" && last && last.kind === kind) last.items.push(content);
    else if (kind === "p") blocks.push({ kind, text: content });
    else blocks.push({ kind, items: [content] });
  }
  return blocks;
}

export function AIText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {toBlocks(text).map((b, i) => {
        if (b.kind === "p") return <p key={i}>{inline(b.text)}</p>;
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
        return b.kind === "ol"
          ? <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol>
          : <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>;
      })}
    </div>
  );
}
