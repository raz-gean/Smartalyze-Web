from __future__ import annotations

import math
from typing import Literal

import pandas as pd
from fastapi import HTTPException, status

from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from app.schemas.analysis import CorrelationResponse
from app.services.dataset_snapshot import snapshot_to_dataframe
from app.services.quality_detection_service import is_code_like

CorrelationMethod = Literal["pearson", "spearman"]

# Cap on columns rendered in the heatmap -- at the frontend's fixed 64px cell size,
# more than ~20 columns produces a grid too large to read even scrolled. When a
# dataset has more numeric columns than this, keep the ones most correlated with
# the rest of the dataset (by mean absolute correlation) rather than an arbitrary
# subset, since those are the relationships most likely to be analytically useful.
MAX_CORRELATION_COLUMNS = 20


def _get_version(dataset: Dataset, version_id: int | None) -> DatasetVersion:
    if version_id is not None:
        version = next((v for v in (dataset.versions or []) if v.id == version_id), None)
        if version is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset version not found.")
        return version

    if dataset.current_version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset has no current version.")
    return dataset.current_version


def _safe_float(value) -> float:
    try:
        result = float(value)
        return 0.0 if (math.isnan(result) or math.isinf(result)) else round(result, 4)
    except (TypeError, ValueError):
        return 0.0


def _coerce_numeric_columns(df: pd.DataFrame) -> list[str]:
    """Return column names that are numeric or can be coerced (≥80% parseable).

    Code/ID columns (zip codes, IDs) are skipped: correlating labels means nothing.
    """
    numeric_cols: list[str] = []
    for col in df.columns:
        series = df[col]
        if is_code_like(col, series):
            continue
        if pd.api.types.is_numeric_dtype(series):
            numeric_cols.append(col)
        elif series.dtype == object:
            coerced = pd.to_numeric(series, errors="coerce")
            non_null = series.dropna()
            if len(non_null) > 0 and coerced.notna().sum() / len(non_null) >= 0.8:
                numeric_cols.append(col)
    return numeric_cols


def compute_correlation(
    dataset: Dataset,
    version_id: int | None = None,
    snapshot_override: dict | None = None,
    method: CorrelationMethod = "pearson",
) -> CorrelationResponse:
    """Compute a correlation matrix for all numeric columns.

    Methods:
    - "pearson" — linear correlation (assumes linearity + roughly normal residuals)
    - "spearman" — rank correlation (captures monotonic but non-linear relationships;
      robust to outliers, suitable for ordinal or skewed numeric data)
    """
    if snapshot_override:
        df = snapshot_to_dataframe(snapshot_override)
    else:
        version = _get_version(dataset, version_id)
        df = snapshot_to_dataframe(version.data_snapshot)

    numeric_cols = _coerce_numeric_columns(df)
    total_columns = len(numeric_cols)

    if total_columns < 2:
        return CorrelationResponse(columns=[], matrix={}, method=method, total_columns=total_columns)

    sub = df[numeric_cols].copy()
    for col in numeric_cols:
        if sub[col].dtype == object:
            sub[col] = pd.to_numeric(sub[col], errors="coerce")

    corr_df = sub.corr(method=method)

    if len(corr_df.columns) > MAX_CORRELATION_COLUMNS:
        # Rank by mean absolute correlation with the rest of the matrix (includes
        # the self-correlation diagonal of 1.0, a constant offset that doesn't
        # change the ranking) and keep the most "entangled" columns.
        strength = corr_df.abs().mean().sort_values(ascending=False)
        selected = list(strength.index[:MAX_CORRELATION_COLUMNS])
        corr_df = corr_df.loc[selected, selected]

    columns = list(corr_df.columns)
    matrix: dict[str, dict[str, float]] = {
        col: {other: _safe_float(corr_df.loc[col, other]) for other in columns}
        for col in columns
    }

    return CorrelationResponse(columns=columns, matrix=matrix, method=method, total_columns=total_columns)
