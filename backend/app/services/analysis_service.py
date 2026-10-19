from __future__ import annotations

import math

import numpy as np
import pandas as pd
from fastapi import HTTPException, status

from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from sklearn.linear_model import LinearRegression

from app.schemas.analysis import (
    AnomalyResponse,
    AnalyzeStatsResponse,
    ChartPoint,
    ColumnAnomalyResult,
    ColumnStat,
    ColumnTrendResult,
    DistributionBin,
    DistributionResponse,
    GroupByResponse,
    GroupResult,
    PredictPoint,
    PredictResponse,
    TopValue,
    TrendResponse,
)
from app.services.dataset_snapshot import snapshot_to_dataframe
from app.services.quality_detection_service import is_code_column

SUPPORTED_AGG_FUNCS = {"sum", "count", "mean", "min", "max"}

# Cap on rows returned by group_dataset() -- a high-cardinality group-by column
# (e.g. 5,000 distinct values) would otherwise ship an unbounded payload for a
# result the UI only ever renders a top-N slice of. total_groups on the response
# tells the frontend the true count so it can show a "top N of M" notice.
MAX_GROUP_RESULTS = 50


def _get_version(dataset: Dataset, version_id: int | None) -> DatasetVersion:
    """Return the requested version (or current) from the already-loaded dataset."""
    if version_id is not None:
        version = next((v for v in (dataset.versions or []) if v.id == version_id), None)
        if version is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset version not found.")
        return version

    if dataset.current_version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset has no current version.")
    return dataset.current_version


def _safe_float(value) -> float | None:
    """Convert a value to float, returning None if it is NaN/infinite."""
    try:
        result = float(value)
        return None if math.isnan(result) or math.isinf(result) else round(result, 4)
    except (TypeError, ValueError):
        return None


def analyze_stats(dataset: Dataset, version_id: int | None = None) -> AnalyzeStatsResponse:
    """Compute per-column statistics for a dataset version."""
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    column_stats: list[ColumnStat] = []
    for col in df.columns:
        series = df[col]
        total = len(series)
        count = int(series.count())
        missing = int(series.isna().sum())
        missing_pct = round(missing / total * 100, 2) if total > 0 else 0.0
        unique = int(series.nunique(dropna=True))

        top_values = [
            TopValue(value=v, count=int(c))
            for v, c in series.value_counts(dropna=True).head(5).items()
        ]

        if pd.api.types.is_bool_dtype(series):
            dtype = "boolean"
            mean = median = std = min_val = max_val = q25 = q75 = None
        elif pd.api.types.is_datetime64_any_dtype(series):
            dtype = "datetime"
            mean = median = std = min_val = max_val = q25 = q75 = None
        elif pd.api.types.is_numeric_dtype(series):
            dtype = "numeric"
            numeric = series.dropna()
            mean = _safe_float(numeric.mean()) if len(numeric) > 0 else None
            median = _safe_float(numeric.median()) if len(numeric) > 0 else None
            std = _safe_float(numeric.std()) if len(numeric) > 1 else None
            min_val = _safe_float(numeric.min()) if len(numeric) > 0 else None
            max_val = _safe_float(numeric.max()) if len(numeric) > 0 else None
            q25 = _safe_float(numeric.quantile(0.25)) if len(numeric) > 0 else None
            q75 = _safe_float(numeric.quantile(0.75)) if len(numeric) > 0 else None
        else:
            dtype = "text"
            mean = median = std = min_val = max_val = q25 = q75 = None

        column_stats.append(
            ColumnStat(
                name=col,
                dtype=dtype,
                count=count,
                missing=missing,
                missing_pct=missing_pct,
                unique=unique,
                top_values=top_values,
                mean=mean,
                median=median,
                std=std,
                min=min_val,
                max=max_val,
                q25=q25,
                q75=q75,
            )
        )

    return AnalyzeStatsResponse(
        column_stats=column_stats,
        row_count=len(df),
        col_count=len(df.columns),
    )


def _time_series_to_x(series: pd.Series) -> tuple[np.ndarray, list[str]]:
    """Convert a datetime-like Series to float x-values (days since first) and label strings.

    Accepts both proper datetime64 columns and string columns that are at least 80%
    parseable as dates. The caller must pass a fully non-null series (drop NaT rows first).
    """
    if not pd.api.types.is_datetime64_any_dtype(series):
        parsed = pd.to_datetime(series, errors="coerce")
        if parsed.notna().mean() < 0.8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="time_column could not be parsed as datetime (fewer than 80% of values are valid dates).",
            )
        series = parsed

    days = (series - series.min()).dt.days.to_numpy(dtype=float)
    span = int(days.max()) if len(days) > 1 else 0
    fmt = "%Y-%m-%d" if span > 365 else "%b %d"
    labels = series.dt.strftime(fmt).tolist()
    return days, labels


