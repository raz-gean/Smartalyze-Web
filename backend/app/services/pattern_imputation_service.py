from __future__ import annotations

import pandas as pd

from app.schemas.cleaning import PatternImputationGroup, PatternImputationResult
from app.services.quality_detection_service import preferred_label_key

# Share of known target values that must agree with their group's usual value.
_MIN_CONFIDENCE = 0.8
# Goodman-Kruskal lambda: how much knowing the key reduces wrong guesses compared with
# always guessing the target's single most common value. Rejects "patterns" that are
# just a near-constant column (e.g. Country is 90% "PH" whatever the City is).
_MIN_LAMBDA = 0.5
_LOW_SAMPLE_THRESHOLD = 5
# Agreement can only be measured in a group with at least 2 known values, and a
# relationship needs at least 2 such groups (so at least 4 known values in total).
# A key where every value is unique (an ID column) never qualifies.
_MIN_GROUP_SUPPORT = 2
_MIN_MEASURABLE_GROUPS = 2
# Speed cap on how many distinct key values are analysed.
_MAX_KEY_DISTINCT = 1000


def _is_categorical(series: pd.Series) -> bool:
    """True if the series looks like a categorical/text column."""
    if pd.api.types.is_bool_dtype(series) or pd.api.types.is_numeric_dtype(series):
        return False
    if pd.api.types.is_datetime64_any_dtype(series):
        return False
    return pd.api.types.is_string_dtype(series) or series.dtype == object


def _normalized_key(series: pd.Series) -> pd.Series:
    """Grouping key that treats "Panabo", "panabo" and "PANABO " as the same value.

    Shared by detection and apply so the suggested fill and the applied fill always
    use identical groups. Blank strings count as missing keys.
    """
    def normalize(value: object) -> str | None:
        if pd.isna(value):
            return None
        return str(value).strip().casefold() or None

    return pd.Series([normalize(v) for v in series], index=series.index, dtype=object)


def _analyze_pair(
    df: pd.DataFrame,
    key_col: str,
    target_col: str,
    key: pd.Series,
) -> PatternImputationResult | None:
    """
    Analyse the relationship between a categorical key column and a target column
    that has missing values (e.g. City -> Zip Code). `key` is the normalized key_col.
    Returns None when the pattern is too weak or there is too little evidence.

    - per-group coverage    = support_count / total_in_group (informational only)
    - per-group consistency = consistency_count / support_count
    - weighted_confidence   = known values agreeing with their group's usual value
                              / all known values, over groups with >= 2 known values

    How many values are missing is not evidence against the pattern, so coverage
    does not gate the suggestion; it is the case where filling helps most. Groups
    with a single known value still get filled but are listed in low_sample_groups.
    """
    groups: list[PatternImputationGroup] = []
    low_sample_groups: list[str] = []
    measured_support = 0
    measured_consistent = 0
    measured_known: list[pd.Series] = []
    groups_with_fill = 0

    for _, group_df in df.groupby(key, dropna=True):
        known = group_df[target_col].dropna()
        missing_mask = group_df[target_col].isna()
        fillable_count = int(missing_mask.sum())

        if len(known) == 0:
            continue

        # Modal fill value for this group
        mode_series = known.mode()
        fill_value = mode_series.iloc[0] if len(mode_series) > 0 else None

        support_count = int(len(known))
        total_in_group = support_count + fillable_count
        coverage = support_count / total_in_group if total_in_group > 0 else 0.0

        # Consistency: what fraction of known values equal the modal fill?
        consistency_count = int((known == fill_value).sum()) if fill_value is not None else 0
        consistency_ratio = round(consistency_count / support_count, 4) if support_count > 0 else 0.0

        # Show the best original spelling of the key ("Panabo" over "PANABO"), not the normalized form.
        key_counts = group_df[key_col].dropna().astype(str).value_counts()
        key_str = min(key_counts.index, key=lambda k: preferred_label_key(k, int(key_counts[k])))
        if support_count < _LOW_SAMPLE_THRESHOLD:
            low_sample_groups.append(key_str)

        # Normalise fill_value for serialisation
        if fill_value is not None:
            try:
                fill_serialised: str | float | None = float(fill_value)
            except (TypeError, ValueError):
                fill_serialised = str(fill_value)
        else:
            fill_serialised = None

        # Human-readable explanation for this group
        fill_repr = fill_serialised if fill_serialised is not None else "N/A"
        explanation = (
            f"'{key_col}'='{key_str}' has {total_in_group} record(s); "
            f"{consistency_count} of {support_count} known {target_col} values are {fill_repr!r} "
            f"({round(consistency_ratio * 100)}% consistent)"
        )

        groups.append(
            PatternImputationGroup(
                key_value=key_str,
                fill_value=fill_serialised,
                confidence=round(coverage, 4),
                support_count=support_count,
                fillable_count=fillable_count,
                consistency_ratio=consistency_ratio,
                explanation=explanation,
            )
        )
        if fillable_count > 0:
            groups_with_fill += 1
        if support_count >= _MIN_GROUP_SUPPORT:
            measured_support += support_count
            measured_consistent += consistency_count
            measured_known.append(known)

    if groups_with_fill == 0 or len(measured_known) < _MIN_MEASURABLE_GROUPS:
        return None

    weighted_confidence = round(measured_consistent / measured_support, 4)
    if weighted_confidence < _MIN_CONFIDENCE:
        return None

    # Lambda compares the per-group guesses with one global guess on the same values.
    global_hits = int(pd.concat(measured_known).value_counts().iloc[0])
    if global_hits == measured_support:
        return None  # every known value is identical: the key adds nothing
    lam = (measured_consistent - global_hits) / (measured_support - global_hits)
    if lam < _MIN_LAMBDA:
        return None

    return PatternImputationResult(
        target_column=target_col,
        key_column=key_col,
        weighted_confidence=weighted_confidence,
        groups=groups,
        low_sample_groups=low_sample_groups,
    )


