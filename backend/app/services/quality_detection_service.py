from __future__ import annotations

"""Quality detection service.

Local, deterministic detectors for messy-data issues the basic detection misses:
- categorical variants (M / Male / male  ->  one canonical value)
- disguised / pseudo missing values ("NA", "Not applicable", "-", ...)
- inconsistent date formats within one column ("July 21 2005" + "07/21/2005")
- outliers (IQR, mirrors the Detect-tab anomaly method)

Everything here is rule/heuristic based plus stdlib `difflib` fuzzy matching — no AI/LLM,
no network calls — so every resulting fix stays reproducible in the exported pandas script.

Entry point: `analyze_quality(frame)` runs all detectors in one pass and returns a
`QualityFindings` (CleaningIssue list + structured suggestion lists).
"""

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import pandas as pd

from app.services.dataset_snapshot import has_leading_zero_codes
from app.schemas.cleaning import (
    CategoryStandardizationSuggestion,
    CategoryVariantGroup,
    CleaningIssue,
    OutlierColumnSummary,
    PseudoNullSummary,
)

# Normalized (casefolded) tokens that usually mean "missing" when stored as text.
PSEUDO_NULL_TOKENS: set[str] = {
    "na", "n/a", "n.a", "n.a.", "not applicable", "not available",
    "none", "null", "nil", "nan", "-", "--", "---", "?", "??",
    "unknown", "unk", "missing", "tbd", "blank", "empty",
}

_MAX_CATEGORICAL_CARDINALITY = 50
_FUZZY_THRESHOLD = 0.85
_FORMAT_SAMPLE_SIZE = 500
_WS_RE = re.compile(r"\s+")