def trend_analysis(
    dataset: Dataset,
    version_id: int | None = None,
    time_column: str | None = None,
    snapshot_override: dict | None = None,
) -> TrendResponse:
    """Run linear regression on all numeric columns and return trend results.

    When time_column is provided the DataFrame is sorted by that column and the
    regression x-axis becomes days-since-first-observation, making the slope
    meaningful ("change per day") instead of "change per row."
    snapshot_override lets callers pass an in-memory snapshot (e.g. an unsaved
    cleaning result) without requiring it to be persisted first.
    """
    if snapshot_override is not None:
        df = snapshot_to_dataframe(snapshot_override)
    else:
        version = _get_version(dataset, version_id)
        df = snapshot_to_dataframe(version.data_snapshot)

    # --- Time-column setup ---
    x_all: np.ndarray | None = None
    labels_all: list[str] | None = None
    used_time_column: str | None = None

    if time_column is not None:
        if time_column not in df.columns:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"time_column '{time_column}' not found in dataset.",
            )
        # Drop rows without a time value, sort chronologically, reset index.
        df = df[df[time_column].notna()].sort_values(by=time_column).reset_index(drop=True)
        x_all, labels_all = _time_series_to_x(df[time_column])
        used_time_column = time_column
    # -------------------------

    # Coerce object-dtype columns that contain numeric values (covers JSONB round-trip dtype drift).
    # Skip the time_column — it must remain parseable as datetime.
    for _col in df.select_dtypes(include=["object"]).columns:
        if _col == time_column:
            continue
        _coerced = pd.to_numeric(df[_col], errors="coerce")
        if _coerced.notna().sum() >= 2:
            df[_col] = _coerced

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    results: list[ColumnTrendResult] = []

    for col in numeric_cols:
        if time_column is not None:
            valid_mask = df[col].notna().to_numpy()
            values = df[col][df[col].notna()].to_numpy(dtype=float)
            if len(values) < 2:
                continue
            x = x_all[valid_mask]  # type: ignore[index]
            col_labels: list[str] | None = [labels_all[i] for i, v in enumerate(valid_mask) if v]  # type: ignore[index]
        else:
            series = df[col].dropna().reset_index(drop=True)
            if len(series) < 2:
                continue
            values = series.to_numpy(dtype=float)
            x = np.arange(len(values), dtype=float)
            col_labels = None

        slope, intercept = np.polyfit(x, values, 1)

        y_pred = slope * x + intercept
        ss_res = float(np.sum((values - y_pred) ** 2))
        ss_tot = float(np.sum((values - np.mean(values)) ** 2))
        r_squared = round(1.0 - ss_res / ss_tot, 4) if ss_tot > 1e-10 else 0.0

        col_mean = float(np.mean(values))
        if r_squared < 0.1:
            direction = "volatile"
        elif abs(slope) / (abs(col_mean) + 1e-10) < 0.001:
            direction = "stable"
        elif slope > 0:
            direction = "increasing"
        else:
            direction = "decreasing"

        chart_points = [ChartPoint(x=float(xi), y=round(float(v), 4)) for xi, v in zip(x, values)]
        trend_line = [
            ChartPoint(x=float(x[0]), y=round(float(intercept + slope * x[0]), 4)),
            ChartPoint(x=float(x[-1]), y=round(float(intercept + slope * x[-1]), 4)),
        ]

        results.append(
            ColumnTrendResult(
                column=col,
                direction=direction,
                slope=round(float(slope), 6),
                r_squared=r_squared,
                min=round(float(values.min()), 4),
                max=round(float(values.max()), 4),
                mean=round(col_mean, 4),
                count=len(values),
                chart_points=chart_points,
                trend_line=trend_line,
                x_labels=col_labels,
            )
        )

    return TrendResponse(columns=results, time_column=used_time_column)


def anomaly_detection(dataset: Dataset, version_id: int | None = None) -> AnomalyResponse:
    """Detect outliers in all numeric columns using the IQR method (code/ID columns skipped)."""
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    for _col in df.select_dtypes(include=["object"]).columns:
        _coerced = pd.to_numeric(df[_col], errors="coerce")
        if _coerced.notna().sum() >= 2:
            df[_col] = _coerced

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and not is_code_column(c)]
    col_results: list[ColumnAnomalyResult] = []
    all_outlier_indices: set[int] = set()

    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 4:
            continue

        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1

        lower_fence = q1 - 1.5 * iqr
        upper_fence = q3 + 1.5 * iqr

        outlier_mask = (df[col] < lower_fence) | (df[col] > upper_fence)
        outlier_indices = set(df.index[outlier_mask & df[col].notna()].tolist())
        all_outlier_indices |= outlier_indices

        outlier_values = df.loc[list(outlier_indices), col].dropna().head(5).tolist()
        sample = [round(float(v), 4) if isinstance(v, float) else v for v in outlier_values]

        total = int(series.count())
        count = len(outlier_indices)
        pct = round(count / total * 100, 2) if total > 0 else 0.0

        col_results.append(
            ColumnAnomalyResult(
                column=col,
                outlier_count=count,
                total_count=total,
                outlier_pct=pct,
                lower_fence=round(lower_fence, 4),
                upper_fence=round(upper_fence, 4),
                sample_outliers=sample,
            )
        )

    col_results.sort(key=lambda r: r.outlier_count, reverse=True)

    return AnomalyResponse(
        total_flagged_rows=len(all_outlier_indices),
        columns_analyzed=len(col_results),
        columns=col_results,
    )


