"""Suggested groupings for the Explore → Aggregation view (Objective 4: grouping recommendations).

For every (category column, number column) pair the correlation ratio η² (eta squared,
the one-way ANOVA effect size) is computed:

    η² = between-group sum of squares / total sum of squares

i.e. the share of a number column's variation that is explained by which group a row
belongs to. Pairs are ranked by η²; Cohen's thresholds (0.06 medium, 0.14 large) decide
what is worth suggesting. Groups use the raw values with missing values dropped, the same
way `analysis_service.group_dataset` groups them, so a suggestion's result matches what
the user sees when it is applied.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from app.services.quality_detection_service import is_code_column

MIN_ETA_SQUARED = 0.06       # Cohen: medium effect
STRONG_ETA_SQUARED = 0.14    # Cohen: large effect
MAX_GROUPS = 20              # more groups than this is hard to read as a chart
MIN_ROWS_PER_GROUP = 3       # on average; fewer makes η² look stronger than it is
MAX_AVERAGE_SUGGESTIONS = 3
MAX_PER_GROUP_COLUMN = 2


def eta_squared(groups: pd.Series, values: pd.Series) -> float | None:
    """Share of the variation in `values` explained by `groups` (0–1); None if undefined."""
    frame = pd.DataFrame({"g": groups, "y": pd.to_numeric(values, errors="coerce")}).dropna()
    if frame["g"].nunique() < 2 or len(frame) < 3:
        return None
    grand_mean = frame["y"].mean()
    ss_total = float(((frame["y"] - grand_mean) ** 2).sum())
    if ss_total <= 1e-12:
        return None
    stats = frame.groupby("g")["y"].agg(["count", "mean"])
    ss_between = float((stats["count"] * (stats["mean"] - grand_mean) ** 2).sum())
    return min(max(ss_between / ss_total, 0.0), 1.0)


def _group_candidates(frame: pd.DataFrame) -> list[str]:
    """Columns that work as a "Group by": labels with a small number of repeated values."""
    candidates: list[str] = []
    for column in frame.columns:
        series = frame[column]
        is_label = pd.api.types.is_bool_dtype(series) or not (
            pd.api.types.is_numeric_dtype(series) or pd.api.types.is_datetime64_any_dtype(series)
        )
        if not is_label:
            continue
        non_null = series.dropna()
        groups = int(non_null.nunique())
        if not (2 <= groups <= MAX_GROUPS) or len(non_null) < groups * MIN_ROWS_PER_GROUP:
            continue
        if groups / max(len(non_null), 1) > 0.5:  # ID-like: almost every row is its own group
            continue
        candidates.append(str(column))
    return candidates


def _measure_candidates(frame: pd.DataFrame) -> list[str]:
    """Number columns worth averaging (codes such as zip codes or IDs are labels, not amounts)."""
    return [
        str(column)
        for column in frame.columns
        if pd.api.types.is_numeric_dtype(frame[column])
        and not pd.api.types.is_bool_dtype(frame[column])
        and not is_code_column(column)
        and int(frame[column].notna().sum()) >= 3
    ]


def _evenness(series: pd.Series) -> float:
    """Normalised entropy (0–1): 1 when every group has the same number of rows."""
    counts = series.dropna().value_counts()
    if len(counts) < 2:
        return 0.0
    shares = counts / counts.sum()
    return float(-(shares * shares.map(math.log)).sum() / math.log(len(counts)))


def suggest_groupings(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Up to three "Average <number> by <category>" suggestions plus one row count."""
    group_columns = _group_candidates(frame)
    if not group_columns:
        return []

    scored: list[tuple[float, str, str]] = []
    for group in group_columns:
        for measure in _measure_candidates(frame):
            eta2 = eta_squared(frame[group], frame[measure])
            if eta2 is not None and eta2 >= MIN_ETA_SQUARED:
                scored.append((eta2, group, measure))
    scored.sort(key=lambda item: (-item[0], item[1], item[2]))

    suggestions: list[dict[str, Any]] = []
    per_group: dict[str, int] = {}
    for eta2, group, measure in scored:
        if len(suggestions) >= MAX_AVERAGE_SUGGESTIONS:
            break
        if per_group.get(group, 0) >= MAX_PER_GROUP_COLUMN:
            continue
        per_group[group] = per_group.get(group, 0) + 1
        percent = round(eta2 * 100)
        suggestions.append({
            "group_by": group,
            "aggregate_column": measure,
            "aggregate_func": "mean",
            "title": f"Average {measure} by {group}",
            "reason": f"{group} explains about {percent}% of the differences in {measure}.",
            "strength": round(eta2, 4),
            "strength_label": "strong" if eta2 >= STRONG_ETA_SQUARED else "moderate",
        })

    count_group = suggestions[0]["group_by"] if suggestions else max(
        group_columns, key=lambda column: (_evenness(frame[column]), -group_columns.index(column))
    )
    groups = int(frame[count_group].dropna().nunique())
    suggestions.append({
        "group_by": count_group,
        "aggregate_column": count_group,
        "aggregate_func": "count",
        "title": f"Number of rows by {count_group}",
        "reason": f"Shows how many records fall in each of the {groups} {count_group} groups.",
        "strength": None,
        "strength_label": None,
    })
    return suggestions
