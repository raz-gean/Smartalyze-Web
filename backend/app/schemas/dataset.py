"""Dataset API schemas (Pydantic).

These models define the backend <-> frontend contract for dataset operations.

Terminology:
- Dataset: the top-level user-owned container (a "file" in the UI).
- Snapshot (DatasetVersion.data_snapshot): the stored data at a point in time.

The simplified UX uses a "replace current dataset" vs "save as new dataset" flow.
Version history exists internally, but the main workspace API does not expose it.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DatasetColumn(BaseModel):
    name: str
    data_type: str
    missing_values: int
    non_null_values: int
    unique_values: int


class DatasetSummary(BaseModel):
    row_count: int
    column_count: int
    missing_cells: int
    duplicate_rows: int


class DatasetRead(BaseModel):
    """Public dataset fields exposed to the frontend."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_user_id: int
    original_filename: str
    stored_filename: str
    file_path: str
    mime_type: str | None
    file_format: str
    description: str | None
    size_bytes: int
    row_count: int | None
    column_count: int | None
    columns_json: list[dict] | None = None
    preview_json: list[dict] | None = None
    summary_json: dict | None = None
    current_version_id: int | None = None
    created_at: datetime


class DatasetVersionRead(BaseModel):
    """Public fields for a stored snapshot (legacy/compat endpoint)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    dataset_id: int
    version_number: int
    operation_type: str
    artifact_path: str
    artifact_filename: str
    row_count: int | None
    column_count: int | None
    preview_json: list[dict] | None = None
    columns_json: list[dict] | None = None
    summary_json: dict | None = None
    created_at: datetime


class DatasetVersionSummary(BaseModel):
    """Compact entry for the version history list."""
    id: int
    dataset_id: int
    version_number: int
    operation_type: str
    created_at: datetime
    row_count: int | None = None
    column_count: int | None = None
    missing_cells: int | None = None
    duplicate_rows: int | None = None
    is_current: bool = False


class DatasetVersionDetail(DatasetVersionSummary):
    """Full version payload including the stored snapshot."""
    data_snapshot: dict


class RestoreVersionResponse(BaseModel):
    """Response after restoring an older version as the new current."""
    message: str
    restored_version_id: int
    new_version: DatasetVersionSummary
    dataset: DatasetRead


class DatasetWorkspaceRead(BaseModel):
    """Response for GET /dataset/{id}: dataset + computed warnings/suggestions."""
    dataset: DatasetRead
    warnings: list[dict]
    suggestions: list[dict]


class DatasetUploadResponse(BaseModel):
    """Response for POST /upload."""
    message: str
    dataset: DatasetRead


class CreateDatasetVersionRequest(BaseModel):
    """Request for creating a snapshot (legacy endpoint)."""
    operation_type: str = Field(min_length=3, max_length=50)
    replace_current: bool = False
    data_snapshot: dict | None = None


class SaveResultRequest(BaseModel):
    """Request body for POST /dataset/{id}/result.

If replace_current is false, `dataset_name` becomes required.
"""
    replace_current: bool = True
    dataset_name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    data_snapshot: dict | None = None

    @model_validator(mode="after")
    def _validate_dataset_name_when_creating_new(self):
        if not self.replace_current:
            name = (self.dataset_name or "").strip()
            if not name:
                raise ValueError("Dataset name is required when saving as a new dataset.")
            self.dataset_name = name
        return self


class SaveResultResponse(BaseModel):
    """Response body for POST /dataset/{id}/result."""
    message: str
    dataset: DatasetRead


class DeleteDatasetResponse(BaseModel):
    """Response body for DELETE /dataset/{id}."""
    message: str


class RenameDatasetRequest(BaseModel):
    """Request body for PATCH /dataset/{id}/rename."""
    name: str = Field(min_length=1, max_length=255)


class RenameDatasetResponse(BaseModel):
    """Response body for PATCH /dataset/{id}/rename."""
    message: str
    dataset: DatasetRead


class ExportDatasetRequest(BaseModel):
    """Request body for exporting a dataset/result.

If `data_snapshot` is provided, the export is generated from that snapshot (useful for
unsaved session results like a cleaned snapshot).

If `data_snapshot` is omitted, the backend exports the dataset's current stored snapshot.
    """

    format: Literal["csv", "xlsx", "json", "parquet"] = "csv"
    data_snapshot: dict | None = None


class ManualEditRequest(BaseModel):
    """Request body for POST /dataset/{id}/manual-edit.

    The client sends the full modified records array (after applying all in-browser edits)
    plus the current column names (which may have been renamed).
    """
    records: list[dict]
    columns: list[str]


class ManualEditResponse(BaseModel):
    """Response body for POST /dataset/{id}/manual-edit."""
    version_id: int
    version_number: int
    row_count: int
    column_count: int
