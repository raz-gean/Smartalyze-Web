"""Dataset routes.

Public API endpoints used by the frontend:
- POST /upload: upload a file and create a Dataset + initial snapshot
- GET /datasets: list the current user's datasets
- GET /dataset/{id}: "workspace" view for a dataset (dataset + warnings/suggestions)
- POST /dataset/{id}/result: simplified save flow (replace current vs save as new dataset)
- DELETE /dataset/{id}: delete a dataset owned by the current user
- PATCH /dataset/{id}/rename: rename a dataset owned by the current user

Notes:
- Ownership is enforced by `get_owned_dataset()` in the service layer.
- The UI does not expose dataset "version history"; snapshots are internal.
"""

import os
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status

_ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".png", ".jpg", ".jpeg"}
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.dataset_version import DatasetVersion
from app.schemas.dataset import (
    CreateDatasetVersionRequest,
    DatasetVersionDetail,
    DatasetVersionSummary,
    DeleteDatasetResponse,
    DatasetRead,
    DatasetUploadResponse,
    DatasetVersionRead,
    DatasetWorkspaceRead,
    ExportDatasetRequest,
    ManualEditRequest,
    ManualEditResponse,
    RenameDatasetRequest,
    RenameDatasetResponse,
    RestoreVersionResponse,
    SaveResultRequest,
    SaveResultResponse,
)
from app.schemas.filter import FilterRequest, FilterResponse
from app.schemas.analysis import DatasetTrendRequest, DatasetPredictRequest, TrendResponse, PredictResponse
from app.schemas.structure import StructureSummaryRequest, StructureSummaryResponse
from app.services.analysis_service import trend_analysis, predict_column
from app.services.dataset_snapshot import snapshot_to_dataframe, snapshot_to_export_bytes
from app.services.auth_service import get_user_by_token
from app.services.dataset_service import (
    create_dataset_from_upload,
    create_dataset_from_snapshot,
    create_dataset_version,
    delete_owned_dataset,
    get_dataset_versions,
    get_owned_dataset,
    get_workspace_guidance,
    list_user_datasets,
    rename_owned_dataset,
    save_manual_edit,
)
from app.services.filter_service import filter_rows
from app.services.structure_service import compute_structure_summary

router = APIRouter()


def _get_current_token(authorization: str | None) -> str:
    """Extract a Bearer token from the Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    return authorization.removeprefix("Bearer ").strip()


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    description: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a dataset file and create a new Dataset for the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed: CSV, Excel (.xlsx/.xls), JSON, PNG, JPG.",
        )

    dataset = await create_dataset_from_upload(db=db, upload_file=file, owner=owner, description=description)
    return {"message": "Dataset uploaded successfully", "dataset": dataset}


@router.get("/dataset/{dataset_id}", response_model=DatasetWorkspaceRead)
async def get_dataset(dataset_id: int, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """Return a dataset "workspace" response (dataset + computed guidance)."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    warnings, suggestions = get_workspace_guidance(dataset)
    return {"dataset": dataset, "warnings": warnings, "suggestions": suggestions}


