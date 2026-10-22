# Smartalyze — Feature List

> Status key: ✅ Complete · ⚠️ Partial · ❌ Not started

---

## Authentication & Account Management

| Feature | Status | Notes |
|---|---|---|
| User registration | ✅ | Email + username + password (bcrypt) |
| User login | ✅ | Bearer token issued on success |
| Token expiration enforcement | ✅ | `expires_at` and `revoked_at` checked server-side |
| Login required for AI features | ✅ | All `/ai/*` endpoints validate the session token, like every other endpoint |
| Logout clears local drafts | ✅ | Unsaved editor drafts are removed from the browser on sign-out (shared computers) |
| Change username | ✅ | Profile page |
| Change password | ✅ | Profile page |
| Delete account | ✅ | Cascades to datasets |
| Avatar display | ✅ | Initials-based avatar |

---

## Data Ingestion

| Feature | Status | Notes |
|---|---|---|
| CSV upload | ✅ | pandas read_csv; codes with leading zeros (zip "08100", IDs) kept as text |
| Excel upload (.xlsx / .xls) | ✅ | pandas read_excel |
| JSON upload | ✅ | pandas read_json; codes with leading zeros kept as text |
| PNG/JPG image upload (OCR) | ✅ | EasyOCR + img2table, auto table extraction |
| File type whitelist validation | ✅ | 400 error for unsupported extensions |
| OCR model pre-warmed on startup | ✅ | Eliminates 20-30 s first-request delay |
| Sample dataset (one-click) | ✅ | Dashboard shortcut for demo/testing |
| Dataset health score | ✅ | 0–100 (Great / Good / Fair / Needs Work): 100 minus capped deductions for missing cells, duplicate rows, and columns with type problems, disguised blanks, spelling variants or outliers. Same formula on the dashboard card and the Overview tab (`lib/health.ts`); the Edit tab separately shows "Filled cells" (% of cells with a value) |

---

## Data Cleaning (Prepare Tab)

| Feature | Status | Notes |
|---|---|---|
| Auto issue detection | ✅ | Missing values, duplicates, outliers, type mismatches, whitespace. Code/ID columns (zip, ID, phone, etc., by column name) are not checked for outliers |
| Recommended fixes pre-selected | ✅ | Smart fill when available, otherwise median (numbers) / most common value (text); user can untick or change any fix |
| Fill missing — mean | ✅ | |
| Fill missing — median | ✅ | |
| Fill missing — mode | ✅ | |
| Fill missing — custom value | ✅ | |
| Smart fill (fill from a related column) | ✅ | e.g. City "Panabo" → Zip Code 8105. Suggested when ≥80% of known values agree with their group's usual value (measured over cities with ≥2 known values, at least 2 such cities) and the city genuinely improves the guess (Goodman–Kruskal λ ≥ 0.5, so near-constant columns aren't "patterns"); city names matched ignoring case/extra spaces; works when most values are missing and on small datasets; ignores ID-like columns |
| Drop rows with nulls | ✅ | |
| Drop column | ✅ | |
| Remove duplicates | ✅ | |
| Trim whitespace | ✅ | |
| Normalize case (upper/lower/title) | ✅ | |
| Convert column type | ✅ | e.g. string to numeric |
| Replace values | ✅ | Find + replace |
| Rename column | ✅ | |
| Clip outliers (IQR) | ✅ | |
| Queue-based operation staging | ✅ | Stage multiple ops, apply all at once |
| Operation preview before apply | ✅ | |
| Save cleaned result as new version | ✅ | |

---

## Data Exploration (Explore Tab)

