"""Verification tests for Explore → Aggregation's suggested groupings (Objective 4).

Runnable two ways:
- with pytest (if installed):   pytest tests/test_grouping_suggestions.py
- standalone (no deps):         python -m tests.test_grouping_suggestions   (from the backend/ dir)
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.analysis_service import group_dataset
from app.services.dataset_snapshot import build_snapshot
from app.services.grouping_suggestion_service import eta_squared, suggest_groupings
from app.services.structure_service import compute_structure_summary


def _shop(rows_per_region: int = 10, seed: int = 3) -> pd.DataFrame:
    """Sales depend strongly on Region; Channel barely matters."""
    rng = np.random.default_rng(seed)
    frames = []
    for region, base in [("North", 100.0), ("South", 160.0), ("East", 220.0)]:
        frames.append(pd.DataFrame({
            "Region": [region] * rows_per_region,
            "Channel": rng.choice(["Online", "Store"], rows_per_region),
            "Sales": base + rng.normal(0, 10, rows_per_region),
        }))
    return pd.concat(frames, ignore_index=True)


def test_eta_squared_matches_one_way_anova():
    frame = _shop()
    groups = [g["Sales"].to_numpy() for _, g in frame.groupby("Region")]
    f_stat, _ = stats.f_oneway(*groups)
    df_between, df_within = len(groups) - 1, len(frame) - len(groups)
    expected = f_stat * df_between / (f_stat * df_between + df_within)  # η² from the ANOVA F test
    assert abs(eta_squared(frame["Region"], frame["Sales"]) - expected) < 1e-9


def test_strong_grouping_is_suggested_first_and_weak_one_left_out():
    suggestions = suggest_groupings(_shop())
    first = suggestions[0]
    assert (first["group_by"], first["aggregate_column"], first["aggregate_func"]) == ("Region", "Sales", "mean"), first
    assert first["strength_label"] == "strong" and first["title"] == "Average Sales by Region"
    assert "explains about" in first["reason"]
    assert not any(s["group_by"] == "Channel" and s["aggregate_func"] == "mean" for s in suggestions), suggestions
    assert suggestions[-1]["aggregate_func"] == "count" and suggestions[-1]["group_by"] == "Region"


def test_ids_and_codes_are_never_suggested():
    frame = _shop()
    frame["Order ID"] = [f"ORD-{n}" for n in range(len(frame))]   # one group per row
    frame["Zip Code"] = np.where(frame["Region"] == "North", 8105, 8100)  # a code, not an amount
    used = {s["group_by"] for s in suggest_groupings(frame)} | {s["aggregate_column"] for s in suggest_groupings(frame)}
    assert "Order ID" not in used and "Zip Code" not in used, used


def test_numbers_only_dataset_has_no_suggestions():
    frame = pd.DataFrame({"A": range(30), "B": np.arange(30) * 2.0})
    assert suggest_groupings(frame) == []


def test_only_weak_relationships_still_offer_a_row_count():
    rng = np.random.default_rng(1)
    frame = pd.DataFrame({"Team": rng.choice(["Red", "Blue", "Green"], 60), "Score": rng.normal(50, 5, 60)})
    if eta_squared(frame["Team"], frame["Score"]) >= 0.06:  # keep the test about the weak case
        frame["Score"] = 50.0 + np.arange(60) % 7
    suggestions = suggest_groupings(frame)
    assert [s["aggregate_func"] for s in suggestions] == ["count"], suggestions
    assert suggestions[0]["title"] == "Number of rows by Team"


def test_limits_three_averages_and_two_per_group_column():
    frame = _shop()
    for name, shift in [("Profit", 0.3), ("Units", 0.1), ("Returns", 0.05)]:
        frame[name] = frame["Sales"] * shift
    averages = [s for s in suggest_groupings(frame) if s["aggregate_func"] == "mean"]
    assert len(averages) <= 3
    assert sum(s["group_by"] == "Region" for s in averages) <= 2, averages


def test_suggestions_run_in_the_aggregation_as_shown():
    frame = _shop()
    snapshot = build_snapshot(frame, source_name="s.csv", file_type="csv")
    version = SimpleNamespace(id=1, data_snapshot=snapshot)
    dataset = SimpleNamespace(current_version=version, versions=[version])
    for suggestion in compute_structure_summary(frame)["grouping_suggestions"]:
        result = group_dataset(dataset, suggestion["group_by"], suggestion["aggregate_column"], suggestion["aggregate_func"])
        assert result.total_groups == frame[suggestion["group_by"]].nunique(), (suggestion, result.total_groups)


def test_empty_group_is_labelled_in_words_not_nan():
    frame = pd.DataFrame({"Region": ["North", None, "South", "North"], "Sales": [10.0, 20.0, 30.0, 40.0]})
    snapshot = build_snapshot(frame, source_name="s.csv", file_type="csv")
    version = SimpleNamespace(id=1, data_snapshot=snapshot)
    dataset = SimpleNamespace(current_version=version, versions=[version])
    groups = {r.group: r.value for r in group_dataset(dataset, "Region", "Sales", "mean").results}
    assert groups == {"North": 25.0, "(empty)": 20.0, "South": 30.0}, groups


def test_text_dates_are_reported_as_dates_saved_as_text():
    frame = pd.DataFrame({"Joined": ["2024-01-05", "2024-02-11", "2024-03-02", "2024-04-01"], "Name": list("ABCD")})
    kinds = {c["name"]: c["kind"] for c in compute_structure_summary(frame)["columns"]}
    assert kinds == {"Joined": "datetime_string", "Name": "text"}, kinds


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
