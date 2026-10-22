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


# ── Upload keeps leading-zero codes ──────────────────────────────────────────

from app.services.cleaning_service import _infer_column_type  # noqa: E402
from app.services.dataset_service import _read_dataframe  # noqa: E402

UPLOAD_CSV = b"Name,Zip Code,Sales,Active\nAna,08100,1200,True\nBen,8105,950,False\nCara,,1100,True\n"
UPLOAD_JSON = (
    b'[{"Name":"Ana","Zip Code":"08100","Sales":1200},'
    b'{"Name":"Ben","Zip Code":"8105","Sales":950}]'
)


def test_csv_upload_keeps_leading_zero_codes():
    frame, _ = _read_dataframe(UPLOAD_CSV, "people.csv")
    assert frame["Zip Code"].tolist()[:2] == ["08100", "8105"], frame["Zip Code"].tolist()
    assert pd.isna(frame["Zip Code"].iloc[2])


def test_csv_upload_still_parses_numbers_and_booleans():
    frame, _ = _read_dataframe(UPLOAD_CSV, "people.csv")
    assert pd.api.types.is_numeric_dtype(frame["Sales"])
    assert pd.api.types.is_bool_dtype(frame["Active"])


def test_json_upload_keeps_leading_zero_codes():
    frame, _ = _read_dataframe(UPLOAD_JSON, "people.json")
    assert frame["Zip Code"].tolist() == ["08100", "8105"], frame["Zip Code"].tolist()
    assert pd.api.types.is_numeric_dtype(frame["Sales"])


def test_code_columns_not_suggested_for_number_or_date_conversion():
    # "08100" also parses as the year 8100, so code columns must skip the date check too.
    for series in [
        pd.Series(["08100", "08105", "8000"], name="Zip Code"),
        pd.Series(["08100", "08105", "09000"], name="Ref"),
        pd.Series(["123", "456", "789"], name="Student ID"),
    ]:
        assert _infer_column_type(series) not in ("numeric_string", "datetime_string"), series.name
    assert _infer_column_type(pd.Series(["12", "45", "7.5"], name="Price")) == "numeric_string"
    assert _infer_column_type(pd.Series(["2024-01-05", "2024-02-10"], name="Date")) == "datetime_string"
    # Dates written with a leading zero are dates, not codes.
    assert _infer_column_type(pd.Series(["03/01/2024", "01/15/2024", "12/01/2024"], name="Month")) == "datetime_string"


def test_explore_and_detect_views_do_not_treat_zip_codes_as_numbers():
    from types import SimpleNamespace

    from app.services.analysis_service import anomaly_detection, trend_analysis
    from app.services.correlation_service import compute_correlation
    from app.services.structure_service import compute_structure_summary

    frame, _ = _read_dataframe(
        b"Ref,Sales,Units\n08100,100,1\n08105,110,2\n08100,105,3\n09000,98,4\n08105,900,5\n", "s.csv"
    )
    snapshot = _jsonb_round_trip(build_snapshot(frame, source_name="s.csv", file_type="csv", size_bytes=0))
    version = SimpleNamespace(id=1, data_snapshot=snapshot)
    dataset = SimpleNamespace(current_version=version, versions=[version])
    assert "Ref" not in [c.column for c in trend_analysis(dataset).columns]
    assert "Ref" not in [c.column for c in anomaly_detection(dataset).columns]
    assert "Ref" not in compute_correlation(dataset).columns
    kinds = {c["name"]: c["kind"] for c in compute_structure_summary(snapshot_to_dataframe(snapshot))["columns"]}
    assert kinds["Ref"] != "numeric" and kinds["Sales"] == "numeric", kinds


def test_saved_versions_get_their_size_as_a_csv_file():
    frame = pd.DataFrame({"Name": ["Ana", "Ben"], "Sales": [100, 250]})
    snapshot = build_snapshot(frame, source_name="s.csv", file_type="csv")  # cleaned/edited: no file size given
    expected = len(snapshot_to_export_bytes(snapshot, export_format="csv")[0])  # same as the CSV download
    assert snapshot["size_bytes"] == expected and snapshot["summary"]["size_bytes"] == expected, (snapshot["summary"], expected)
    uploaded = build_snapshot(frame, source_name="s.csv", file_type="csv", size_bytes=999)  # upload keeps file size
    assert uploaded["summary"]["size_bytes"] == 999


def test_timestamps_are_sent_as_utc():
    from datetime import datetime

    from app.schemas.dataset import DatasetVersionSummary

    summary = DatasetVersionSummary(
        id=1, dataset_id=1, version_number=1, operation_type="manual_edit",
        created_at=datetime(2026, 10, 22, 3, 0),  # stored naive, in UTC
    )
    assert json.loads(summary.model_dump_json())["created_at"] == "2026-10-22T03:00:00Z"


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
