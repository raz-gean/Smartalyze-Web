// Rows read back from the database don't keep the user's column order (PostgreSQL JSONB
// reorders object keys), so tables must order columns by the dataset's column list.

/** `keys` ordered by `reference` first; keys missing from `reference` (e.g. new columns) go last. */
export function orderColumns(keys: string[], reference: string[]): string[] {
  const present = new Set(keys);
  const ordered = reference.filter((name) => present.has(name));
  const placed = new Set(ordered);
  return [...ordered, ...keys.filter((key) => !placed.has(key))];
}

/** Column names from a dataset's `columns_json`, in the user's order. */
export function columnNames(columnsJson: Array<Record<string, unknown>> | null | undefined): string[] {
  return (columnsJson ?? []).map((c) => String(c.name ?? "")).filter(Boolean);
}
