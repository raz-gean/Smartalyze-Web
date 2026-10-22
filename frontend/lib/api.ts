// Set NEXT_PUBLIC_API_BASE_URL in .env.local to override for production.
declare const process: { env: Record<string, string | undefined> };
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type AuthUser = {
  id: number;
  username: string;
  created_at: string;
  avatar?: string | null;
};

export type AuthResponse = {
  message: string;
  token: string;
  user: AuthUser;
};

export type Dataset = {
  id: number;
  owner_user_id: number;
  original_filename: string;
  stored_filename: string;
  file_path: string;
  mime_type: string | null;
  file_format: "csv" | "excel" | "json" | "image";
  description: string | null;
  size_bytes: number;
  row_count: number | null;
  column_count: number | null;
  columns_json: Array<Record<string, unknown>> | null;
  preview_json: Array<Record<string, unknown>> | null;
  summary_json: Record<string, unknown> | null;
  current_version_id?: number | null;
  created_at: string;
};

export type DatasetVersion = {
  id: number;
  dataset_id: number;
  version_number: number;
  operation_type: string;
  artifact_path: string;
  artifact_filename: string;
  row_count: number | null;
  column_count: number | null;
  preview_json: Array<Record<string, unknown>> | null;
  columns_json: Array<Record<string, unknown>> | null;
  summary_json: Record<string, unknown> | null;
  created_at: string;
};

export type DatasetVersionSummary = {
  id: number;
  dataset_id: number;
  version_number: number;
  operation_type: string;
  created_at: string;
  row_count: number | null;
  column_count: number | null;
  missing_cells: number | null;
  duplicate_rows: number | null;
  is_current: boolean;
};

export type DatasetVersionDetail = DatasetVersionSummary & {
  data_snapshot: Record<string, unknown>;
};

export type RestoreVersionResponse = {
  message: string;
  restored_version_id: number;
  new_version: DatasetVersionSummary;
  dataset: Dataset;
};

export type DatasetWorkspace = {
  dataset: Dataset;
  warnings: Array<{ scope: string; severity: string; message: string }>;
  suggestions: Array<{ scope: string; message: string }>;
};

export type DeleteDatasetResponse = {
  message: string;
};

export type RenameDatasetResponse = {
  message: string;
  dataset: Dataset;
};

export type ExportDatasetFormat = "csv" | "xlsx" | "json" | "parquet";

export type ExportDatasetRequest = {
  format: ExportDatasetFormat;
  data_snapshot?: Record<string, unknown> | null;
};

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "is_null"
  | "not_null"
  | "in"
  | "between";

export type FilterPredicate = {
  column: string;
  op: FilterOp;
  value?: unknown;
  values?: unknown[];
  lower?: unknown;
  upper?: unknown;
  case_sensitive?: boolean;
};

export type FilterRequest = {
  predicates: FilterPredicate[];
  combine?: "and" | "or";
  offset?: number;
  limit?: number;
  data_snapshot?: Record<string, unknown> | null;
};

export type FilterResponse = {
  rows: Record<string, unknown>[];
  total_matched: number;
  total_rows: number;
  offset: number;
  limit: number;
};

export type CleaningIssue = {
  kind: string;
  severity: "info" | "warning" | "error";
  column: string | null;
  message: string;
  suggestion: string | null;
  details: Record<string, unknown> | null;
};

export type DateOutputFormat = "iso" | "us" | "eu";
export type DayFirstHint = "auto" | "day" | "month";
export type UnparseableAction = "keep_original" | "null";

export type CleaningOperation = {
  operation_type:
    | "fill_mean"
    | "fill_median"
    | "fill_mode"
    | "drop_rows"
    | "remove_all_duplicates"
    | "convert_column_type"
    | "trim_whitespace"
    | "lowercase_column"
    | "standardize_dates"
    | "sort_values"
    | "fill_pattern"
    | "derive_column"
    | "standardize_categories"
    | "replace_with_missing"
    | "remove_outliers"
    | "nullify_outliers";
  columns?: string[];
  column?: string | null;
  target_type?: "numeric" | "string" | "datetime" | "categorical" | "boolean" | null;
  drop_all_missing?: boolean;
  errors?: "raise" | "coerce" | "ignore";
  output_format?: DateOutputFormat | null;
  dayfirst_hint?: DayFirstHint;
  unparseable_action?: UnparseableAction;
  ascending?: boolean | null;
  key_column?: string | null;
  target_column_fill?: string | null;
  new_column_name?: string | null;
  expression?: string | null;
  value_mapping?: Record<string, string> | null;
  missing_tokens?: string[] | null;
};

