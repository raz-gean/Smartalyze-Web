// Small display helpers shared by the workspace tabs.

/** Short, readable number for chart axes: at most 2 decimals, "12.5K" style for large values. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 10_000) {
    return value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "1 missing value" / "3 missing values": count plus the right word form. */
export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : pluralWord}`;
}
