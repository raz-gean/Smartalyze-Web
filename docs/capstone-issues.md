# Smartalyze Capstone Issues Tracker

Tracks everything where the **capstone document** and the **system** disagree, plus open panel items, so both can be brought into line before the pre-deployment defense (informal **Nov 11–13**, formal **Nov 16–17, 2026**).

- **Document reviewed:** `SMARTALYZE_ AN AI-ASSISTED DATA VISUALIZATION AND ANALYSIS PLATFORM.pdf` (updated by the documentarian, 89 pages). Page numbers below refer to that PDF.
- **System reviewed:** `main` at commit `4390c8c7` (October 20, 2026).
- **Last reviewed:** October 21, 2026 (A1/S1 resolved the same day: Groq is live).

**Owner:** **Doc** = documentarian (manuscript), **Sys** = system programmer (code), **Team** = needs a group decision.
**Status:** ⬜ Open · 🟡 In progress · ❓ Needs decision · ✅ Done

---

## A. Decisions needed (Team)

### A1. Which AI provider do we actually use? ✅ Decided: Groq
- **Document:** Groq is the chosen provider (Objective 2, p.6; FR 8, p.47; NFR 1 and NFR 9, pp.48–49; DFD Level 1 "LLM Processing (Groq)").
- **System:** defaults to **Ollama** (`backend/app/services/ai_service.py`, `AI_PROVIDER` defaults to `ollama`). `backend/.env` sets neither `AI_PROVIDER` nor `GROQ_API_KEY`, so the running app uses local Ollama.
- **Also:** p.38 says "a locally installed language model", which contradicts the Groq choice.
- **Recommended:** follow the document. Get a Groq API key, then do **S1**. If we stay with Ollama instead, every Groq mention above must change (**D11**).
- **Resolved (Oct 21, 2026):** Groq key added to `backend/.env` (`AI_PROVIDER=groq`). Groq has retired the Llama 3.3 models, so the default model is now `openai/gpt-oss-120b`, chosen after comparing the available models. All four AI features were tested through the API and in the browser. Follow-ups: **S10** (answer quality) and **D11** (manuscript wording).

### A2. Forecast range: what does it mean? ❓
- **Document (p.69):** forecasts have "confidence bands" / "confidence intervals".
- **System:** the band is predicted value ± 1 residual standard error (about a 68% band). It is not a confidence or prediction interval (`analysis_service.predict_column`).
- **Recommended:** do **S2** (a true 95% prediction interval) and confirm it with the statistician; then the document's wording becomes correct (**D12**).

### A3. Should the use case diagram show every feature? ❓
- **Document (p.50, Figure 6):** 10 use cases (Register, Login, Upload, View, List, Apply Cleaning, Detect Issues, Save Result, Export, Delete).
- **System:** also has Explore/Analyze, Detect outliers, Predict, Ask AI, Edit dataset, Rename, and Restore version.
- **Note:** the panel accepted the diagrams on the Outline Acceptance Form. Decide whether to leave as is or add the missing use cases.

---

## B. System changes (Sys)

| ID | Change | Why | Status |
|---|---|---|---|
| S1 | Make Groq the default AI provider (`AI_PROVIDER=groq`, `GROQ_API_KEY` in `backend/.env`); keep Ollama and Gemini as alternatives | Matches the document (A1) | ✅ Done (model `openai/gpt-oss-120b`) |
| S2 | Forecast band → 95% prediction interval | Makes "confidence/prediction interval" true (A2); statistician item | ❓ |
| S3 | Trend analysis uses scikit-learn `LinearRegression` instead of NumPy `polyfit` (identical results) | p.67 says trends use scikit-learn; today only Predict does | ⬜ |
| S4 | Edit tab "Suggested fixes" never appear: it reads `details.fill_value`, which the scan doesn't send, and matches issue kind `"outlier"` while the scan sends `"outliers"` (health panel says "No outliers" next to an outlier issue) | Visible bug | ⬜ |
| S5 | Edit tab column badges show raw type names (`datetime_string`, `categorical`) | Jargon for non-technical users | ⬜ |
| S6 | Predict's "Column to forecast" lists every column until the Explore tab has been opened once | Confusing list (default is correct) | ⬜ |
| S7 | History shows times 8 hours off (UTC shown as local time) | Visible bug | ⬜ |
| S8 | File size shows "0 B" after an Edit save, or jumps after other saves | Visible bug | ⬜ |
| S9 | Older failing test `test_analyze_quality_combined` (spelling-variant grouping on a mixed dataset) | Test suite is 52/53 | ⬜ |
| S10 | AI answer quality (Groq): answers sometimes cut off (512-token limit with a reasoning model); markdown shows as raw `**`; AI names buttons Smartalyze doesn't have; adds `$` the data doesn't have; says IQR fences hold "about 95%" of data (wrong); first Detect summary can miss the outliers (context built before anomaly results arrive) | Visible in Ask AI / AI Analysis at the defense | ⬜ |