export type UnparseableDateRow = { row: number; original: string };

export type PatternImputationGroup = {
  key_value: string;
  fill_value: string | number | null;
  confidence: number;
  support_count: number;
  fillable_count: number;
  consistency_ratio: number;
  explanation: string;
};

export type PatternImputationResult = {
  target_column: string;
  key_column: string;
  weighted_confidence: number;
  groups: PatternImputationGroup[];
  low_sample_groups: string[];
};

export type CategoryVariantGroup = {
  canonical: string;
  variants: string[];
  counts: Record<string, number>;
};

export type CategoryStandardizationSuggestion = {
  column: string;
  groups: CategoryVariantGroup[];
};

export type PseudoNullSummary = {
  column: string;
  tokens: Record<string, number>;
  total: number;
};

export type OutlierColumnSummary = {
  column: string;
  outlier_count: number;
  lower_fence: number;
  upper_fence: number;
  sample_values: Array<number | string>;
};

export type CorrelationMethod = "pearson" | "spearman";

export type CorrelationResponse = {
  columns: string[];
  matrix: Record<string, Record<string, number>>;
  method: CorrelationMethod;
  total_columns: number;
};

export type StructureColumnSummary = {
  name: string;
  kind: string;
  missing_values: number;
  unique_values: number;
  top_values: TopValue[];
  mean?: number | null;
  min?: number | null;
  max?: number | null;
};

// A suggested Aggregation setup; strength is η² (share of the number column's variation
// explained by the groups), null for a row count.
export type GroupingSuggestion = {
  group_by: string;
  aggregate_column: string;
  aggregate_func: "mean" | "count" | "sum" | "min" | "max";
  title: string;
  reason: string;
  strength: number | null;
  strength_label: "strong" | "moderate" | null;
};

export type StructureSummaryResponse = {
  row_count: number;
  column_count: number;
  missing_cells: number;
  duplicate_rows: number;
  columns: StructureColumnSummary[];
  grouping_suggestions?: GroupingSuggestion[];
};

export type CleanDetectResponse = {
  dataset_id: number;
  dataset_version_id: number;
  missing_values: Record<string, number>;
  duplicates: number;
  column_types: Record<string, string>;
  issues: CleaningIssue[];
  pattern_suggestions: PatternImputationResult[];
  category_suggestions?: CategoryStandardizationSuggestion[];
  pseudo_nulls?: PseudoNullSummary[];
  outliers?: OutlierColumnSummary[];
  summary?: Record<string, unknown> | null; // version summary incl. the issue counts this scan saved
};

export type CleanApplyResponse = CleanDetectResponse & {
  source_version_id: number;
  operations_applied: CleaningOperation[];
  preview: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  data_snapshot: Record<string, unknown>;
};

export type TopValue = { value: unknown; count: number };

export type ColumnStat = {
  name: string;
  dtype: "numeric" | "text" | "datetime" | "boolean";
  count: number;
  missing: number;
  missing_pct: number;
  unique: number;
  top_values: TopValue[];
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  min?: number | null;
  max?: number | null;
  q25?: number | null;
  q75?: number | null;
};

export type AnalyzeStatsResponse = {
  column_stats: ColumnStat[];
  row_count: number;
  col_count: number;
};

export type DistributionKind = "numeric" | "categorical" | "datetime" | "boolean" | "empty";

export type DistributionBin = {
  label: string;
  count: number;
  bin_start: number | null;
  bin_end: number | null;
};

export type DistributionResponse = {
  column: string;
  kind: DistributionKind;
  bins: DistributionBin[];
  total_count: number;
  missing_count: number;
  unique_count: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
};

export type GroupResult = { group: string; value: number };

export type GroupByResponse = {
  group_by: string;
  aggregate_column: string;
  aggregate_func: string;
  results: GroupResult[];
  total_groups: number;
};

export type ChartPoint = { x: number; y: number };

