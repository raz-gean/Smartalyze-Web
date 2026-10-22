// The dataset health score shown on the dashboard cards and the Overview tab.
// One formula, so the same dataset always gets the same score everywhere.

export type HealthScore = {
  score: number;
  label: "Great" | "Good" | "Fair" | "Needs Work";
  color: string;
  badgeClasses: string;
  missingDed: number;
  dupDed: number;
  typeDed: number;
  pseudoDed: number;
  variantDed: number;
  outlierDed: number;
};

/**
 * 100 minus capped deductions for missing cells, duplicate rows, and columns with type
 * problems, disguised blanks, spelling variants or outliers (counts saved by the data scan).
 */
export function computeHealthScore(
  summary: Record<string, unknown> | null | undefined,
  rowCount: number,
  colCount: number,
): HealthScore {
  const s = summary ?? {};
  const missing = Number(s.missing_cells ?? 0);
  const dups = Number(s.duplicate_rows ?? 0);
  const totalCells = rowCount * (colCount || 1) || 1;

  const missingDed = Math.min(30, Math.round((missing / totalCells) * 150));
  const dupDed     = Math.min(20, Math.round((rowCount > 0 ? dups / rowCount : 0) * 200));
  const typeDed    = Math.min(15, Number(s.type_issue_columns ?? 0) * 5);
  const pseudoDed  = Math.min(10, Number(s.pseudo_null_columns ?? 0) * 3);
  const variantDed = Math.min(10, Number(s.variant_columns ?? 0) * 3);
  const outlierDed = Math.min(5,  Number(s.outlier_columns ?? 0) * 2);

  const score = Math.max(0, 100 - missingDed - dupDed - typeDed - pseudoDed - variantDed - outlierDed);
  const label = score >= 85 ? "Great" : score >= 65 ? "Good" : score >= 45 ? "Fair" : "Needs Work";
  const color = score >= 85 ? "#22c55e" : score >= 65 ? "#14b8a6" : score >= 45 ? "#f59e0b" : "#ef4444";
  const badgeClasses = score >= 85 ? "bg-green-100 text-green-700"
                     : score >= 65 ? "bg-teal-100 text-teal-700"
                     : score >= 45 ? "bg-amber-100 text-amber-700"
                     : "bg-red-100 text-red-700";
  return { score, label, color, badgeClasses, missingDed, dupDed, typeDed, pseudoDed, variantDed, outlierDed };
}