---

## C. Document changes (Doc)

### Overclaims: the document says something the system doesn't do

| ID | Where | Current text says | Change to | Status |
|---|---|---|---|---|
| D1 | Scope and Limitation, p.9 | Smartalyze "will not have … predictive analysis" | Remove "predictive analysis", or say "advanced predictive modeling beyond simple linear forecasting". The system has a Predict tab, and p.69 and DFD 6.0 describe prediction. | ⬜ |
| D2 | System Architecture p.45; Classification p.67; Iteration 3 p.40; Objective 4 p.6; Maintenance p.82 | "Machine learning" detects trends **and anomalies** | IQR outlier detection is a **statistical method**, not ML. Keep "machine learning" only for linear regression (scikit-learn). The app now uses honest labels: "Outlier Detection (IQR)", "Trend Analysis (linear regression)". | ⬜ |
| D3 | NFR 3, p.48; Security Plan, p.81 | Passwords are "encrypted" | Passwords are **hashed** (PBKDF2-SHA256 with a random salt). Hashing is one-way; encryption is reversible. | ⬜ |
| D4 | Execution Order, p.65 | 1. Type conversions, 2. Missing value filling, 3. Row removals, 4. Sorting | Duplicates are removed first, then disguised blanks ("N/A") become empty, then type and format fixes, then fills, then row removals, then sorting (`cleaning_service._OPERATION_PRIORITY`). | ⬜ |

### Underclaims: the system does something the document says it doesn't, or omits

| ID | Where | Issue | Change to | Status |
|---|---|---|---|---|
| D5 | FR 4, p.47 | "Saving draft … is planned as an additional feature for the next version" | Drafts are implemented (the panel required it, and Scope p.8 already says so): unsaved edits are kept, with undo/redo and Restore/Discard. | ⬜ |
| D6 | FR 2, p.47 | Upload, organize, delete; no rename | Add renaming datasets (panel item; Scope p.8 mentions it). | ⬜ |
| D7 | Objective 6, p.7; DFD 4.0, p.54 | Export formats CSV, Excel, JSON | Add **Parquet** (the system exports it), or leave it out on purpose. | ⬜ |
| D8 | FR 7 / FR 9 / Technologies | Not mentioned | Add the **correlation heatmap** (Pearson and Spearman), the **dataset health score**, and **keeping leading-zero codes** (zip codes, IDs) as text. | ⬜ |
| D9 | Table 9, p.78 | All results "TBD" | Fill with real results: automated tests 52/53 passed; statistical validation 41/42 values matched NumPy/SciPy/statsmodels; end-to-end browser tests passed. Update before the defense. | ⬜ |

### Wrong details

| ID | Where | Issue | Change to | Status |
|---|---|---|---|---|
| D10 | Data Dictionary, Table 3 Users, pp.56–57 | Key column named `user_id`; `password_hash` marked **Unique**; `avatar` missing | Column is `id`; **`username`** is unique (not `password_hash`); add `avatar` (Text, optional profile picture, max 1 MB). | ⬜ |
| D11 | Methodology, p.38 | "a locally installed language model for AI assistance" | "a cloud-based language model (Groq)". Optionally name the model `openai/gpt-oss-120b` and note that the Llama model was retired by Groq. | ⬜ |
| D12 | Prediction, p.69 | "Confidence bands based on regression residual error"; "Confidence intervals" | Depends on A2/S2: "a 95% prediction interval". | ❓ |
| D13 | Trend Analysis, p.67 | Trend analysis "uses the Linear Regression model from Scikit-learn" | True once S3 is done; otherwise "least-squares linear regression (NumPy)". | ⬜ |
| D14 | Data Dictionary, Table 4 AuthSessions, p.57 | `id` primary key missing | Add `id` (Integer, Primary Key). | ⬜ |
| D15 | Gantt chart, p.41; cover, p.1 | Gantt chart ends **May 2026**, cover says **June 2026**; work continues into November | Align the dates, or add a revised schedule. | ⬜ |
| D16 | References, p.83 | "Cited by: 76" and "Cited by: 12" still in entries [3] and [4] | Delete all "Cited by: XX". | ⬜ |
| D17 | Background, pp.4–5; References [17], [18] | [17] (CHED TANAW) is cited for "AI-assisted functions"; [18] (DNSC BOT meeting) for "the College's computing and research environment" | Check that these sources really support those sentences. | ⬜ |
| D18 | Whole document | Leftover yellow highlights (flagged in the previous version) | Check visually before printing; text extraction can't see highlights. | ⬜ |