export type ColumnTrendResult = {
  column: string;
  direction: "increasing" | "decreasing" | "stable" | "volatile";
  slope: number;
  r_squared: number;
  min: number;
  max: number;
  mean: number;
  count: number;
  chart_points: ChartPoint[];
  trend_line: ChartPoint[];
};

export type TrendResponse = { columns: ColumnTrendResult[] };

export type ColumnAnomalyResult = {
  column: string;
  outlier_count: number;
  total_count: number;
  outlier_pct: number;
  lower_fence: number;
  upper_fence: number;
  sample_outliers: unknown[];
};

export type AnomalyResponse = {
  total_flagged_rows: number;
  columns_analyzed: number;
  columns: ColumnAnomalyResult[];
};

export type PredictPoint = {
  step: number;
  predicted_value: number;
  lower_bound: number;
  upper_bound: number;
  label?: string | null; // forecast date (YYYY-MM-DD) when a date column is used
};

export type PredictResponse = {
  input_column: string;
  target_column: string;
  future_steps: number;
  slope: number; // per day when time_column is set, otherwise per row
  intercept: number;
  r_squared: number;
  predictions: PredictPoint[];
  time_column?: string | null;
  interval_level?: number | null; // 0.95 = bounds are a 95% prediction interval; null = too little data for a range
};

export type SaveResultRequest = {
  replace_current: boolean;
  dataset_name?: string | null;
  description?: string | null;
  data_snapshot?: Record<string, unknown> | null;
};

export type SaveResultResponse = {
  message: string;
  dataset: Dataset;
};

const REQUEST_TIMEOUT_MS = 15000;

// Note: `fetch()` throws a TypeError for network-level failures (backend down, CORS blocked, DNS, etc.).
// We map that to a friendlier message so UI toasts are actionable.

async function request<T>(path: string, options?: RequestInit, token?: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.detail ?? "Request failed.");
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }

    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach the API at ${API_BASE_URL}. Make sure the backend is running and CORS allows your frontend origin.`,
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function registerUser(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function loginUser(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function getCurrentUser(token: string): Promise<AuthUser> {
  return request<AuthUser>("/me", {}, token);
}

export function listDatasets(token: string): Promise<Dataset[]> {
  return request<Dataset[]>("/datasets", {}, token);
}

export function getDatasetWorkspace(datasetId: number, token: string): Promise<DatasetWorkspace> {
  return request<DatasetWorkspace>(`/dataset/${datasetId}`, {}, token);
}

export function deleteDataset(datasetId: number, token: string): Promise<DeleteDatasetResponse> {
  return request<DeleteDatasetResponse>(
    `/dataset/${datasetId}`,
    {
      method: "DELETE",
    },
    token,
  );
}

export function renameDataset(datasetId: number, name: string, token: string): Promise<RenameDatasetResponse> {
  return request<RenameDatasetResponse>(
    `/dataset/${datasetId}/rename`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    token,
  );
}

function parseFilenameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const match = /filename\*=UTF-8''([^;]+)|filename="?([^;"]+)"?/i.exec(headerValue);
  const value = match?.[1] ?? match?.[2] ?? null;
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function exportDataset(
  datasetId: number,
  payload: ExportDatasetRequest,
  token: string,
): Promise<{ blob: Blob; filename: string }>
{
  // Export returns a Blob (not JSON), so we bypass the generic request<T>() helper.
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/dataset/${datasetId}/export`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(errorBody?.detail ?? "Export failed.");
    }

    const blob = await response.blob();
    const headerFilename = parseFilenameFromContentDisposition(response.headers.get("content-disposition"));
    const fallbackFilename = `dataset-${datasetId}.${payload.format}`;
    return { blob, filename: headerFilename ?? fallbackFilename };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }

    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach the API at ${API_BASE_URL}. Make sure the backend is running and CORS allows your frontend origin.`,
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function createDatasetVersion(
  datasetId: number,
  payload: { operation_type: string; replace_current?: boolean; data_snapshot?: Record<string, unknown> | null },
  token: string,
): Promise<DatasetVersion> {
  return request<DatasetVersion>(
    `/dataset/${datasetId}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export function detectCleaningIssues(
  datasetId: number,
  token: string,
  datasetVersionId?: number | null,
): Promise<CleanDetectResponse> {
  return request<CleanDetectResponse>(
    "/clean/detect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null }),
    },
    token,
  );
}