@router.get("/datasets", response_model=list[DatasetRead])
async def list_datasets(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """List datasets belonging to the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    return await list_user_datasets(db, owner)


@router.delete("/dataset/{dataset_id}", response_model=DeleteDatasetResponse)
async def delete_dataset(dataset_id: int, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """Delete a dataset (and dependent rows) owned by the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    await delete_owned_dataset(db, dataset)
    return {"message": "Dataset deleted successfully."}


@router.patch("/dataset/{dataset_id}/rename", response_model=RenameDatasetResponse)
async def rename_dataset(
    dataset_id: int,
    payload: RenameDatasetRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Rename a dataset owned by the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    dataset = await rename_owned_dataset(db, dataset, payload.name)
    return {"message": "Dataset renamed successfully.", "dataset": dataset}


@router.post("/dataset/{dataset_id}/export")
async def export_dataset(
    dataset_id: int,
    payload: ExportDatasetRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Export the current dataset/result as CSV/XLSX/JSON.

If the client provides a `data_snapshot`, the export is generated from that snapshot
(useful for exporting an unsaved session result). Otherwise, the dataset's current
stored snapshot is exported.
    """

    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot if payload.data_snapshot is not None else dataset.current_snapshot
    if snapshot is None:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No dataset data is available to export.")

    file_bytes, media_type, extension = snapshot_to_export_bytes(snapshot, export_format=payload.format)
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    safe_name = "dataset"
    filename = f"{safe_name}-{dataset.id}-{timestamp}.{extension}"

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/dataset/{dataset_id}/structure/summary", response_model=StructureSummaryResponse)
async def get_structure_summary(
    dataset_id: int,
    payload: StructureSummaryRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return a friendly per-column summary for non-technical users.

    If the client provides a `data_snapshot`, the summary is computed from that
    snapshot (useful for unsaved results). Otherwise we summarize the dataset's
    current snapshot. Mirrors Mobile's endpoint.
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot if payload.data_snapshot is not None else dataset.current_snapshot
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No dataset data is available.")

    frame = snapshot_to_dataframe(snapshot)
    return compute_structure_summary(frame, top_values_limit=payload.top_values_limit)


@router.post("/dataset/{dataset_id}/versions", response_model=DatasetVersionRead)
async def save_dataset_version(
    dataset_id: int,
    payload: CreateDatasetVersionRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Create a new dataset snapshot (internal "version") for a dataset.

Kept for compatibility; the simplified UI generally uses /result instead.
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    version = await create_dataset_version(db, dataset, payload)
    return version


def _summarize_version(version: DatasetVersion, current_version_id: int | None) -> dict:
    """Build a compact summary dict for a version (used by list/restore endpoints)."""
    summary = version.summary_json or {}
    return {
        "id": version.id,
        "dataset_id": version.dataset_id,
        "version_number": version.version_number,
        "operation_type": version.operation_type,
        "created_at": version.created_at,
        "row_count": summary.get("row_count"),
        "column_count": summary.get("column_count"),
        "missing_cells": summary.get("missing_cells"),
        "duplicate_rows": summary.get("duplicate_rows"),
        "is_current": current_version_id is not None and version.id == current_version_id,
    }


@router.get("/dataset/{dataset_id}/versions", response_model=list[DatasetVersionSummary])
async def list_dataset_versions(
    dataset_id: int,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return all stored versions for a dataset (newest first)."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    versions = await get_dataset_versions(db, dataset)
    return [_summarize_version(v, dataset.current_version_id) for v in reversed(versions)]


@router.get("/dataset/{dataset_id}/versions/{version_id}", response_model=DatasetVersionDetail)
async def get_dataset_version(
    dataset_id: int,
    version_id: int,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return a single version's full snapshot (for preview / restore confirmation)."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    version = next((v for v in (dataset.versions or []) if v.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found for this dataset.")
    return {**_summarize_version(version, dataset.current_version_id), "data_snapshot": version.data_snapshot}


@router.post("/dataset/{dataset_id}/versions/{version_id}/restore", response_model=RestoreVersionResponse)
async def restore_dataset_version(
    dataset_id: int,
    version_id: int,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Restore an older version by copying its snapshot into a new current version.

    History is preserved — we never mutate older rows. A new version row is created
    with the restored snapshot and becomes the dataset's current version.
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    target = next((v for v in (dataset.versions or []) if v.id == version_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found for this dataset.")

    if dataset.current_version_id == target.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That version is already current.")

    new_version = await create_dataset_version(
        db,
        dataset,
        CreateDatasetVersionRequest(
            operation_type=f"restore_v{target.version_number}",
            replace_current=True,
            data_snapshot=target.data_snapshot,
        ),
    )

    reloaded_dataset = await get_owned_dataset(db, dataset.id, owner)
    return {
        "message": f"Restored version {target.version_number} as the current dataset.",
        "restored_version_id": target.id,
        "new_version": _summarize_version(new_version, reloaded_dataset.current_version_id),
        "dataset": reloaded_dataset,
    }


@router.post("/dataset/{dataset_id}/result", response_model=SaveResultResponse)
async def save_dataset_result(
    dataset_id: int,
    payload: SaveResultRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Save an analysis/cleaning result.

Two modes:
- replace_current=True: append a snapshot and set it as current
- replace_current=False: create a brand-new dataset from the provided/current snapshot
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot if payload.data_snapshot is not None else dataset.current_snapshot
    if snapshot is None:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No saved result is available.")

    if payload.replace_current:
        version = await create_dataset_version(
            db,
            dataset,
            CreateDatasetVersionRequest(operation_type="result", replace_current=True, data_snapshot=snapshot),
        )
        updated_dataset = await get_owned_dataset(db, dataset.id, owner)
        return {"message": "Result replaced the current dataset.", "dataset": updated_dataset}

    dataset_name = (payload.dataset_name or "").strip()
    if not dataset_name:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dataset name is required.")

    created_dataset = await create_dataset_from_snapshot(
        db=db,
        owner=owner,
        name=dataset_name,
        file_type=dataset.file_type,
        description=payload.description or dataset.description,
        snapshot=snapshot,
        action_type="result",
        action_input_params={"source_dataset_id": dataset.id, "source_dataset_name": dataset.name},
    )
    return {"message": "Result saved as a new dataset.", "dataset": created_dataset}


@router.post("/dataset/{dataset_id}/filter", response_model=FilterResponse)
async def filter_dataset(
    dataset_id: int,
    payload: FilterRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Filter dataset rows by a list of predicates (AND/OR) and return a page.

    The frontend uses this to power the row-filter panel on the Overview tab.
    A `data_snapshot` may be passed to filter an unsaved cleaning result.
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot if payload.data_snapshot is not None else dataset.current_snapshot
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No dataset data is available to filter.")

    frame = snapshot_to_dataframe(snapshot)
    return filter_rows(
        frame,
        payload.predicates,
        combine=payload.combine,
        offset=payload.offset,
        limit=payload.limit,
    )


@router.get("/dataset/{dataset_id}/rows")
async def get_dataset_rows(
    dataset_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=100),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return a paginated slice of the full dataset rows."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    version = await db.scalar(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No version found for this dataset.")

    records: list[dict] = (version.data_snapshot or {}).get("records", [])
    return {
        "rows": records[offset : offset + limit],
        "total": len(records),
        "offset": offset,
        "limit": limit,
    }


@router.post("/dataset/{dataset_id}/manual-edit", response_model=ManualEditResponse)
async def manual_edit_dataset(
    dataset_id: int,
    payload: ManualEditRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Apply manual cell/row edits and save as a new dataset version.

    The client sends the complete modified records array plus the (possibly renamed)
    column list. The backend rebuilds the snapshot from scratch so column metadata,
    missing-value counts, and summary stats are all recalculated correctly.
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    new_version = await save_manual_edit(db, dataset, payload.records, payload.columns)

    summary = new_version.summary_json or {}
    return ManualEditResponse(
        version_id=new_version.id,
        version_number=new_version.version_number,
        row_count=summary.get("row_count", 0),
        column_count=summary.get("column_count", 0),
    )


@router.post("/dataset/{dataset_id}/trend", response_model=TrendResponse)
async def dataset_trend(
    dataset_id: int,
    payload: DatasetTrendRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Run trend analysis on a dataset (or an unsaved in-memory snapshot)."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    return trend_analysis(
        dataset,
        time_column=payload.time_column,
        snapshot_override=payload.data_snapshot,
    )


@router.post("/dataset/{dataset_id}/predict", response_model=PredictResponse)
async def dataset_predict(
    dataset_id: int,
    payload: DatasetPredictRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Predict future values for a numeric column in a dataset."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    # input_column defaults to target_column when not supplied (it is unused when
    # time_column is set, and was always a dead param in the row-index path).
    input_col = payload.input_column or payload.target_column
    return predict_column(
        dataset,
        input_col,
        payload.target_column,
        payload.future_steps,
        time_column=payload.time_column,
        snapshot_override=payload.data_snapshot,
    )
