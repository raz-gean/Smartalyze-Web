from __future__ import annotations

"""Cleaning API schemas (Pydantic).

The frontend uses these to:
- request a cleaning detection run
- submit a list of cleaning operations to apply
- receive a cleaned snapshot + summary back
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

# Supported cleaning operations. Add new operation types here and handle them in
# `app/services/cleaning_service.py::_apply_operation`.
CleaningOperationType = Literal[
    "fill_mean",
    "fill_median",
    "fill_mode",
    "drop_rows",
    "remove_all_duplicates",
    "convert_column_type",
    "trim_whitespace",
    "lowercase_column",
    "standardize_dates",
    "sort_values",
    "fill_pattern",
    "derive_column",
    "standardize_categories",
    "replace_with_missing",
    "remove_outliers",
    "nullify_outliers",
]

CleaningTargetType = Literal["numeric", "string", "datetime", "categorical", "boolean"]

DateOutputFormat = Literal["iso", "us", "eu"]
DayFirstHint = Literal["auto", "day", "month"]
UnparseableAction = Literal["keep_original", "null"]


class CleaningIssue(BaseModel):
    """A single detected issue (missing values, duplicates, type inconsistency, etc.)."""
    kind: str
    severity: Literal["info", "warning", "error"] = "warning"
    column: str | None = None
    message: str
    suggestion: str | None = None
    details: dict[str, Any] | None = None


class CleaningOperation(BaseModel):
    """An operation request from the client (e.g., fill mean, drop rows, convert type)."""
    operation_type: CleaningOperationType
    columns: list[str] = Field(default_factory=list)
    column: str | None = None
    target_type: CleaningTargetType | None = None
    drop_all_missing: bool = True
    errors: Literal["raise", "coerce", "ignore"] = "coerce"
    # Fields below only apply to operation_type == "standardize_dates".
    output_format: DateOutputFormat | None = None
    dayfirst_hint: DayFirstHint = "auto"
    unparseable_action: UnparseableAction = "keep_original"
    # Field below only applies to operation_type == "sort_values".
    ascending: bool = True
    # Fields below only apply to operation_type == "fill_pattern".
    key_column: str | None = None
    target_column_fill: str | None = None
    # Fields below only apply to operation_type == "derive_column".
    new_column_name: str | None = None
    expression: str | None = None
    # Field below only applies to operation_type == "standardize_categories"
    # (maps an original value -> canonical value; unlisted values are left untouched).
    value_mapping: dict[str, str] | None = None
    # Field below only applies to operation_type == "replace_with_missing"
    # (tokens to convert to null; defaults to the curated pseudo-null dictionary when omitted).
    missing_tokens: list[str] | None = None


class PatternImputationGroup(BaseModel):
    key_value: str
    fill_value: str | float | None
    confidence: float
    support_count: int
    fillable_count: int
    consistency_ratio: float = 0.0
    explanation: str = ""


class PatternImputationResult(BaseModel):
    target_column: str
    key_column: str
    weighted_confidence: float
    groups: list[PatternImputationGroup]
    low_sample_groups: list[str]


class CategoryVariantGroup(BaseModel):
    """A cluster of values that look like variants of one canonical value.

    e.g. canonical="Male", variants=["M", "male"], counts={"Male": 40, "M": 8, "male": 3}.
    """
    canonical: str
    variants: list[str]
    counts: dict[str, int]


class CategoryStandardizationSuggestion(BaseModel):
    """Suggested canonical mappings for one inconsistent categorical column."""
    column: str
    groups: list[CategoryVariantGroup]


class PseudoNullSummary(BaseModel):
    """Disguised-missing tokens found in one text column (e.g. 'NA', 'Not applicable')."""
    column: str
    tokens: dict[str, int]
    total: int


class OutlierColumnSummary(BaseModel):
    """IQR outliers found in one numeric column (mirrors the Detect-tab anomaly method)."""
    column: str
    outlier_count: int
    lower_fence: float
    upper_fence: float
    sample_values: list[float | int | str]


class CleanDetectRequest(BaseModel):
    """Request body for POST /clean/detect."""
    dataset_id: int
    dataset_version_id: int | None = None


class CleanDetectResponse(BaseModel):
    """Response body for POST /clean/detect."""
    dataset_id: int
    dataset_version_id: int
    missing_values: dict[str, int]
    duplicates: int
    column_types: dict[str, str]
    issues: list[CleaningIssue]
    pattern_suggestions: list[PatternImputationResult] = []
    category_suggestions: list[CategoryStandardizationSuggestion] = []
    pseudo_nulls: list[PseudoNullSummary] = []
    outliers: list[OutlierColumnSummary] = []
    # The version's summary including the issue counts this scan just saved (health score).
    summary: dict[str, Any] | None = None


class CleanApplyRequest(BaseModel):
    """Request body for POST /clean/apply."""
    dataset_id: int
    dataset_version_id: int | None = None
    cleaning_operations: list[CleaningOperation] = Field(default_factory=list)

class CleanApplyResponse(BaseModel):
    """Response body for POST /clean/apply.

Includes the cleaned snapshot (`data_snapshot`) which can later be persisted via the
save-result endpoint.
    """
    dataset_id: int
    dataset_version_id: int
    source_version_id: int
    operations_applied: list[CleaningOperation]
    missing_values: dict[str, int]
    duplicates: int
    column_types: dict[str, str]
    issues: list[CleaningIssue]
    pattern_suggestions: list[PatternImputationResult] = []
    category_suggestions: list[CategoryStandardizationSuggestion] = []
    pseudo_nulls: list[PseudoNullSummary] = []
    outliers: list[OutlierColumnSummary] = []
    preview: list[dict]
    summary: dict[str, Any]
    data_snapshot: dict[str, Any]
