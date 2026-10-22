"""Cleaning routes.

These endpoints run "analysis" on a dataset snapshot and apply cleaning operations.
The backend stores datasets as snapshots (JSON) and converts snapshots <-> DataFrames
as needed for operations.

Endpoints:
- POST /clean/detect: compute missing values, duplicates, inferred types, and issues
- POST /clean/apply: apply cleaning operations and return a new snapshot (not auto-saved)
"""

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.db.session import get_db
from app.schemas.cleaning import CleanApplyRequest, CleanApplyResponse, CleanDetectRequest, CleanDetectResponse
from app.services.auth_service import get_user_by_token
from app.services.cleaning_service import (
    apply_cleaning_operations,
    analyze_cleaning_frame,
    build_cleaning_result_snapshot,
    detect_cleaning_issues,
)
from app.services.dataset_snapshot import snapshot_to_dataframe
from app.services.dataset_service import get_owned_dataset
from app.services.pattern_imputation_service import find_pattern_suggestions

router = APIRouter(prefix="/clean", tags=["cleaning"])


def _get_current_token(authorization: str | None) -> str:
    """Extract a Bearer token from the Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    return authorization.removeprefix("Bearer ").strip()


@router.post("/detect", response_model=CleanDetectResponse)
async def detect_cleaning(
    payload: CleanDetectRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Analyze a dataset snapshot and return detected data quality issues."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    version, missing_values, duplicates, column_types, issues, pattern_suggestions, findings = await detect_cleaning_issues(
        db,
        dataset,
        payload.dataset_version_id,
    )

    # Persist scan-derived issue counts into the version's summary so the dashboard
    # can use them for the deduction-based health score without requiring a re-scan.
    type_issue_cols = len({
        i.column for i in issues
        if i.kind in ("type_inconsistency", "format_inconsistency")
        and i.column
        and i.severity != "info"
    })
    pseudo_null_cols = len(findings.pseudo_nulls or [])
    variant_cols = len(findings.category_suggestions or [])
    outlier_cols = len(findings.outliers or [])

    existing_summary = version.data_snapshot.get("summary") or {}
    version.data_snapshot = {
        **version.data_snapshot,
        "summary": {
            **existing_summary,
            "type_issue_columns": type_issue_cols,
            "pseudo_null_columns": pseudo_null_cols,
            "variant_columns": variant_cols,
            "outlier_columns": outlier_cols,
            "scan_completed": True,
        },
    }
    flag_modified(version, "data_snapshot")
    await db.commit()

    return {
        "dataset_id": dataset.id,
        "dataset_version_id": version.id,
        "missing_values": missing_values,
        "duplicates": duplicates,
        "column_types": column_types,
        "issues": issues,
        "pattern_suggestions": pattern_suggestions,
        "category_suggestions": findings.category_suggestions,
        "pseudo_nulls": findings.pseudo_nulls,
        "outliers": findings.outliers,
        "summary": version.data_snapshot["summary"],
    }


@router.post("/apply", response_model=CleanApplyResponse)
async def apply_cleaning(
    payload: CleanApplyRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Apply cleaning operations and return the cleaned snapshot.

This does not persist anything by itself; the frontend can later call the save-result
endpoint to replace the dataset or save as a new dataset.
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    version, missing_values, duplicates, column_types, issues, _pattern_suggestions, _findings = await detect_cleaning_issues(
        db,
        dataset,
        payload.dataset_version_id,
    )

    frame = snapshot_to_dataframe(version.data_snapshot)
    cleaned_frame, applied_operations, unparseable_dates = apply_cleaning_operations(
        frame, payload.cleaning_operations
    )
    cleaned_snapshot = build_cleaning_result_snapshot(
        cleaned_frame,
        source_name=dataset.name,
        file_type=dataset.file_type,
    )

    cleaned_missing_values, cleaned_duplicates, cleaned_column_types, cleaned_issues, cleaned_findings = analyze_cleaning_frame(cleaned_frame)
    cleaned_cols_with_missing = [col for col, count in cleaned_missing_values.items() if count > 0]
    cleaned_pattern_suggestions = find_pattern_suggestions(cleaned_frame, cleaned_cols_with_missing)
    summary = dict(cleaned_snapshot["summary"])
    if unparseable_dates:
        summary["unparseable_dates"] = unparseable_dates
    return {
        "dataset_id": dataset.id,
        "dataset_version_id": version.id,
        "source_version_id": version.id,
        "operations_applied": applied_operations,
        "missing_values": cleaned_missing_values,
        "duplicates": cleaned_duplicates,
        "column_types": cleaned_column_types,
        "issues": cleaned_issues,
        "pattern_suggestions": cleaned_pattern_suggestions,
        "category_suggestions": cleaned_findings.category_suggestions,
        "pseudo_nulls": cleaned_findings.pseudo_nulls,
        "outliers": cleaned_findings.outliers,
        "preview": cleaned_snapshot["preview"],
        "summary": summary,
        "data_snapshot": cleaned_snapshot,
    }