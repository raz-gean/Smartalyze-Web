from __future__ import annotations

import math
import warnings
from typing import Any

import pandas as pd

from app.services.grouping_suggestion_service import suggest_groupings
from app.services.quality_detection_service import is_code_like


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    try:
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    except Exception:
        return None


def _infer_kind(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"

    non_null = series.dropna()
    if non_null.empty:
        return "unknown"

    # Code/ID columns ("08100") are labels, not numbers: summarise them as text/categories.
    text = non_null.astype(str).str.strip()
    code_like = is_code_like(series.name, non_null)
    coerced = pd.to_numeric(text, errors="coerce")
    if coerced.notna().mean() >= 0.8 and not code_like:
        return "numeric"

    # Dates typed as text ("2024-01-05", "July 21 2005"): same 85% rule as the cleaning scan,
    # so Explore and the Edit tab call the column the same thing.
    if not code_like:
        sample = text.head(500)  # parsing is element-wise for mixed formats; a sample is enough
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Could not infer format*", category=UserWarning)
            month_first = pd.to_datetime(sample, errors="coerce", dayfirst=False).notna().mean()
            day_first = pd.to_datetime(sample, errors="coerce", dayfirst=True).notna().mean()
        if max(month_first, day_first) >= 0.85:
            return "datetime_string"

    unique_ratio = non_null.nunique(dropna=True) / max(len(non_null), 1)
    if unique_ratio <= 0.5:
        return "categorical"
    return "text"


def compute_structure_summary(frame: pd.DataFrame, *, top_values_limit: int = 5) -> dict[str, Any]:
    """Friendly per-column summary built for non-technical readers.

    Mirrors the Mobile `/dataset/{id}/structure/summary` payload so both clients
    can speak the same language.
    """
    row_count = int(frame.shape[0])
    column_count = int(frame.shape[1])
    missing_cells = int(frame.isna().sum().sum())
    duplicate_rows = int(frame.duplicated().sum())

    columns: list[dict[str, Any]] = []

    for column in frame.columns:
        name = str(column)
        series = frame[column]
        kind = _infer_kind(series)
        missing_values = int(series.isna().sum())
        unique_values = int(series.nunique(dropna=True))

        column_payload: dict[str, Any] = {
            "name": name,
            "kind": kind,
            "missing_values": missing_values,
            "unique_values": unique_values,
            "numeric": None,
            "top_values": [],
        }

        if kind == "numeric":
            numeric_series = pd.to_numeric(series, errors="coerce")
            if numeric_series.notna().any():
                column_payload["numeric"] = {
                    "min": _safe_float(numeric_series.min()),
                    "max": _safe_float(numeric_series.max()),
                    "mean": _safe_float(numeric_series.mean()),
                    "median": _safe_float(numeric_series.median()),
                }

        if kind in {"categorical", "text", "boolean", "datetime_string"}:
            non_null = series.dropna()
            if not non_null.empty:
                counts = non_null.astype(str).value_counts().head(top_values_limit)
                column_payload["top_values"] = [
                    {"value": str(value), "count": int(count)} for value, count in counts.items()
                ]

        columns.append(column_payload)

    return {
        "row_count": row_count,
        "column_count": column_count,
        "missing_cells": missing_cells,
        "duplicate_rows": duplicate_rows,
        "columns": columns,
        "grouping_suggestions": suggest_groupings(frame),
    }
