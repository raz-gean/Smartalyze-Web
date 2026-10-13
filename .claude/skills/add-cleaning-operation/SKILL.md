---
name: add-cleaning-operation
description: Use when adding or changing a data-cleaning operation in Smartalyze (a new fix in the Prepare tab, a new CleaningOperationType, a new detect-and-fix flow). Gives the exact backend + frontend touchpoints so no layer is missed.
---

# Add a cleaning operation

Cleaning ops span both stacks. Missing any step produces an op that queues but fails (or never shows). Do them in this order.

## Backend (`backend/app/`)
1. `schemas/cleaning.py`: add the literal to `CleaningOperationType`. If the op needs parameters, add optional fields to `CleaningOperation` with a comment `# Fields below only apply to operation_type == "<name>"`. Keep them optional with defaults so existing ops are unaffected.
2. `services/cleaning_service.py`:
   - Add a branch in `_apply_operation` (the `if operation.operation_type == ...` chain). Unknown types fall through to the "Unsupported cleaning operation" error.
   - Check `_OPERATION_PRIORITY` / `_order_operations`: ops are sorted by priority before applying, so decide where the new op belongs relative to fills, type conversions, and row drops.
   - Validate inputs (column exists, type is compatible) and raise `HTTPException` like neighbouring branches do.
3. If the op is *suggested* by detection, extend `services/quality_detection_service.py` and the `/clean/detect` response schema. Detection must stay summary-only (counts, samples), never raw rows, because the AI layer reads these summaries.
4. Operate on the DataFrame only. `/clean/apply` must not persist anything; saving is the separate `/dataset/{id}/result` call.

## Frontend (`frontend/`)
5. `lib/api.ts`: mirror the new literal and any new fields in the `CleaningOperation` type (and the detect response type if changed).
6. `app/dataset/[id]/page.tsx`:
   - Add `buildXOperation(...)`, a pure function returning a `CleaningOperation`, next to the other builders.
   - Add a case in `getOperationConcern` so a new fix for the same column/problem replaces the old one instead of stacking contradictory ops.
   - Add `toggleX(...)` that calls the shared `toggleOperation(op, addMsg, removeMsg)`.
   - Pass the toggle (and any "is queued" state) down as props.
7. `components/dataset/PrepareTab.tsx` (or `DetectTab.tsx` for detection-driven fixes): add the control. Use plain-language labels; the audience is non-technical. Keep the tab presentational (no fetch calls, no state that belongs in the page).

## Verify
- `cd backend && python -m tests.test_quality_detection`. Add a test there for the new op using the existing `_apply_operation` / `apply_cleaning_operations` imports.
- `cd frontend && npm run lint && npm run build` (build type-checks; there is no other frontend test).
- Remember the UI must preview the result unsaved; do not auto-save.