# Date-format "fingerprints". A column mixing 2+ of these is flagged as inconsistent.
_DATE_FORMATS: list[tuple[str, re.Pattern[str]]] = [
    ("iso",            re.compile(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$")),
    ("datetime_iso",   re.compile(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[T ]\d{1,2}:\d{2}")),
    ("numeric",        re.compile(r"^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$")),
    ("month_name",     re.compile(r"^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}$")),
    ("day_month_name", re.compile(r"^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}$")),
    ("compact",        re.compile(r"^\d{8}$")),
    ("oracle",         re.compile(r"^\d{1,2}-[A-Za-z]{3}-\d{2,4}$")),
]

# Formats in the same family are treated as equivalent — mixing them does NOT count
# as a format inconsistency (e.g. ISO date vs ISO datetime differ only by time component).
_FORMAT_FAMILY: dict[str, str] = {
    "iso": "iso_family",
    "datetime_iso": "iso_family",
}


@dataclass
class QualityFindings:
    issues: list[CleaningIssue] = field(default_factory=list)
    category_suggestions: list[CategoryStandardizationSuggestion] = field(default_factory=list)
    pseudo_nulls: list[PseudoNullSummary] = field(default_factory=list)
    outliers: list[OutlierColumnSummary] = field(default_factory=list)


def count_label(count: int, word: str, plural: str | None = None) -> str:
    """'1 missing value' / '3 missing values' for user-facing issue messages."""
    return f"{count} {word if count == 1 else (plural or word + 's')}"


def _is_text_series(series: pd.Series) -> bool:
    if (
        pd.api.types.is_numeric_dtype(series)
        or pd.api.types.is_bool_dtype(series)
        or pd.api.types.is_datetime64_any_dtype(series)
    ):
        return False
    return pd.api.types.is_string_dtype(series) or pd.api.types.is_object_dtype(series)


def _normalize_token(value: object) -> str:
    """Casefold + collapse whitespace. Used for pseudo-null matching."""
    return _WS_RE.sub(" ", str(value).strip()).casefold()


def _normalize_label(value: object) -> str:
    """Normalize a categorical label for grouping: trim, collapse whitespace,
    drop surrounding punctuation, casefold."""
    s = _WS_RE.sub(" ", str(value).strip())
    s = s.strip(".,;: ")
    return s.casefold()


def _date_fingerprint(value: str) -> str | None:
    for name, pattern in _DATE_FORMATS:
        if pattern.match(value):
            return name
    return None


# Words in a column name that mark it as an identifier or code (a label, not a measurement):
# "Zip Code" 8000 isn't an unusually small value, so these columns get no outlier check.
_CODE_NAME_TOKENS = {
    "zip", "zipcode", "postal", "postcode", "code", "id", "phone", "mobile", "tel",
    "contact", "account", "sku", "barcode", "isbn", "lrn", "tin",
}
_CAMEL_RE = re.compile(r"([a-z0-9])([A-Z])")
_NAME_TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")


def is_code_column(name: object) -> bool:
    """True if the column name says it holds codes/IDs ("Zip Code", "CustomerID", "phone_no")."""
    spaced = _CAMEL_RE.sub(r"\1 \2", str(name))
    return any(token in _CODE_NAME_TOKENS for token in _NAME_TOKEN_SPLIT_RE.split(spaced.casefold()))


def is_code_like(name: object, series: pd.Series) -> bool:
    """True for code/ID columns: named like one, or holding leading-zero values ("08100").

    Use before auto-treating a text column as numbers or dates: "08100" is a zip code,
    not 8100 and not the year 8100.
    """
    return is_code_column(name) or has_leading_zero_codes(series)


def preferred_label_key(label: str, count: int) -> tuple:
    """Sort key for choosing the label to show among spellings of one value.

    Most frequent first; on a tie prefer no stray spaces, then Title Case > mixed case >
    lower case > UPPER CASE ("Panabo" over "PANABO"), then the longer form ("Male" over "M").
    """
    stripped = label.strip()
    if stripped.istitle():
        casing = 0
    elif stripped.isupper():
        casing = 3
    elif stripped.islower():
        casing = 2
    else:
        casing = 1
    return (-count, label != stripped, casing, -len(stripped), label)


# --- union-find helpers (used for clustering categorical variants) ---
def _find(parent: dict[str, str], x: str) -> str:
    root = x
    while parent[root] != root:
        root = parent[root]
    while parent[x] != root:
        parent[x], x = root, parent[x]
    return root


def _union(parent: dict[str, str], a: str, b: str) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        # Deterministic: smaller string becomes the root.
        if ra <= rb:
            parent[rb] = ra
        else:
            parent[ra] = rb


def detect_categorical_variants(series: pd.Series, column: str) -> CategoryStandardizationSuggestion | None:
    """Cluster values that look like variants of one canonical value.

    Only runs on low-cardinality text columns, so high-cardinality free-text
    (e.g. a name column) is intentionally skipped.
    """
    if not _is_text_series(series):
        return None

    non_null = series.dropna()
    if non_null.empty:
        return None

    # Skip structured identifier columns (emails, URLs) — fuzzy matching would
    # incorrectly merge distinct addresses like john@co.com and jane@co.com.
    if non_null.astype(str).head(20).str.contains("@", regex=False).any():
        return None

    # Skip date-dominant columns — consecutive dates share high string similarity
    # (e.g. 2024-01-05 vs 2024-01-06 scores 0.90) and would be wrongly clustered
    # as categorical variants of each other.
    date_ratio = pd.to_datetime(non_null.astype(str).head(20), errors="coerce").notna().mean()
    if date_ratio >= 0.7:
        return None

    # Skip numeric-dominant columns — numeric strings like "500" and "1500" score
    # ~0.857 fuzzy similarity and would be wrongly clustered as categorical variants.
    numeric_ratio = pd.to_numeric(non_null.astype(str), errors="coerce").notna().mean()
    if numeric_ratio >= 0.8:
        return None

    # Skip identifier / free-text columns — when (almost) every value is distinct
    # there is no repeated category to standardize. Without this, sequential IDs
    # like ORD-2024-1051, ORD-2024-1052, … (~0.92 fuzzy similarity) get wrongly
    # clustered as variants of one category. Genuine categoricals repeat heavily,
    # so their uniqueness ratio stays far below this threshold.
    # Uniqueness is counted after ignoring case/spacing, so a small column such as
    # Male, male, M, Female, F (5 raw values, 4 labels) is still checked.
    distinct = int(non_null.map(_normalize_label).nunique())
    if len(non_null) >= 5 and distinct / len(non_null) >= 0.9:
        return None

    counts = non_null.astype(str).value_counts()
    if not (2 <= len(counts) <= _MAX_CATEGORICAL_CARDINALITY):
        return None

    originals = [str(v) for v in counts.index]
    norm_to_origs: dict[str, list[str]] = {}
    for orig in originals:
        norm_to_origs.setdefault(_normalize_label(orig), []).append(orig)

    norms = sorted(norm_to_origs.keys())
    parent = {n: n for n in norms}

    # Fuzzy-merge longer normalized forms (catches typos like "Femaie" ~ "Female").
    longish = [n for n in norms if len(n) >= 3]
    for i in range(len(longish)):
        for j in range(i + 1, len(longish)):
            if SequenceMatcher(None, longish[i], longish[j]).ratio() >= _FUZZY_THRESHOLD:
                _union(parent, longish[i], longish[j])

    # Safe abbreviation pass: a very short form (<=2 chars) links to a longer form
    # only when it is an unambiguous prefix of exactly one cluster.
    for short in [n for n in norms if 0 < len(n) <= 2]:
        candidates = [n for n in norms if n != short and len(n) > len(short) and n.startswith(short)]
        if not candidates:
            continue
        roots = {_find(parent, c) for c in candidates}
        if len(roots) == 1:
            _union(parent, short, candidates[0])

    clusters: dict[str, list[str]] = {}
    for n in norms:
        clusters.setdefault(_find(parent, n), []).append(n)

    groups: list[CategoryVariantGroup] = []
    for member_norms in clusters.values():
        origs: list[str] = []
        for mn in member_norms:
            origs.extend(norm_to_origs[mn])
        if len(origs) < 2:
            continue
        canonical = min(origs, key=lambda o: preferred_label_key(o, int(counts[o])))
        variants = sorted((o for o in origs if o != canonical), key=lambda o: (-int(counts[o]), o))
        group_counts = {o: int(counts[o]) for o in origs}
        groups.append(CategoryVariantGroup(canonical=canonical, variants=variants, counts=group_counts))

    if not groups:
        return None

    groups.sort(key=lambda g: -sum(g.counts.values()))
    return CategoryStandardizationSuggestion(column=column, groups=groups)


def detect_pseudo_nulls(series: pd.Series, column: str) -> PseudoNullSummary | None:
    """Find disguised-missing tokens (NA, N/A, 'Not applicable', ...) in a text column."""
    if not _is_text_series(series):
        return None

    non_null = series.dropna()
    if non_null.empty:
        return None

    norm = non_null.astype(str).map(_normalize_token)
    mask = norm.isin(PSEUDO_NULL_TOKENS)
    if not bool(mask.any()):
        return None

    matched = norm[mask]
    token_counts = {str(k): int(v) for k, v in matched.value_counts().items()}
    return PseudoNullSummary(column=column, tokens=token_counts, total=int(mask.sum()))


def detect_format_inconsistency(series: pd.Series, column: str) -> dict[str, object] | None:
    """Flag a column that mixes 2+ date formats (e.g. 'July 21 2005' and '07/21/2005')."""
    if not _is_text_series(series):
        return None

    non_null = series.dropna().astype(str).str.strip()
    non_null = non_null[non_null != ""]
    if len(non_null) < 2:
        return None

    sample = non_null.head(_FORMAT_SAMPLE_SIZE)
    matched = 0
    seen_families: set[str] = set()
    seen_raw: set[str] = set()
    for value in sample:
        cls = _date_fingerprint(value)
        if cls:
            matched += 1
            seen_raw.add(cls)
            seen_families.add(_FORMAT_FAMILY.get(cls, cls))

    total = len(sample)
    if total and matched / total >= 0.7 and len(seen_families) >= 2:
        return {"formats": sorted(seen_raw), "match_ratio": round(matched / total, 2)}
    return None


def detect_outliers(frame: pd.DataFrame) -> list[OutlierColumnSummary]:
    """IQR outliers per numeric column (same method as the Detect-tab anomaly view).

    Code/ID columns (see `is_code_column`) are skipped: their numbers are labels.
    """
    df = frame.copy()
    for col in df.select_dtypes(include=["object"]).columns:
        if is_code_like(col, df[col]):
            continue
        coerced = pd.to_numeric(df[col], errors="coerce")
        if coerced.notna().sum() >= 2:
            df[col] = coerced

    results: list[OutlierColumnSummary] = []
    numeric_cols = [
        c for c in df.columns
        if pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_bool_dtype(df[c]) and not is_code_column(c)
    ]
    for col in numeric_cols:
        series = df[col].dropna().astype(float)
        if len(series) < 4:
            continue
        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1
        if iqr <= 0:
            continue

        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        mask = (df[col] < lower) | (df[col] > upper)
        idx = df.index[mask & df[col].notna()]
        count = len(idx)
        if count == 0:
            continue

        samples: list[float | int | str] = []
        for value in df.loc[idx, col].dropna().head(5).tolist():
            try:
                samples.append(round(float(value), 4))
            except (TypeError, ValueError):
                samples.append(str(value))

        results.append(
            OutlierColumnSummary(
                column=str(col),
                outlier_count=count,
                lower_fence=round(lower, 4),
                upper_fence=round(upper, 4),
                sample_values=samples,
            )
        )
    return results


def analyze_quality(frame: pd.DataFrame) -> QualityFindings:
    """Run all quality detectors in a single pass."""
    findings = QualityFindings()
    if frame.empty:
        return findings

    for column in frame.columns:
        series = frame[column]
        name = str(column)
        if not _is_text_series(series):
            continue

        category = detect_categorical_variants(series, name)
        if category is not None:
            affected = sum(sum(g.counts.values()) for g in category.groups)
            findings.category_suggestions.append(category)
            findings.issues.append(
                CleaningIssue(
                    kind="categorical_variants",
                    column=name,
                    severity="warning",
                    message=f"{name} has values that look like different spellings of the same category "
                    f"({count_label(len(category.groups), 'group')}, {count_label(affected, 'cell')} affected).",
                    suggestion="Change them to one consistent spelling.",
                    details={"group_count": len(category.groups)},
                )
            )

        pseudo = detect_pseudo_nulls(series, name)
        if pseudo is not None:
            findings.pseudo_nulls.append(pseudo)
            findings.issues.append(
                CleaningIssue(
                    kind="pseudo_nulls",
                    column=name,
                    severity="warning",
                    message=f"{name} contains {count_label(pseudo.total, 'disguised blank')} "
                    f"({', '.join(sorted(pseudo.tokens))}).",
                    suggestion="Turn these into empty cells, then fill or drop them.",
                    details={"total": pseudo.total, "tokens": pseudo.tokens},
                )
            )

        fmt = detect_format_inconsistency(series, name)
        if fmt is not None:
            formats = fmt["formats"]
            findings.issues.append(
                CleaningIssue(
                    kind="format_inconsistency",
                    column=name,
                    severity="warning",
                    message=f"{name} mixes multiple date formats ({', '.join(formats)}).",
                    suggestion="Standardize the dates to a single format.",
                    details=fmt,
                )
            )

    findings.outliers = detect_outliers(frame)
    for outlier in findings.outliers:
        findings.issues.append(
            CleaningIssue(
                kind="outliers",
                column=outlier.column,
                severity="info",
                message=f"{outlier.column} has {count_label(outlier.outlier_count, 'potential outlier')} "
                f"outside the typical range ({outlier.lower_fence} to {outlier.upper_fence}).",
                suggestion="Investigate these values — they may be rare valid events or data errors. Only remove if you are confident they are mistakes.",
                details={
                    "outlier_count": outlier.outlier_count,
                    "lower_fence": outlier.lower_fence,
                    "upper_fence": outlier.upper_fence,
                },
            )
        )

    return findings
