from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class StructureSummaryRequest(BaseModel):
    """Request body for dataset structure summary.

    If `data_snapshot` is provided, the summary is computed from that snapshot
    (useful for unsaved session results). Otherwise, the dataset's current stored
    snapshot is used.
    """

    data_snapshot: dict[str, Any] | None = None
    top_values_limit: int = Field(default=5, ge=1, le=20)


class TopValue(BaseModel):
    value: str
    count: int


class ColumnNumericStats(BaseModel):
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    median: float | None = None


class ColumnStructureSummary(BaseModel):
    name: str
    kind: str
    missing_values: int
    unique_values: int
    numeric: ColumnNumericStats | None = None
    top_values: list[TopValue] = Field(default_factory=list)


class GroupingSuggestion(BaseModel):
    """A suggested Aggregation setup (see grouping_suggestion_service)."""
    group_by: str
    aggregate_column: str
    aggregate_func: str
    title: str
    reason: str
    strength: float | None = None  # η²: share of the number column's variation explained by the groups
    strength_label: str | None = None  # "strong" / "moderate"; None for a row count


class StructureSummaryResponse(BaseModel):
    row_count: int
    column_count: int
    missing_cells: int
    duplicate_rows: int
    columns: list[ColumnStructureSummary]
    grouping_suggestions: list[GroupingSuggestion] = Field(default_factory=list)