export function applyCleaningOperations(
  datasetId: number,
  cleaningOperations: CleaningOperation[],
  token: string,
  datasetVersionId?: number | null,
): Promise<CleanApplyResponse> {
  return request<CleanApplyResponse>(
    "/clean/apply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null, cleaning_operations: cleaningOperations }),
    },
    token,
  );
}

export function saveDatasetResult(datasetId: number, payload: SaveResultRequest, token: string): Promise<SaveResultResponse> {
  return request<SaveResultResponse>(
    `/dataset/${datasetId}/result`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export function analyzeStats(
  datasetId: number,
  token: string,
  datasetVersionId?: number | null,
): Promise<AnalyzeStatsResponse> {
  return request<AnalyzeStatsResponse>(
    "/analysis/stats",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null }),
    },
    token,
  );
}

export function groupDataset(
  datasetId: number,
  payload: { group_by: string; aggregate_column: string; aggregate_func: string; dataset_version_id?: number | null },
  token: string,
): Promise<GroupByResponse> {
  return request<GroupByResponse>(
    "/analysis/group",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, ...payload }),
    },
    token,
  );
}

export function updateUsername(token: string, newUsername: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/me/username", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_username: newUsername, password }),
  }, token);
}

export function updatePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  return request<void>("/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }, token);
}

export function updateAvatar(token: string, avatar: string | null): Promise<AuthUser> {
  return request<AuthUser>("/me/avatar", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatar }),
  }, token);
}

export function deleteAccount(token: string, password: string): Promise<void> {
  return request<void>("/me", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }, token);
}

export function getTrends(datasetId: number, token: string, datasetVersionId?: number | null): Promise<TrendResponse> {
  return request<TrendResponse>("/analysis/trend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null }),
  }, token);
}

export function getAnomalies(datasetId: number, token: string, datasetVersionId?: number | null): Promise<AnomalyResponse> {
  return request<AnomalyResponse>("/analysis/anomaly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null }),
  }, token);
}

export function predictDataset(
  datasetId: number,
  payload: { input_column: string; target_column: string; future_steps: number; time_column?: string | null; dataset_version_id?: number | null },
  token: string,
): Promise<PredictResponse> {
  return request<PredictResponse>("/analysis/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, ...payload }),
  }, token);
}

export function getDatasetRows(
  datasetId: number,
  offset: number,
  limit: number,
  token: string,
): Promise<{ rows: Record<string, unknown>[]; total: number; offset: number; limit: number }> {
  return request(`/dataset/${datasetId}/rows?offset=${offset}&limit=${limit}`, {}, token);
}

