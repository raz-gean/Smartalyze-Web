from __future__ import annotations

from typing import Any
from pydantic import BaseModel


class AIContext(BaseModel):
    dataset_name: str
    row_count: int | None = None
    column_types: dict[str, str] = {}
    missing_values: dict[str, int] = {}
    duplicates: int = 0
    issues: list[dict[str, Any]] = []
    pattern_suggestions: list[dict[str, Any]] = []
    outliers: list[dict[str, Any]] = []


class AISuggestRequest(BaseModel):
    context: AIContext


class AISuggestResponse(BaseModel):
    suggestion: str


class AIChatMessage(BaseModel):
    role: str
    content: str


class AIChatRequest(BaseModel):
    context: AIContext
    message: str
    history: list[AIChatMessage] = []


class AIChatResponse(BaseModel):
    reply: str


class ColumnStatSummary(BaseModel):
    name: str
    dtype: str
    missing_pct: float
    mean: float | None = None
    min: float | None = None
    max: float | None = None
    std: float | None = None


class TrendSummaryItem(BaseModel):
    column: str
    direction: str
    slope: float
    r_squared: float


class AnomalySummaryItem(BaseModel):
    column: str
    outlier_count: int
    outlier_pct: float
    lower_fence: float
    upper_fence: float


class CorrelationPair(BaseModel):
    col_a: str
    col_b: str
    r: float


class AIAnalyzeContext(BaseModel):
    dataset_name: str
    row_count: int
    col_count: int
    column_stats: list[ColumnStatSummary] = []
    trends: list[TrendSummaryItem] = []
    anomalies: list[AnomalySummaryItem] = []
    top_correlations: list[CorrelationPair] = []
    # Explore → Aggregation's suggested groupings, as plain sentences (title + reason).
    suggested_groupings: list[str] = []


class AIAnalyzeRequest(BaseModel):
    context: AIAnalyzeContext


class AIAnalyzeResponse(BaseModel):
    insight: str


class AIAnalyzeChatRequest(BaseModel):
    context: AIAnalyzeContext
    message: str
    history: list[AIChatMessage] = []