def predict_column(
    dataset: Dataset,
    input_column: str,
    target_column: str,
    future_steps: int,
    version_id: int | None = None,
    time_column: str | None = None,
    snapshot_override: dict | None = None,
) -> PredictResponse:
    """Predict future values for a numeric target column using linear regression.

    When time_column is provided the data is sorted chronologically and each
    prediction step is 1 day beyond the last observed date, making the slope
    "change per day." Without time_column the original row-index behavior is used.
    snapshot_override lets callers pass an in-memory snapshot without persisting it.
    """
    if snapshot_override is not None:
        df = snapshot_to_dataframe(snapshot_override)
    else:
        version = _get_version(dataset, version_id)
        df = snapshot_to_dataframe(version.data_snapshot)

    if target_column not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{target_column}' not found.")

    used_time_column: str | None = None
    time_x_all: np.ndarray | None = None

    if time_column is not None:
        if time_column not in df.columns:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"time_column '{time_column}' not found.")
        df = df[df[time_column].notna()].sort_values(by=time_column).reset_index(drop=True)
        time_x_all, _ = _time_series_to_x(df[time_column])
        used_time_column = time_column

    y_numeric = pd.to_numeric(df[target_column], errors="coerce")
    valid_mask = y_numeric.notna().to_numpy()
    y = y_numeric[y_numeric.notna()].to_numpy(dtype=float)

    if len(y) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Column '{target_column}' has too few numeric values to predict (need at least 2).",
        )

    if time_column is not None:
        x = time_x_all[valid_mask].reshape(-1, 1)  # type: ignore[index]
        last_x = float(x[-1, 0])
    else:
        x = np.arange(len(y)).reshape(-1, 1)
        last_x = float(len(y) - 1)

    model = LinearRegression().fit(x, y)
    slope = float(model.coef_[0])
    intercept = float(model.intercept_)

    y_pred_train = model.predict(x)
    ss_res = float(np.sum((y - y_pred_train) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r_squared = round(1.0 - ss_res / ss_tot, 4) if ss_tot > 1e-10 else 0.0
    std_error = float(np.sqrt(ss_res / max(len(y) - 2, 1)))

    predictions = [
        PredictPoint(
            step=i,
            predicted_value=round(float(model.predict([[last_x + i]])[0]), 4),
            lower_bound=round(float(model.predict([[last_x + i]])[0]) - std_error, 4),
            upper_bound=round(float(model.predict([[last_x + i]])[0]) + std_error, 4),
        )
        for i in range(1, future_steps + 1)
    ]

    return PredictResponse(
        input_column=input_column,
        target_column=target_column,
        future_steps=future_steps,
        slope=round(slope, 6),
        intercept=round(intercept, 4),
        r_squared=r_squared,
        predictions=predictions,
        time_column=used_time_column,
    )


def group_dataset(
    dataset: Dataset,
    group_by: str,
    aggregate_column: str,
    aggregate_func: str,
    version_id: int | None = None,
) -> GroupByResponse:
    """Group a dataset by one column and aggregate another."""
    if aggregate_func not in SUPPORTED_AGG_FUNCS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported aggregate function '{aggregate_func}'. Use: {', '.join(sorted(SUPPORTED_AGG_FUNCS))}.",
        )

    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    if group_by not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{group_by}' not found.")
    if aggregate_column not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{aggregate_column}' not found.")

    try:
        if aggregate_func == "count":
            # size() counts all rows per group (including rows with nulls in other columns)
            result_series = df.groupby(group_by, dropna=False).size()
        else:
            grouped = df.groupby(group_by, dropna=False)[aggregate_column]
            if aggregate_func == "sum":
                result_series = grouped.sum(numeric_only=True)
            elif aggregate_func == "mean":
                result_series = grouped.mean(numeric_only=True)
            elif aggregate_func == "min":
                result_series = grouped.min(numeric_only=True)
            elif aggregate_func == "max":
                result_series = grouped.max(numeric_only=True)
            else:
                result_series = grouped.count()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not aggregate column '{aggregate_column}' with '{aggregate_func}': {exc}",
        ) from exc

    results = [
        GroupResult(
            group=str(k) if k is not None else "(blank)",
            value=_safe_float(v) or 0.0,
        )
        for k, v in result_series.items()
    ]
    # Stable sort: ties at the MAX_GROUP_RESULTS cutoff keep their original
    # groupby iteration order rather than any secondary key.
    results.sort(key=lambda r: r.value, reverse=True)
    total_groups = len(results)
    results = results[:MAX_GROUP_RESULTS]

    return GroupByResponse(
        group_by=group_by,
        aggregate_column=aggregate_column,
        aggregate_func=aggregate_func,
        results=results,
        total_groups=total_groups,
    )


