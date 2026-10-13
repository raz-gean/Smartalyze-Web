---
name: doc-code-consistency-check
description: Use when the user wants to verify that Smartalyze documentation (features.md, README, capstone PDF/docx, use case/DFD/CFD diagrams) matches what the code actually does. Report-only audit; never edits files.
---

# Doc-vs-code consistency check

Report mismatches. Do not modify code, docs or diagrams.

## Build the ground truth from code first
- Endpoints: grep `@router.` in `backend/app/routes/*.py` (auth, datasets, cleaning, analysis, ai) and list method + path.
- Cleaning operations: the `CleaningOperationType` literal in `backend/app/schemas/cleaning.py`.
- Tabs and UI features: `frontend/components/dataset/` (Overview, Prepare, Explore, Detect, Predict, Edit, AI panels) and `frontend/app/`.
- Providers and limits: `backend/app/core/config.py`, `ai_service.py`, `MAX_UPLOAD_SIZE_MB`, accepted extensions in `dataset_service.py`.
- Export formats: `dataset_snapshot.py`.

## Compare against
- `features.md` and `README.md` (text; known to lag, e.g. README says 5 tabs, code has 6 and a different env var name).
- `docs/defense-3rd-year-minutes.md` and `docs/capstone-document-issues.md` (status markers may be stale).
- `docs/*.drawio` diagrams: read as XML text and extract labels (`value="..."`). Check UseCase, DFD-Level1, CFD-Level0, ERD (against `backend/app/models`), SystemArchitecture, ConceptualFramework.
- The capstone PDF/docx only if the user points to specific sections; they are large, so read only the pages asked for.

## Output
A table per document with three columns of findings:
1. **Claimed but not in code** (overclaims; highest risk at defense)
2. **In code but missing from docs/diagrams** (underclaims; e.g. Analysis, Detect, Predict, AI Chat use cases)
3. **Wrong detail** (counts, names, env vars, terminology such as "decision support" vs "AI insights")

Each row cites the doc location and the code file that proves it. End with a short prioritized fix list (what to change in which file). Offer to make the edits, but wait for the user to say so.
