from __future__ import annotations

import pandas as pd

from app.schemas.cleaning import PatternImputationGroup, PatternImputationResult

# Share of known target values that must agree with their group's usual value.
_MIN_CONFIDENCE = 0.8
_LOW_SAMPLE_THRESHOLD = 5
# Evidence guard: without it, a key where every value is unique (an ID column)
# would look "100% consistent" because each group has a single known value.
# Together with "at least 2 distinct keys" this means at least 4 known values.
_MIN_AVG_SUPPORT_PER_GROUP = 2.0
# A key column must repeat its values to describe a relationship: at most this
# share of its non-null rows may be distinct values, capped for speed.
_MAX_KEY_DISTINCT_RATIO = 0.5
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


def _key_cardinality_ok(series: pd.Series) -> bool:
    key = _normalized_key(series).dropna()
    distinct = key.nunique()
    return 2 <= distinct <= min(_MAX_KEY_DISTINCT, len(key) * _MAX_KEY_DISTINCT_RATIO)


def _analyze_pair(
    df: pd.DataFrame,
    key_col: str,
    target_col: str,
) -> PatternImputationResult | None:
    """
    Analyse the relationship between a categorical key column and a target column
    that has missing values (e.g. City -> Zip Code). Returns None when the pattern
    is too weak or there is too little evidence.

    - per-group coverage    = support_count / total_in_group (informational only)
    - per-group consistency = consistency_count / support_count
    - weighted_confidence   = all known values agreeing with their group's usual value
                              / all known values (support-weighted consistency)

    How many values are missing is not evidence against the pattern, so coverage
    does not gate the suggestion; it is the case where filling helps most.
    """
    groups: list[PatternImputationGroup] = []
    low_sample_groups: list[str] = []
    total_support = 0
    total_consistent = 0
    groups_with_fill = 0

    for _, group_df in df.groupby(_normalized_key(df[key_col]), dropna=True):
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

        # Show the most common original spelling of the key, not the normalized form.
        key_str = str(group_df[key_col].mode().iloc[0])
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
        total_support += support_count
        total_consistent += consistency_count
        if fillable_count > 0:
            groups_with_fill += 1

    if not groups or groups_with_fill == 0:
        return None
    if total_support / len(groups) < _MIN_AVG_SUPPORT_PER_GROUP:
        return None

    weighted_confidence = round(total_consistent / total_support, 4)
    if weighted_confidence < _MIN_CONFIDENCE:
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

    categorical_cols = [c for c in df.columns if _is_categorical(df[c]) and _key_cardinality_ok(df[c])]
    numeric_missing = [
        c for c in missing_cols
        if c in df.columns
        and (pd.api.types.is_numeric_dtype(df[c]) or pd.api.types.is_string_dtype(df[c]) or df[c].dtype == object)
    ]

    if not categorical_cols or not numeric_missing:
        return []

    results: list[PatternImputationResult] = []
    seen: set[str] = set()

    for target_col in numeric_missing:
        for key_col in categorical_cols:
            if key_col == target_col:
                continue
            pair_key = f"{key_col}→{target_col}"
            if pair_key in seen:
                continue
            seen.add(pair_key)

            result = _analyze_pair(df, key_col, target_col)
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