def compute_distribution(
    dataset: Dataset,
    column: str,
    version_id: int | None = None,
    bins: int = 20,
) -> DistributionResponse:
    """Build a distribution payload for one column.

    Numeric: equal-width histogram with `bins` bins, plus mean/median/std/min/max.
    Categorical: top 20 values by count.
    Boolean: True/False counts.
    Datetime: counts grouped by year (>5 yrs span) or year-month.
    """
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    if column not in df.columns:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Column '{column}' not found.")

    series = df[column]
    total = int(series.shape[0])
    missing = int(series.isna().sum())
    unique = int(series.nunique(dropna=True))
    non_null = series.dropna()

    if len(non_null) == 0:
        return DistributionResponse(
            column=column,
            kind="empty",
            bins=[],
            total_count=total,
            missing_count=missing,
            unique_count=unique,
        )

    if pd.api.types.is_bool_dtype(series):
        counts = non_null.value_counts(dropna=True)
        bin_list = [
            DistributionBin(label=str(bool(value)), count=int(count))
            for value, count in counts.items()
        ]
        return DistributionResponse(
            column=column,
            kind="boolean",
            bins=bin_list,
            total_count=total,
            missing_count=missing,
            unique_count=unique,
        )

    if pd.api.types.is_datetime64_any_dtype(series):
        parsed = pd.to_datetime(non_null, errors="coerce").dropna()
        if len(parsed) == 0:
            return DistributionResponse(
                column=column,
                kind="empty",
                bins=[],
                total_count=total,
                missing_count=missing,
                unique_count=unique,
            )
        span_days = (parsed.max() - parsed.min()).days
        freq = "Y" if span_days > 365 * 5 else "M"
        grouped = parsed.dt.to_period(freq).value_counts().sort_index()
        bin_list = [
            DistributionBin(label=str(period), count=int(count))
            for period, count in grouped.items()
        ]
        return DistributionResponse(
            column=column,
            kind="datetime",
            bins=bin_list,
            total_count=total,
            missing_count=missing,
            unique_count=unique,
        )

    if pd.api.types.is_numeric_dtype(series):
        numeric = pd.to_numeric(non_null, errors="coerce").dropna()
        if len(numeric) == 0:
            return DistributionResponse(
                column=column,
                kind="empty",
                bins=[],
                total_count=total,
                missing_count=missing,
                unique_count=unique,
            )
        bin_count = max(min(int(bins), 50), 5)
        try:
            edges = np.histogram_bin_edges(numeric.to_numpy(), bins=bin_count)
            counts, _ = np.histogram(numeric.to_numpy(), bins=edges)
        except ValueError:
            return DistributionResponse(
                column=column,
                kind="empty",
                bins=[],
                total_count=total,
                missing_count=missing,
                unique_count=unique,
            )
        bin_list = []
        for i in range(len(counts)):
            start = float(edges[i])
            end = float(edges[i + 1])
            bin_list.append(
                DistributionBin(
                    label=f"{round(start, 2)}–{round(end, 2)}",
                    count=int(counts[i]),
                    bin_start=round(start, 6),
                    bin_end=round(end, 6),
                )
            )
        return DistributionResponse(
            column=column,
            kind="numeric",
            bins=bin_list,
            total_count=total,
            missing_count=missing,
            unique_count=unique,
            mean=_safe_float(numeric.mean()),
            median=_safe_float(numeric.median()),
            std=_safe_float(numeric.std()) if len(numeric) > 1 else None,
            min=_safe_float(numeric.min()),
            max=_safe_float(numeric.max()),
        )

    # Categorical / object / string fallback
    counts = non_null.astype(str).value_counts(dropna=True).head(20)
    bin_list = [
        DistributionBin(label=str(value), count=int(count))
        for value, count in counts.items()
    ]
    return DistributionResponse(
        column=column,
        kind="categorical",
        bins=bin_list,
        total_count=total,
        missing_count=missing,
        unique_count=unique,
    )