def find_pattern_suggestions(df: pd.DataFrame, missing_cols: list[str]) -> list[PatternImputationResult]:
    """
    For each column with missing values, find categorical columns whose groups
    predict the missing values with high confidence.
    """
    if df.empty or not missing_cols:
        return []

    # Normalize each candidate key once; it is reused for every target column.
    keys: dict[str, pd.Series] = {}
    for col in df.columns:
        if not _is_categorical(df[col]):
            continue
        key = _normalized_key(df[col])
        if 2 <= key.nunique(dropna=True) <= _MAX_KEY_DISTINCT:
            keys[col] = key

    numeric_missing = [
        c for c in missing_cols
        if c in df.columns
        and (pd.api.types.is_numeric_dtype(df[c]) or pd.api.types.is_string_dtype(df[c]) or df[c].dtype == object)
    ]

    if not keys or not numeric_missing:
        return []

    results: list[PatternImputationResult] = []
    seen: set[str] = set()

    for target_col in numeric_missing:
        for key_col, key in keys.items():
            if key_col == target_col:
                continue
            pair_key = f"{key_col}→{target_col}"
            if pair_key in seen:
                continue
            seen.add(pair_key)

            result = _analyze_pair(df, key_col, target_col, key)
            if result is not None:
                results.append(result)

    return results


def apply_pattern_fill(df: pd.DataFrame, key_col: str, target_col: str) -> pd.DataFrame:
    """
    Fill missing values in target_col using the modal value per group in key_col
    (grouped on the same normalized key used for detection).
    """
    df = df.copy()
    for _, group_idx in df.groupby(_normalized_key(df[key_col]), dropna=True).groups.items():
        known = df.loc[group_idx, target_col].dropna()
        if known.empty:
            continue
        fill_val = known.mode().iloc[0]
        missing_in_group = df.loc[group_idx, target_col].isna()
        df.loc[group_idx[missing_in_group], target_col] = fill_val
    return df
