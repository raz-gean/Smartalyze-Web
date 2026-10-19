"""Verification tests for snapshot conversion: column order and Edit-tab type restore.

Runnable two ways:
- with pytest (if installed):   pytest tests/test_dataset_snapshot.py
- standalone (no deps):         python -m tests.test_dataset_snapshot   (from the backend/ dir)
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.dataset_snapshot import (
    build_snapshot,
    restore_edited_dtypes,
    snapshot_to_dataframe,
    snapshot_to_export_bytes,
)

ORIGINAL_ORDER = ["Name", "City", "Zip Code", "Sales", "Date"]


def _jsonb_round_trip(snapshot: dict) -> dict:
    """Mimic PostgreSQL JSONB: object keys come back shortest first, then bytewise.

    Strict json.dumps (no default=) like the real column, so non-JSON values fail here too.
    """
    def reorder(value):
        if isinstance(value, dict):
            return {k: reorder(value[k]) for k in sorted(value, key=lambda k: (len(k), k))}
        if isinstance(value, list):
            return [reorder(v) for v in value]
        return value

    return reorder(json.loads(json.dumps(snapshot)))


def _sample_frame() -> pd.DataFrame:
    return pd.DataFrame({
        "Name": ["Ana", "Ben", "Cara"],
        "City": ["Panabo", "Tagum", "Panabo"],
        "Zip Code": [8105, 8100, 8105],
        "Sales": [1200.5, 950.0, 1100.0],
        "Date": pd.to_datetime(["2024-01-05", "2024-02-10", "2024-03-15"]),
    })


def _stored_snapshot() -> dict:
    snapshot = build_snapshot(_sample_frame(), source_name="t.csv", file_type="csv", size_bytes=0)
    return _jsonb_round_trip(snapshot)


# ── Column order ─────────────────────────────────────────────────────────────

def test_jsonb_round_trip_really_shuffles_record_keys():
    # Guards the test helper itself: without the fix, this is the order pandas would see.
    assert list(_stored_snapshot()["records"][0]) != ORIGINAL_ORDER


def test_snapshot_to_dataframe_keeps_original_column_order():
    assert list(snapshot_to_dataframe(_stored_snapshot()).columns) == ORIGINAL_ORDER


def test_rebuilt_snapshot_keeps_order_after_another_save():
    # e.g. Prepare apply: read stored snapshot -> transform -> build a new snapshot.
    resaved = _jsonb_round_trip(
        build_snapshot(snapshot_to_dataframe(_stored_snapshot()), source_name="t.csv", file_type="csv", size_bytes=0)
    )
    assert [c["name"] for c in resaved["columns"]] == ORIGINAL_ORDER
    assert list(snapshot_to_dataframe(resaved).columns) == ORIGINAL_ORDER


def test_csv_export_header_keeps_original_order():
    payload, _, _ = snapshot_to_export_bytes(_stored_snapshot(), export_format="csv")
    assert payload.decode("utf-8").splitlines()[0].split(",") == ORIGINAL_ORDER


def test_json_export_keys_keep_original_order_and_iso_dates():
    payload, _, _ = snapshot_to_export_bytes(_stored_snapshot(), export_format="json")
    first = json.loads(payload)[0]
    assert list(first) == ORIGINAL_ORDER
    assert first["Date"].startswith("2024-01-05T00:00:00")


def test_column_missing_from_metadata_goes_last():
    snapshot = _stored_snapshot()
    snapshot["columns"] = [c for c in snapshot["columns"] if c["name"] != "City"]
    assert list(snapshot_to_dataframe(snapshot).columns) == ["Name", "Zip Code", "Sales", "Date", "City"]


def test_snapshot_with_real_dates_is_storable_and_round_trips():
    # A datetime column (e.g. after "convert to date" or an Edit save) must be JSON-storable.
    stored = _stored_snapshot()  # raises TypeError if Timestamps leak into the snapshot
    assert stored["records"][0]["Date"] == "2024-01-05T00:00:00"
    assert pd.api.types.is_datetime64_any_dtype(snapshot_to_dataframe(stored)["Date"])


def test_edit_save_with_dates_is_storable():
    previous = _previous_columns()
    frame = restore_edited_dtypes(pd.DataFrame({"Date": ["2024-01-05T00:00:00", "2024-05-01"]}), previous)
    _jsonb_round_trip(build_snapshot(frame, source_name="t.csv", file_type="csv", size_bytes=0))


# ── Edit-tab type restore ────────────────────────────────────────────────────

def _previous_columns() -> list[dict]:
    return _stored_snapshot()["columns"]


def test_typed_number_keeps_column_numeric():
    frame = pd.DataFrame({"Sales": [1200.5, "444", None]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert pd.api.types.is_numeric_dtype(out["Sales"])
    assert out["Sales"].tolist()[:2] == [1200.5, 444.0] and pd.isna(out["Sales"].iloc[2])


def test_blank_string_counts_as_missing():
    frame = pd.DataFrame({"Sales": [1200.5, "  ", "300"]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert pd.api.types.is_numeric_dtype(out["Sales"]) and pd.isna(out["Sales"].iloc[1])


def test_real_text_in_numeric_column_is_kept_not_blanked():
    frame = pd.DataFrame({"Sales": [1200.5, "unknown", "300"]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert out["Sales"].tolist() == [1200.5, "unknown", "300"]


def test_dates_restored_after_edit():
    frame = pd.DataFrame({"Date": ["2024-01-05T00:00:00", "2024-02-10", None]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert pd.api.types.is_datetime64_any_dtype(out["Date"])
    assert out["Date"].iloc[1] == pd.Timestamp("2024-02-10")


def test_new_all_number_column_becomes_numeric():
    frame = pd.DataFrame({"Bonus": ["10", "20.5", None]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert pd.api.types.is_numeric_dtype(out["Bonus"])


def test_new_column_with_leading_zero_codes_stays_text():
    frame = pd.DataFrame({"Student ID": ["0123", "0456", "789"]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert out["Student ID"].tolist() == ["0123", "0456", "789"]


def test_text_columns_untouched():
    frame = pd.DataFrame({"Name": ["Ana", "Ben"], "City": ["Panabo", "123"]})
    out = restore_edited_dtypes(frame, _previous_columns())
    assert out["Name"].tolist() == ["Ana", "Ben"] and out["City"].tolist() == ["Panabo", "123"]


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
