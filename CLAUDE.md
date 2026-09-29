# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Smartalyze is a capstone web app for uploading messy datasets and cleaning / exploring / analyzing / predicting on them. FastAPI backend (`backend/`) + Next.js (App Router) frontend (`frontend/`), talking over a JSON REST API with Bearer-token auth.

## Commands

### Backend (`backend/`)
```bash
# from backend/, with .venv activated
uvicorn app.main:app --reload          # run the API (localhost:8000)
pip install -r requirements.txt        # install deps (no pyproject.toml; requirements.txt is the source of truth)
```
There is no backend test suite, linter, or formatter configured — don't assume `pytest`/`ruff`/`black` exist. Tables are created automatically on startup (`Base.metadata.create_all` in `app/main.py`); there is no Alembic migration system, so schema changes just require restarting the app against a dev DB.

### Frontend (`frontend/`)
```bash
# from frontend/
npm run dev      # dev server (localhost:3000)
npm run build    # production build
npm run lint     # eslint
```
No frontend test suite is configured either — `npm run lint` and `npm run build` (which type-checks) are the only automated checks available.

### Config
- Backend reads `backend/.env` (`DATABASE_URL`, `CORS_ALLOWED_ORIGINS`, `AI_PROVIDER` + provider keys, `MAX_UPLOAD_SIZE_MB`, etc.) — see `app/core/config.py`.
- `DATABASE_URL` is normalized to `postgresql+asyncpg://` automatically even if given as a plain `postgresql://` URL.
- Frontend reads `NEXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:8000`).
- `frontend/AGENTS.md` (pulled in via `frontend/CLAUDE.md`) warns that this Next.js version may diverge from training data — check `node_modules/next/dist/docs/` before relying on remembered Next.js APIs when working in `frontend/`.

## Architecture

### Backend layering (strict, one-directional)
`app/routes/*` → `app/services/*` → `app/models/*`, with `app/schemas/*` as the Pydantic contracts routes accept/return. Routes are intentionally thin: extract the Bearer token, call a service function, return its result. All business logic and DB access lives in services. When adding a feature, add/extend a service function first, then wire a thin route to it — don't put logic in routes.

Every route module repeats the same auth boilerplate: a local `_get_current_token`/`_require_token` helper pulls the Bearer token out of the `Authorization` header, then `get_user_by_token(db, token)` resolves the user, then (for dataset-scoped endpoints) `get_owned_dataset(db, dataset_id, owner)` enforces ownership. Follow this exact pattern for new endpoints rather than inventing a new auth dependency.

### Dataset storage model: snapshots, not files
There is no filesystem storage for dataset content. A `Dataset` (user-owned container) points at a `current_version_id`; each `DatasetVersion` holds a full point-in-time snapshot as JSONB (`data_snapshot`, with `records`/`preview`/`columns`/`summary` keys). Every cleaning/edit/restore operation creates a **new** `DatasetVersion` rather than mutating one — versions are treated as append-only history, and "restore" works by copying an old snapshot into a fresh version, never by rewriting the old row. `Dataset.*_json`/`row_count`/etc. are Python properties that read through to `current_version.data_snapshot` — there are no matching DB columns on `datasets` for that data.

Snapshots are converted to/from pandas DataFrames via `app/services/dataset_snapshot.py` (`build_snapshot`, `snapshot_to_dataframe`, `snapshot_to_export_bytes`) — this is the one place that owns that conversion; reuse it instead of hand-rolling DataFrame⇄JSON logic in a new service.

Many endpoints accept an optional `data_snapshot` in the request body as an override for the dataset's stored current snapshot (e.g. `/dataset/{id}/filter`, `/dataset/{id}/structure/summary`, `/dataset/{id}/trend`). This is what lets the frontend preview cleaning/analysis results before the user decides to save them — always honor `payload.data_snapshot` over `dataset.current_snapshot` when both are supported by an endpoint, matching the existing routes.

### Cleaning pipeline
`POST /clean/detect` scans a dataset snapshot and returns issues, missing-value counts, duplicate counts, inferred column types, pattern-based imputation suggestions, category-variant suggestions, pseudo-null detection, and outliers — and also persists derived issue *counts* back onto the version's `summary` (via `flag_modified`) so the dashboard health score doesn't need a re-scan. `POST /clean/apply` takes a list of `CleaningOperation`s (see the `CleaningOperationType` literal in `app/schemas/cleaning.py`) and returns a new cleaned snapshot — it does **not** persist anything; the frontend must separately call `/dataset/{id}/result` (replace current vs. save-as-new) to make it permanent. Adding a new cleaning operation means: add the literal to `CleaningOperationType`, handle it in `cleaning_service.py`'s operation dispatcher, and add a `build*Operation`/`toggle*` pair in the frontend (see below).

### AI layer
`app/services/ai_service.py` supports Ollama (local, default)/Groq/Gemini behind one interface, selected by `AI_PROVIDER`. The LLM is only ever given the compact computed summary (issues, missing counts, pattern suggestions, stats) — never raw dataset rows. Keep it that way when extending AI features; don't pass full snapshots/DataFrames into a prompt.

### Frontend: the dataset workspace
`frontend/app/dataset/[id]/page.tsx` is the single large client component that owns almost all workspace state (cleaning operation queue, filters, analysis results, save/restore modals, etc.) and passes it down as props into six tab components under `frontend/components/dataset/` (`OverviewTab`, `PrepareTab`, `ExploreTab`, `DetectTab`, `PredictTab`, `EditTab`). Tabs are mostly presentational; state and API calls live in the page. Each tab is wrapped in `TabErrorBoundary` so one tab crashing doesn't take down the whole workspace.

Cleaning operations follow a builder/toggle convention: for each operation type there's a `buildXOperation(...)` pure function that constructs a `CleaningOperation` object, and a `toggleX(...)` function that adds/removes it from the pending `cleaningOperations` queue via the shared `toggleOperation` helper. Queued operations have a "concern" key (`getOperationConcern`) so that adding a new fix for the same column/problem (e.g. a different missing-value strategy) automatically replaces the old one instead of stacking contradictory ops — follow this pattern for any new cleaning operation rather than allowing duplicates to queue.

`lib/api.ts` is the single typed API client (all `fetch` calls + response types) — add new endpoint calls there, not inline in components. `lib/auth.ts` wraps `localStorage` token storage.

### Versioning/history UX
The UI deliberately hides "dataset version" as a concept from casual use — cleaning results are previewed unsaved, and the user explicitly chooses "Replace current" vs "Save as new dataset" (`/dataset/{id}/result`). Full version history/restore exists (`/dataset/{id}/versions*`) but is a secondary "History" modal, not the primary flow. Keep new destructive-looking actions behind this same explicit save/replace-vs-new choice rather than auto-saving.
