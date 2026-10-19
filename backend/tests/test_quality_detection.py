"""Verification tests for quality detection + the new cleaning operations.

Runnable two ways:
- with pytest (if installed):   pytest tests/test_quality_detection.py
- standalone (no deps):         python -m tests.test_quality_detection   (from the backend/ dir)
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from types import SimpleNamespace

from app.schemas.cleaning import CleaningOperation
from app.services.analysis_service import anomaly_detection
from app.services.cleaning_service import _apply_operation, _order_operations, apply_cleaning_operations
from app.services.dataset_snapshot import build_snapshot
from app.services.pattern_imputation_service import apply_pattern_fill, find_pattern_suggestions
from app.services.quality_detection_service import (
    analyze_quality,
    detect_categorical_variants,
    detect_format_inconsistency,
    detect_outliers,
    detect_pseudo_nulls,
    is_code_column,
)


def test_categorical_variants_collapses_gender():
    series = pd.Series(["Male", "male", "M", "Female", "F", "Female", "Male", "Male"])
    result = detect_categorical_variants(series, "gender")
    assert result is not None, "expected a suggestion for mixed gender labels"
    canon = {g.canonical: set(g.variants) for g in result.groups}
    # Male is most frequent -> canonical; M and male are its variants.
    assert "Male" in canon and {"M", "male"}.issubset(canon["Male"]), canon
    # Female group with F as a variant.
    assert "Female" in canon and "F" in canon["Female"], canon


def test_categorical_variants_skips_high_cardinality_names():
    names = pd.Series([f"person_{i}" for i in range(60)])
    assert detect_categorical_variants(names, "name") is None


def test_categorical_variants_ambiguous_abbrev_not_merged():
    # "M" is a prefix of both "Male" and "Married" -> must NOT auto-merge.
    series = pd.Series(["Male", "Married", "M", "Male", "Married"])
    result = detect_categorical_variants(series, "status")
    if result is not None:
        for g in result.groups:
            members = {g.canonical, *g.variants}
            assert not ({"Male", "Married"} <= members), "Male and Married must not be merged"


def test_pseudo_nulls_detected_in_name_column():
    series = pd.Series(["juan", "angel", "NA", "Not applicable", "joaqin", "-"])
    result = detect_pseudo_nulls(series, "name")
    assert result is not None
    assert result.total == 3, result.tokens
    assert "na" in result.tokens and "not applicable" in result.tokens


def test_format_inconsistency_mixed_dates():
    series = pd.Series(["July 21 2005", "07/21/2005", "2005-07-21", "08/01/2005"])
    result = detect_format_inconsistency(series, "dob")
    assert result is not None
    assert len(result["formats"]) >= 2, result


def test_format_inconsistency_single_format_ok():
    series = pd.Series(["2005-07-21", "2006-01-02", "2007-03-04"])
    assert detect_format_inconsistency(series, "dob") is None


def test_outliers_flag_extreme_value():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    results = detect_outliers(frame)
    assert any(o.column == "amount" and o.outlier_count >= 1 for o in results), results


def test_op_standardize_categories():
    frame = pd.DataFrame({"gender": ["M", "male", "Female", "F"]})
    op = CleaningOperation(
        operation_type="standardize_categories",
        column="gender",
        value_mapping={"M": "Male", "male": "Male", "F": "Female"},
    )
    out = _apply_operation(frame.copy(), op)
    assert out["gender"].tolist() == ["Male", "Male", "Female", "Female"]


def test_op_replace_with_missing():
    frame = pd.DataFrame({"name": ["juan", "NA", "Not applicable", "angel"]})
    op = CleaningOperation(operation_type="replace_with_missing", column="name")
    out = _apply_operation(frame.copy(), op)
    assert out["name"].isna().sum() == 2
    assert out["name"].tolist()[0] == "juan" and out["name"].tolist()[3] == "angel"


def test_op_remove_outliers():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    op = CleaningOperation(operation_type="remove_outliers", column="amount")
    out = _apply_operation(frame.copy(), op)
    assert 1000 not in out["amount"].tolist()
    assert len(out) == len(frame) - 1


def test_op_nullify_outliers_blanks_only_outlier_keeps_rows():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    op = CleaningOperation(operation_type="nullify_outliers", column="amount")
    out = _apply_operation(frame.copy(), op)
    assert len(out) == len(frame), "rows must be preserved"
    assert out["amount"].isna().sum() == 1
    assert out["amount"].dropna().tolist() == [10, 11, 12, 13, 12, 11, 10, 9]


def test_order_operations_sorts_bad_queue():
    ops = [
        CleaningOperation(operation_type="fill_median", column="x"),
        CleaningOperation(operation_type="sort_values", column="x"),
        CleaningOperation(operation_type="convert_column_type", column="x", target_type="numeric"),
        CleaningOperation(operation_type="replace_with_missing", column="x"),
        CleaningOperation(operation_type="remove_all_duplicates"),
    ]
    ordered = [o.operation_type for o in _order_operations(ops)]
    assert ordered.index("remove_all_duplicates") < ordered.index("convert_column_type")
    assert ordered.index("convert_column_type") < ordered.index("fill_median")
    assert ordered.index("replace_with_missing") < ordered.index("fill_median")
    assert ordered[-1] == "sort_values"


def test_fill_median_auto_coerces_numeric_string():
    # numbers stored as text — previously raised and failed the whole batch.
    frame = pd.DataFrame({"price": ["10", "20", "30", None, "40"]})
    op = CleaningOperation(operation_type="fill_median", columns=["price"])
    out = _apply_operation(frame.copy(), op)
    assert out["price"].isna().sum() == 0
    assert out["price"].tolist() == [10, 20, 30, 25, 40]


def test_nullify_then_fill_replaces_outlier_with_clean_median():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    ops = [
        CleaningOperation(operation_type="fill_median", column="amount"),
        CleaningOperation(operation_type="nullify_outliers", column="amount"),
    ]
    out, _applied, _unparseable = apply_cleaning_operations(frame, ops)
    # Ordering must run nullify before fill, so the 1000 becomes the clean median (11).
    assert len(out) == len(frame)
    assert 1000 not in out["amount"].tolist()
    assert out["amount"].iloc[-1] == 11


def test_analyze_quality_combined():
    frame = pd.DataFrame(
        {
            "gender": ["Male", "male", "M", "Female", "F"],
            "name": ["juan", "angel", "NA", "joaqin", "Not applicable"],
            "dob": ["July 21 2005", "07/21/2005", "2005-07-21", "08/01/2005", "2006-02-02"],
            "amount": [10, 11, 12, 13, 1000],
        }
    )
    findings = analyze_quality(frame)
    kinds = {i.kind for i in findings.issues}
    assert "categorical_variants" in kinds
    assert "pseudo_nulls" in kinds
    assert "format_inconsistency" in kinds
    assert "outliers" in kinds


# ── Smart fill (pattern imputation): panel example City -> Zip Code ─────────────

def _city_zip(known_per_city: int, missing_per_city: int) -> pd.DataFrame:
    rows = []
    for city, zip_code in [("Panabo", 8105.0), ("Tagum", 8100.0)]:
        rows += [{"City": city, "Zip Code": zip_code}] * known_per_city
        rows += [{"City": city, "Zip Code": None}] * missing_per_city
    return pd.DataFrame(rows)


def _city_zip_suggestion(frame: pd.DataFrame):
    hits = [s for s in find_pattern_suggestions(frame, ["Zip Code"]) if s.key_column == "City"]
    return hits[0] if hits else None


def test_smart_fill_suggests_when_most_values_missing():
    frame = _city_zip(known_per_city=2, missing_per_city=8)  # 80% of zips missing
    assert _city_zip_suggestion(frame) is not None
    out = apply_pattern_fill(frame, "City", "Zip Code")
    assert set(out.loc[frame["City"] == "Panabo", "Zip Code"]) == {8105.0}
    assert set(out.loc[frame["City"] == "Tagum", "Zip Code"]) == {8100.0}


def test_smart_fill_handles_many_cities():
    cities = [f"City{i}" for i in range(60)]
    frame = pd.DataFrame({"City": cities * 4, "Zip Code": [1000.0 + i for i in range(60)] * 3 + [None] * 60})
    assert _city_zip_suggestion(frame) is not None


def test_smart_fill_groups_spelling_variants():
    frame = pd.DataFrame({
        "City": ["Panabo"] * 5 + ["panabo", "PANABO "] + ["Tagum"] * 5 + ["tagum"],
        "Zip Code": [8105.0] * 5 + [None, None] + [8100.0] * 5 + [None],
    })
    suggestion = _city_zip_suggestion(frame)
    assert suggestion is not None
    assert {g.key_value for g in suggestion.groups} == {"Panabo", "Tagum"}  # most common spelling shown
    out = apply_pattern_fill(frame, "City", "Zip Code")
    assert out["Zip Code"].tolist() == [8105.0] * 7 + [8100.0] * 6


def test_smart_fill_ignores_id_like_key():
    frame = pd.DataFrame({
        "Customer ID": [f"C{i:03d}" for i in range(20)],
        "Zip Code": [8105.0] * 15 + [None] * 5,
    })
    assert not [s for s in find_pattern_suggestions(frame, ["Zip Code"]) if s.key_column == "Customer ID"]


def test_smart_fill_skips_inconsistent_relationship():
    frame = pd.DataFrame({
        "City": ["Panabo"] * 8 + ["Tagum"] * 8,
        "Zip Code": [8105.0, 8106.0, 8107.0, 8108.0, 8105.0, 8109.0, None, None] * 2,
    })
    assert _city_zip_suggestion(frame) is None


def test_smart_fill_works_on_small_dataset_with_mostly_unique_cities():
    # 20 rows, 12 distinct cities: 4 repeat (2 known zips + 1 missing each), 8 appear once.
    rows = []
    for i, city in enumerate(["Panabo", "Tagum", "Davao", "Samal"]):
        zip_code = 8100.0 + i
        rows += [{"City": city, "Zip Code": zip_code}] * 2 + [{"City": city, "Zip Code": None}]
    rows += [{"City": f"Town{i}", "Zip Code": 9000.0 + i} for i in range(8)]
    assert _city_zip_suggestion(pd.DataFrame(rows)) is not None


def test_smart_fill_ignores_near_constant_target():
    # Country is "PH" almost everywhere, whatever the City: City adds no information.
    frame = pd.DataFrame({
        "City": ["Panabo"] * 10 + ["Tagum"] * 10 + ["Davao"] * 10,
        "Country": ["PH"] * 8 + ["US", None] + ["PH"] * 9 + [None] + ["PH"] * 9 + [None],
    })
    assert not [s for s in find_pattern_suggestions(frame, ["Country"]) if s.key_column == "City"]


def test_smart_fill_needs_two_cities_with_evidence():
    # Only Panabo has known zips (2 of them); Tagum is all missing. Too little to call a pattern.
    frame = pd.DataFrame({
        "City": ["Panabo"] * 3 + ["Tagum"] * 3,
        "Zip Code": [8105.0, 8105.0, None, None, None, None],
    })
    assert _city_zip_suggestion(frame) is None


def test_smart_fill_keeps_rows_with_blank_key_untouched():
    frame = _city_zip(known_per_city=3, missing_per_city=2)
    frame.loc[len(frame)] = {"City": None, "Zip Code": None}
    out = apply_pattern_fill(frame, "City", "Zip Code")
    assert pd.isna(out["Zip Code"].iloc[-1])


# ── Code/ID columns and label preference ─────────────────────────────────────

def test_is_code_column_matches_identifier_names():
    for name in ["Zip Code", "zipcode", "CustomerID", "student_id", "Phone No", "Postal Code", "LRN"]:
        assert is_code_column(name), name
    for name in ["Sales", "Paid Amount", "Valid", "Number of items", "Hotel Rate", "Age"]:
        assert not is_code_column(name), name


def _sales_with_outlier_and_zip() -> pd.DataFrame:
    return pd.DataFrame({
        "Zip Code": [8105, 8100, 8105, 8000, 8100, 8105, 8100, 9999],
        "Sales": [100, 110, 105, 98, 102, 107, 99, 900],
    })


def test_outlier_detection_skips_code_columns():
    flagged = {o.column for o in detect_outliers(_sales_with_outlier_and_zip())}
    assert flagged == {"Sales"}, flagged


def test_detect_tab_anomalies_skip_code_columns():
    snapshot = build_snapshot(_sales_with_outlier_and_zip(), source_name="t.csv", file_type="csv", size_bytes=0)
    version = SimpleNamespace(id=1, data_snapshot=snapshot)
    dataset = SimpleNamespace(current_version=version, versions=[version])
    assert [c.column for c in anomaly_detection(dataset).columns] == ["Sales"]


def test_category_variants_prefer_title_case_on_tie():
    series = pd.Series(["PANABO", "Panabo", "panabo", "Panabo ", "Tagum", "Tagum", "Davao", "Davao"])
    result = detect_categorical_variants(series, "City")
    assert result is not None
    canon = {g.canonical for g in result.groups}
    assert "Panabo" in canon, canon


def test_smart_fill_key_shown_in_best_spelling():
    frame = pd.DataFrame({
        "City": ["PANABO", "Panabo", "PANABO", "Panabo", "Tagum", "TAGUM", "Tagum", "tagum"],
        "Zip Code": [8105.0, 8105.0, None, None, 8100.0, 8100.0, None, None],
    })
    suggestion = _city_zip_suggestion(frame)
    assert suggestion is not None
    assert {g.key_value for g in suggestion.groups} == {"Panabo", "Tagum"}


def _run_all():
    tests = [fn for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    passed = 0
    for fn in tests:
        try:
            fn()
        except AssertionError as exc:
            print(f"FAIL  {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR {fn.__name__}: {type(exc).__name__}: {exc}")
        else:
            passed += 1
            print(f"PASS  {fn.__name__}")
    print(f"\n{passed}/{len(tests)} passed")
    return passed == len(tests)


if __name__ == "__main__":
    sys.exit(0 if _run_all() else 1)