| Feature | Status | Notes |
|---|---|---|
| Column Analysis | ✅ | Type in plain words (Numbers, Categories, Text, Dates, Yes / No), null %, unique count, mean, median, mode, min, max |
| Aggregation (group by + agg function) | ✅ | Sum, mean, count, min, max; rendered as bar chart |
| Suggested groupings | ✅ | "Suggested for your data": up to 3 "Average <number> by <category>" cards ranked by η² (share of the number column's variation explained by the category; one-way ANOVA effect size, shown when ≥ 0.06, "strong" ≥ 0.14) plus a row count; one click fills the controls and shows the result. ID-like and code columns are skipped |
| Trend detection per numeric column | ✅ | scikit-learn LinearRegression slope across rows (row order is the time axis, with a note that this only means something when rows are in time order) — Increasing / Stable / Decreasing / Volatile (R² < 0.1) badge |
| Trend chart | ✅ | Recharts line chart with direction label |

---

## Anomaly & Correlation Detection (Detect Tab)

| Feature | Status | Notes |
|---|---|---|
| IQR-based anomaly detection | ✅ | Per-column outlier count + sample values |
| Correlation heatmap | ✅ | Pearson, color-coded grid for all numeric columns |
| How-to help | ✅ | "How to use this page" (ⓘ) explains the IQR rule and how to read correlations |

---

## ML Predictions (Predict Tab)

| Feature | Status | Notes |
|---|---|---|
| Linear regression forecast | ✅ | scikit-learn LinearRegression |
| Date column (optional) | ✅ | Only date-like columns offered (default: none = row order). Sorts by the real dates, steps forward by the data's typical spacing (e.g. monthly), labels each forecast with its date; trend rate shown per day |
| Steps-ahead configuration (1-20) | ✅ | |
| Predicted value per step | ✅ | |
| Likely range (lower/upper bound) | ✅ | 95% prediction interval: predicted +/- t(0.975, n-2) x s x sqrt(1 + 1/n + (x0 - mean x)^2 / Sxx), s = residual standard error; widens for forecasts further ahead; verified against statsmodels; no range with fewer than 3 values |
| R-squared (model fit quality) | ✅ | Shown as High/Medium/Low confidence badge |
| Slope / trend rate | ✅ | Per-period change, color-coded |
| Forecast area chart | ✅ | Recharts AreaChart with the shaded 95% likely range |
| Results table | ✅ | Period, expected value, likely range (95%) |

---

## Manual Editing (Edit Tab)

| Feature | Status | Notes |
|---|---|---|
| Inline cell editing | ✅ | Click any cell to edit |
| Undo (Ctrl+Z) | ✅ | Last 50 edits; returns a cell to exactly its previous state (an undone edit is no longer counted as unsaved) |
| Redo (Ctrl+Y) | ✅ | Last 50 edits |
| Save edits | ✅ | Persisted to dataset as a new version |
| Draft autosave | ✅ | Unsaved edits (cells, rows, column renames) kept in the browser; survive refresh/close |
| Restore or discard draft | ✅ | On return, user chooses "Restore edits" or "Discard"; drafts from an older version are cleared, never applied |
| Leave-page warning | ✅ | Browser warns before closing/refreshing with unsaved edits |
| Suggested fixes | ✅ | Empty cells show the same fix Prepare recommends (smart fill from a related column, else median for numbers / most common value for text); fill per column or all at once (undoable). Only cells outside the IQR fences are marked as outliers; duplicate rows can be marked for deletion |
| Plain-language type badges | ✅ | 123 / Aa / date / T/F with a hover tip (e.g. "Numbers saved as text") instead of internal type names |
| Row virtualization | ✅ | @tanstack/react-virtual for large datasets |

---

## Dataset Versioning

| Feature | Status | Notes |
|---|---|---|
| Automatic snapshot on every operation | ✅ | JSONB stored in PostgreSQL |
| Version history panel | ✅ | Shows all versions as Uploaded / Cleaned / Edited / Restored from vN, with timestamps in the viewer's local time (the API sends UTC) |
| Dataset size | ✅ | Uploads show the uploaded file's size; cleaned/edited versions show their size as a CSV file |
| Restore to any version | ✅ | One-click rollback |

---

## Export

| Feature | Status | Notes |
|---|---|---|
| Export as CSV | ✅ | |
| Export as XLSX | ✅ | |
| Export as JSON | ✅ | |
| Export as Parquet | ✅ | |

---

## Visualization

| Feature | Status | Notes |
|---|---|---|
| Dashboard dataset health chart | ✅ | Recharts bar chart |
| Aggregation bar chart | ✅ | Group-by results |
| Trend line chart | ✅ | Explore tab |
| Correlation heatmap | ✅ | Detect tab |
| Prediction area chart | ✅ | Forecast with 95% likely range |
| Anomaly bar chart | ✅ | Outlier counts per column |

---

## AI Assistant (Ask AI)

| Feature | Status | Notes |
|---|---|---|
| One Ask AI panel for the whole workspace | ✅ | Opened from the workspace header; docked on the right on wide screens, bottom sheet on small ones; remembers open/closed |
| Summary per topic | ✅ | Cleaning plan (Overview, Prepare, Edit), What your data shows (Explore, Predict), Outliers & relationships (Detect) |
| Generated once per data version | ✅ | Cached while the page is open; no new AI call on tab switches; refreshed after Apply / Save / Restore or with **Regenerate** |
| Shared conversation | ✅ | Chat history kept across tabs |
| Provider | ✅ | Groq (`openai/gpt-oss-120b`); Ollama and Gemini supported as alternatives |
| Answer accuracy | ✅ | AI is told the real action names, the IQR rule, not to invent values/currency; cut-off answers trimmed to the last full sentence; only computed summaries are sent, never raw rows |

---

## UX & Reliability

| Feature | Status | Notes |
|---|---|---|
| Guided help on every tab | ✅ | "How to use this page" ⓘ next to each tab's heading: numbered steps using the real button names; opens by itself on the first visit to each tab (remembered in the browser), then on click; closes with Got it, Esc or a click outside |
| Landing page (hero, features, contact) | ✅ | |
| Contact form | ✅ | Opens the visitor's email app with the message filled in, addressed to the team email (there is no mail server, so nothing claims to be sent) |
| React Error Boundary (all tabs) | ✅ | Crash recovery — shows error + "Try again" button |
| OCR file-type callout on dashboard | ✅ | Highlights PNG/JPG image support |
| Zero TypeScript errors | ✅ | tsc --noEmit passes clean |

---

## Capstone Compliance

| Capstone Requirement | Status |
|---|---|
| Data Ingestion (CSV/Excel/JSON/OCR) | ✅ |
| Automated Data Cleaning | ✅ |
| Trend Detection (linear regression) | ✅ |
| Anomaly Detection (IQR statistical method) | ✅ |
| Visualization Dashboard | ✅ |
| Export Functionality | ✅ |
| Version Control | ✅ |
| Guided Workflow for Non-Technical Users | ✅ |
| User Authentication | ✅ |
| 100% UI Completeness | ✅ |
| 30%+ Functionality | ✅ (exceeds — ~90%+ end-to-end) |
