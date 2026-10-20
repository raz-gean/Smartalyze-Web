"""Verification tests for date-based forecasting and trends (Predict "Date column").

Runnable two ways:
- with pytest (if installed):   pytest tests/test_predict_dates.py
- standalone (no deps):         python -m tests.test_predict_dates   (from the backend/ dir)
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.analysis_service import predict_column, trend_analysis
from app.services.dataset_snapshot import build_snapshot


def _dataset(frame: pd.DataFrame):
    snapshot = build_snapshot(frame, source_name="t.csv", file_type="csv", size_bytes=0)
    version = SimpleNamespace(id=1, data_snapshot=snapshot)
    return SimpleNamespace(current_version=version, versions=[version])


def _monthly_sales() -> pd.DataFrame:
    # Out of order on purpose; sales grow by 10 per month.
    return pd.DataFrame({
        "Month": ["2024-03-01", "2024-01-01", "2024-06-01", "2024-02-01", "2024-05-01", "2024-04-01"],
        "Sales": [120.0, 100.0, 150.0, 110.0, 140.0, 130.0],
    })


def test_monthly_forecast_steps_by_month_with_date_labels():
    result = predict_column(_dataset(_monthly_sales()), "Month", "Sales", 3, time_column="Month")
    assert result.time_column == "Month"
    # Monthly data steps by calendar month, so labels stay on the 1st (no day drift).
    assert [p.label for p in result.predictions] == ["2024-07-01", "2024-08-01", "2024-09-01"], result.predictions
    # About +10 per month: the next three months continue the line.
    values = [p.predicted_value for p in result.predictions]
    assert 155 < values[0] < 165 and 165 < values[1] < 175 and 175 < values[2] < 185, values


def test_text_dates_are_sorted_as_dates_not_strings():
    # As text, "01/15/2024" < "02/15/2024" < "12/01/2023", which would put December last.
    frame = pd.DataFrame({
        "Date": ["01/15/2024", "12/01/2023", "02/15/2024", "11/01/2023"],
        "Sales": [300.0, 200.0, 400.0, 100.0],
    })
    result = predict_column(_dataset(frame), "Date", "Sales", 1, time_column="Date")
    assert result.slope > 0, result.slope  # rising over time once sorted chronologically
    trend = trend_analysis(_dataset(frame), time_column="Date").columns[0]
    assert trend.x_labels == ["Nov 01", "Dec 01", "Jan 15", "Feb 15"], trend.x_labels


def test_unparseable_date_row_is_dropped_not_crashing():
    frame = _monthly_sales()
    frame.loc[len(frame)] = {"Month": "not a date", "Sales": 999.0}
    result = predict_column(_dataset(frame), "Month", "Sales", 1, time_column="Month")
    assert result.predictions[0].label.startswith("2024-07")
    assert result.predictions[0].predicted_value < 200  # the junk row's 999 was not used


def test_without_date_column_behaviour_is_unchanged():
    result = predict_column(_dataset(_monthly_sales()), "Sales", "Sales", 2)
    assert result.time_column is None
    assert all(p.label is None for p in result.predictions)
    assert [p.step for p in result.predictions] == [1, 2]


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