---

## D. Panel requirements still open

| Item | Status |
|---|---|
| Validation by a statistician | 🟡 Internal validation done (41/42 values matched); statistician contacted; formal sign-off pending. Tied to A2/S2. |
| Improve the RRL | 🟡 In progress |
| All 10 System comments; LLM comparison; use case, CFD and DFD revisions; "decision support" → "AI insights" | ✅ Done (see `defense-3rd-year-minutes.md`) |

---

## E. Resolved from the previous audit (`CAPSTONE DOCUMENT_2.pdf`)

| Old # | Issue | Result in the updated document |
|---|---|---|
| 3 | Reference numbers didn't match their in-text citations | ✅ Mostly fixed: [3], [6]–[13] and [16] now match. See D17 for [17] and [18]. |
| 4 | DFD Level 1 missing Analysis and AI modules | ✅ Fixed: 6.0 Analysis and Prediction and 7.0 AI Advisory added (p.54) |
| 5 | CFD didn't reflect the full system | ✅ Fixed: LLM Provider and all flows added (p.52) |
| 6 | Scope said no "external analytics platforms" | ✅ Removed (but see D1 for a new scope contradiction) |
| 7 | "Foriegn Key" typo | ✅ Fixed |
| 8 | "Data and time" typo | ✅ Fixed |
| 2 | "Cited by: XX" in references | ⬜ Still there → D16 |
| 9 | `avatar` missing from the data dictionary | ⬜ Still missing → D10 |
| 10 | Gantt chart vs cover date | ⬜ Still mismatched → D15 |
| 1 | Yellow highlights | ⬜ Needs a visual check → D18 |

---

## Status Tracker

| ID | Item | Owner | Status |
|---|---|---|---|
| A1 | AI provider: Groq (document) vs Ollama (system) | Team | ✅ Groq |
| A2 | Forecast range meaning (95% interval) | Team | ❓ |
| A3 | Use case diagram completeness | Team | ❓ |
| S1 | Groq as default provider | Sys | ✅ |
| S2 | 95% prediction interval | Sys | ❓ |
| S3 | Trend analysis via scikit-learn | Sys | ⬜ |
| S4 | Edit tab suggested fixes / outlier count | Sys | ⬜ |
| S5 | Plain-language type badges | Sys | ⬜ |
| S6 | Predict column list | Sys | ⬜ |
| S7 | History time zone | Sys | ⬜ |
| S8 | File size display | Sys | ⬜ |
| S9 | Failing older test | Sys | ⬜ |
| S10 | AI answer quality (Groq) | Sys | ⬜ |
| D1 | Scope: remove "predictive analysis" | Doc | ⬜ |
| D2 | "Machine learning" wording for IQR | Doc | ⬜ |
| D3 | "Encrypted" → "hashed" passwords | Doc | ⬜ |
| D4 | Cleaning execution order | Doc | ⬜ |
| D5 | FR 4: drafts are implemented | Doc | ⬜ |
| D6 | FR 2: add rename | Doc | ⬜ |
| D7 | Parquet export | Doc | ⬜ |
| D8 | Correlation heatmap, health score, leading-zero codes | Doc | ⬜ |
| D9 | Table 9 test results | Doc | ⬜ |
| D10 | Users table: `id`, unique `username`, `avatar` | Doc | ⬜ |
| D11 | p.38 "locally installed language model" | Doc | ⬜ |
| D12 | Prediction interval wording | Doc | ❓ |
| D13 | Trend analysis library | Doc | ⬜ |
| D14 | AuthSessions `id` | Doc | ⬜ |
| D15 | Gantt chart vs cover date | Doc | ⬜ |
| D16 | Remove "Cited by" | Doc | ⬜ |
| D17 | Check references [17], [18] | Doc | ⬜ |
| D18 | Yellow highlights | Doc | ⬜ |
