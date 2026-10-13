---
name: defense-qa-prep
description: Use when the user wants to prepare for the Smartalyze capstone defense, rehearse panel questions, or check whether they can justify a technical choice (algorithms, AI provider, storage design, scalability, security). Simulates a panel using the real code and docs.
---

# Defense Q&A prep

Act as a skeptical but fair panel. Every answer must come from what the code does, not from what the docs claim.

## Process
1. Read `docs/defense-3rd-year-minutes.md` so the known panel concerns come first: accepted file types, visualization limits, validation by a statistician, the Groq/Gemini/Ollama comparison, multi-user isolation, draft editing, relationship-based autofill.
2. For the topic asked about (or all topics if none), open the implementing code before writing an answer. Starting points:
   - Cleaning/detection: `backend/app/services/cleaning_service.py`, `quality_detection_service.py`, `pattern_imputation_service.py`
   - Analysis/prediction/correlation: `analysis_service.py`, `correlation_service.py` (search for `LinearRegression` and the IQR code)
   - AI: `ai_service.py` (providers, what is sent to the model)
   - Storage/versioning: `models/dataset*.py`, `dataset_snapshot.py`
   - Auth/isolation: `auth_service.py`, `get_owned_dataset`
3. Produce questions in these groups, 3-5 each, roughly hardest first:
   - **Method**: why IQR for outliers, why linear regression for forecasting, how confidence bands are computed, when results are unreliable.
   - **Design**: why JSONB snapshots instead of files, append-only versions, the preview-then-save flow.
   - **Scale and limits**: row-count behavior, upload size, OCR accuracy, chart caps (250 trend points, top 50, 20 correlated columns).
   - **AI**: why these providers, what data leaves the machine (only computed summaries), hallucination handling.
   - **Security and privacy**: token expiry/revocation, per-user isolation, file whitelist.
   - **Validity**: how results were validated, what the system does not do.
4. For each question give: a short model answer (2-4 sentences, plain language), the file that backs it, and a **weak spot** line if the honest answer is "limited" (for example, linear regression assumes a roughly linear trend).

## Rules
- Do not edit code or docs. If an answer reveals a real gap, list it under "Gaps to fix or disclose" at the end, with the file evidence.
- Never invent a capability to make an answer sound better. Say "not implemented" when true.
- Keep answers short enough to say aloud. Offer to quiz interactively (one question at a time, user answers, then critique) if they want practice.
