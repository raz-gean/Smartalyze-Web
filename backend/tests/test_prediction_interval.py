"""Verification tests for the Predict tab's forecast range (95% prediction interval).

Runnable two ways:
- with pytest (if installed):   pytest tests/test_prediction_interval.py
- standalone (no deps):         python -m tests.test_prediction_interval   (from the backend/ dir)
"""

import math
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.analysis_service import predict_column
from app.services.dataset_snapshot import build_snapshot


def _dataset(frame: pd.DataFrame):
    snapshot = build_snapshot(frame, source_name="t.csv", file_type="csv", size_bytes=0)
    version = SimpleNamespace(id=1, data_snapshot=snapshot)
    return SimpleNamespace(current_version=version, versions=[version])


SALES = [100.0, 107.0, 108.0, 108.0, 116.0, 117.0, 130.0, 146.0, 136.0, 140.0, 154.0, 158.0]


def _reference_interval(x: np.ndarray, y: np.ndarray, x0: float) -> tuple[float, float, float]:
    """Textbook 95% prediction interval, computed independently with scipy.stats.linregress."""
    fit = stats.linregress(x, y)
    n = len(y)
    residuals = y - (fit.intercept + fit.slope * x)
    s = math.sqrt(float(np.sum(residuals ** 2)) / (n - 2))
    t = stats.t.ppf(0.975, n - 2)
    sxx = float(np.sum((x - x.mean()) ** 2))
    half = t * s * math.sqrt(1 + 1 / n + (x0 - x.mean()) ** 2 / sxx)
    mean = fit.intercept + fit.slope * x0
    return mean, mean - half, mean + half


def test_bounds_match_textbook_95_prediction_interval():
    result = predict_column(_dataset(pd.DataFrame({"Sales": SALES})), "Sales", "Sales", 6)
    assert result.interval_level == 0.95
    x = np.arange(len(SALES), dtype=float)
    for p in result.predictions:
        mean, lower, upper = _reference_interval(x, np.array(SALES), len(SALES) - 1 + p.step)
        assert abs(p.predicted_value - mean) < 1e-3, (p.step, p.predicted_value, mean)
        assert abs(p.lower_bound - lower) < 1e-3, (p.step, p.lower_bound, lower)
        assert abs(p.upper_bound - upper) < 1e-3, (p.step, p.upper_bound, upper)


def test_range_widens_for_forecasts_further_ahead():
    result = predict_column(_dataset(pd.DataFrame({"Sales": SALES})), "Sales", "Sales", 12)
    widths = [p.upper_bound - p.lower_bound for p in result.predictions]
    assert all(b > a for a, b in zip(widths, widths[1:])), widths


def test_date_column_interval_uses_days_as_x():
    frame = pd.DataFrame({
        "Month": [f"2024-{m:02d}-01" for m in range(1, 13)],
        "Sales": SALES,
    })
    result = predict_column(_dataset(frame), "Month", "Sales", 3, time_column="Month")
    dates = pd.to_datetime(frame["Month"])
    x = (dates - dates.min()).dt.days.to_numpy(dtype=float)
    for p in result.predictions:
        x0 = float((pd.Timestamp(p.label) - dates.min()).days)
        _, lower, upper = _reference_interval(x, np.array(SALES), x0)
        assert abs(p.lower_bound - lower) < 1e-3 and abs(p.upper_bound - upper) < 1e-3, (p, lower, upper)


def test_two_values_give_a_forecast_without_a_range():
    result = predict_column(_dataset(pd.DataFrame({"Sales": [10.0, 20.0]})), "Sales", "Sales", 2)
    assert result.interval_level is None
    assert [p.predicted_value for p in result.predictions] == [30.0, 40.0]
    assert all(p.lower_bound == p.predicted_value == p.upper_bound for p in result.predictions)


def test_all_values_on_one_date_use_a_mean_only_interval():
    # No spread in dates: the forecast is the mean, and its range is the usual
    # interval for one new value, mean +/- t(0.975, n-1) * sample std * sqrt(1 + 1/n).
    values = [10.0, 20.0, 30.0, 40.0]
    frame = pd.DataFrame({"Month": ["2024-01-01"] * 4, "Sales": values})
    result = predict_column(_dataset(frame), "Month", "Sales", 1, time_column="Month")
    p = result.predictions[0]
    n, mean, sd = len(values), float(np.mean(values)), float(np.std(values, ddof=1))
    half = stats.t.ppf(0.975, n - 1) * sd * math.sqrt(1 + 1 / n)
    assert result.interval_level == 0.95
    assert abs(p.predicted_value - mean) < 1e-3, p
    assert abs(p.lower_bound - (mean - half)) < 1e-3 and abs(p.upper_bound - (mean + half)) < 1e-3, (p, mean, half)


def test_about_95_percent_of_real_values_fall_inside_the_range():
    # Simulate data that truly follows a line plus noise; the next real value should
    # land inside the step-1 range about 95% of the time (the old +/- 1 SE band: ~60%).
    rng = np.random.default_rng(7)
    trials, hits = 600, 0
    for _ in range(trials):
        y = 100 + 5 * np.arange(12) + rng.normal(0, 8, 12)
        p = predict_column(_dataset(pd.DataFrame({"Sales": y})), "Sales", "Sales", 1).predictions[0]
        actual = 100 + 5 * 12 + rng.normal(0, 8)
        hits += p.lower_bound <= actual <= p.upper_bound
    coverage = hits / trials
    assert 0.92 <= coverage <= 0.98, coverage


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
