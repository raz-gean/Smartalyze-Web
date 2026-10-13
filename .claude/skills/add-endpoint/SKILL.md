---
name: add-endpoint
description: Use when adding or modifying a FastAPI endpoint plus its frontend API call in Smartalyze (new analysis, dataset action, or AI feature). Encodes the route/service/schema layering, auth boilerplate, and snapshot-override convention.
---

# Add an endpoint

Layering is strict: `routes` -> `services` -> `models`, with `schemas` as the contracts. Routes stay thin.

1. **Schema** (`backend/app/schemas/<area>.py`): Pydantic request/response models. If the endpoint analyzes dataset content, include `data_snapshot: dict | None = None` so the frontend can preview unsaved results.
2. **Service** (`backend/app/services/<area>_service.py`): all logic and DB access. Reuse `dataset_snapshot.py` (`snapshot_to_dataframe`, `build_snapshot`, `snapshot_to_export_bytes`) for DataFrame/JSON conversion; never hand-roll it. Resolve the data as `payload.data_snapshot or dataset.current_snapshot`.
3. **Route** (`backend/app/routes/<area>.py`): copy the neighbouring pattern exactly:
   - the module's `_get_current_token` / `_require_token` helper reads the Bearer token,
   - `get_user_by_token(db, token)` resolves the user,
   - `get_owned_dataset(db, dataset_id, owner)` enforces ownership for dataset-scoped routes (this is what keeps users isolated),
   - call the service and return its result. No logic here.
   - Register a brand-new router in `app/main.py`.
4. **Writes**: never mutate a `DatasetVersion`. Create a new version (append-only). If you change `summary` JSONB in place, call `flag_modified`. Destructive-looking actions need the explicit "Replace current" vs "Save as new" choice, so don't auto-save.
5. **AI features**: pass the model only compact computed summaries, never rows or full DataFrames. Provider selection stays in `ai_service.py` (Ollama default, Groq, Gemini).
6. **Frontend**: add the typed call and response type to `frontend/lib/api.ts` (the only place `fetch` lives). Call it from `app/dataset/[id]/page.tsx` (or the dashboard) and pass results to tabs as props.
7. **Verify**: start `uvicorn app.main:app --reload`, exercise the route, then `cd frontend && npm run lint && npm run build`. Before relying on Next.js APIs from memory, check `frontend/node_modules/next/dist/docs/`.
8. Tables auto-create on startup and there are no migrations: a new column on an existing table needs a dev-DB reset or manual `ALTER`, so mention it in your summary.