export function filterDatasetRows(
  datasetId: number,
  payload: FilterRequest,
  token: string,
): Promise<FilterResponse> {
  return request<FilterResponse>(
    `/dataset/${datasetId}/filter`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export function getCorrelation(
  datasetId: number,
  token: string,
  datasetVersionId?: number | null,
  method: CorrelationMethod = "pearson",
): Promise<CorrelationResponse> {
  return request<CorrelationResponse>("/analysis/correlation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, dataset_version_id: datasetVersionId ?? null, method }),
  }, token);
}

export function getStructureSummary(
  datasetId: number,
  token: string,
): Promise<StructureSummaryResponse> {
  return request<StructureSummaryResponse>(`/dataset/${datasetId}/structure/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId }),
  }, token);
}

export function getDistribution(
  datasetId: number,
  column: string,
  token: string,
  options?: { datasetVersionId?: number | null; bins?: number },
): Promise<DistributionResponse> {
  return request<DistributionResponse>(
    "/analysis/distribution",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: datasetId,
        column,
        dataset_version_id: options?.datasetVersionId ?? null,
        bins: options?.bins ?? 20,
      }),
    },
    token,
  );
}

export function listDatasetVersions(datasetId: number, token: string): Promise<DatasetVersionSummary[]> {
  return request<DatasetVersionSummary[]>(`/dataset/${datasetId}/versions`, {}, token);
}

export function getDatasetVersion(
  datasetId: number,
  versionId: number,
  token: string,
): Promise<DatasetVersionDetail> {
  return request<DatasetVersionDetail>(`/dataset/${datasetId}/versions/${versionId}`, {}, token);
}

export function restoreDatasetVersion(
  datasetId: number,
  versionId: number,
  token: string,
): Promise<RestoreVersionResponse> {
  return request<RestoreVersionResponse>(
    `/dataset/${datasetId}/versions/${versionId}/restore`,
    { method: "POST" },
    token,
  );
}

export type ManualEditRequest = {
  records: Record<string, unknown>[];
  columns: string[];
};

export type ManualEditResponse = {
  version_id: number;
  version_number: number;
  row_count: number;
  column_count: number;
};

export function saveManualEdit(
  datasetId: number,
  body: ManualEditRequest,
  token: string,
): Promise<ManualEditResponse> {
  return request<ManualEditResponse>(
    `/dataset/${datasetId}/manual-edit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    token,
  );
}

// Upload uses XMLHttpRequest (not fetch) because fetch has no cross-browser way to
// report upload progress; XHR's `upload.onprogress` gives real byte-level progress
// for the dashboard's upload progress bar.
export function uploadDataset(
  file: File,
  description: string,
  token?: string,
  onProgress?: (fraction: number) => void,
): Promise<{ message: string; dataset: Dataset }> {
  const formData = new FormData();
  formData.append("file", file);
  if (description.trim()) {
    formData.append("description", description.trim());
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/upload`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON response body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as { message: string; dataset: Dataset });
      } else {
        const detail = (body as { detail?: string } | null)?.detail;
        reject(new Error(detail ?? "Upload failed."));
      }
    };

    xhr.onerror = () => {
      reject(new Error(`Could not reach the API at ${API_BASE_URL}. Make sure the backend is running and CORS allows your frontend origin.`));
    };

    xhr.send(formData);
  });
}

// --- AI Advisor ---

export type AIContext = {
  dataset_name: string;
  row_count?: number | null;
  column_types: Record<string, string>;
  missing_values: Record<string, number>;
  duplicates: number;
  issues: Array<Record<string, unknown>>;
  pattern_suggestions: Array<Record<string, unknown>>;
  outliers: Array<Record<string, unknown>>;
};

export type AIChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AISuggestResponse = {
  suggestion: string;
};

export type AIChatResponse = {
  reply: string;
};

const AI_TIMEOUT_MS = 90_000;

export function getAISuggestion(context: AIContext, token: string): Promise<AISuggestResponse> {
  return request<AISuggestResponse>(
    "/ai/suggest",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    },
    token,
    AI_TIMEOUT_MS,
  );
}

export function sendAIChat(
  context: AIContext,
  message: string,
  history: AIChatMessage[],
  token: string,
): Promise<AIChatResponse> {
  return request<AIChatResponse>(
    "/ai/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, message, history }),
    },
    token,
    AI_TIMEOUT_MS,
  );
}

export type AIAnalyzeContext = {
  dataset_name: string;
  row_count: number;
  col_count: number;
  column_stats: Array<{
    name: string;
    dtype: string;
    missing_pct: number;
    mean?: number | null;
    min?: number | null;
    max?: number | null;
    std?: number | null;
  }>;
  trends: Array<{
    column: string;
    direction: string;
    slope: number;
    r_squared: number;
  }>;
  anomalies: Array<{
    column: string;
    outlier_count: number;
    outlier_pct: number;
    lower_fence: number;
    upper_fence: number;
  }>;
  top_correlations: Array<{
    col_a: string;
    col_b: string;
    r: number;
  }>;
  suggested_groupings?: string[]; // Explore > Aggregation suggestions, "title: reason"
};

export type AIAnalyzeResponse = {
  insight: string;
};

export function getAIInsight(
  context: AIAnalyzeContext,
  token: string,
): Promise<AIAnalyzeResponse> {
  return request<AIAnalyzeResponse>(
    "/ai/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    },
    token,
    AI_TIMEOUT_MS,
  );
}

export function sendAIAnalyzeChat(
  context: AIAnalyzeContext,
  message: string,
  history: AIChatMessage[],
  token: string,
): Promise<AIChatResponse> {
  return request<AIChatResponse>(
    "/ai/analyze/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, message, history }),
    },
    token,
    AI_TIMEOUT_MS,
  );
}
