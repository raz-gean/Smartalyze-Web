// Which columns can be used as a time axis (Predict's "Date column"). Mirrors the backend
// rule in analysis_service._sort_by_time_column: at least 80% of the values must be dates.

const DATE_SHAPE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}$/;

function looksLikeDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return DATE_SHAPE.test(text) && !Number.isNaN(Date.parse(text));
}

/** Columns whose sampled values are mostly dates, plus any already typed as datetime. */
export function findDateColumns(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  datetimeColumns: string[] = [],
): string[] {
  return columns.filter((col) => {
    if (datetimeColumns.includes(col)) return true;
    const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
    if (values.length === 0) return false;
    return values.filter(looksLikeDate).length / values.length >= 0.8;
  });
}
