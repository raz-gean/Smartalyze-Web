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
| CSV upload | ✅ | pandas read_csv |
| Excel upload (.xlsx / .xls) | ✅ | pandas read_excel |
| JSON upload | ✅ | pandas read_json |
| PNG/JPG image upload (OCR) | ✅ | EasyOCR + img2table, auto table extraction |
| File type whitelist validation | ✅ | 400 error for unsupported extensions |
| OCR model pre-warmed on startup | ✅ | Eliminates 20-30 s first-request delay |
| Sample dataset (one-click) | ✅ | Dashboard shortcut for demo/testing |
| Dataset health score | ✅ | % non-null cells shown on dashboard card |

---

## Data Cleaning (Prepare Tab)

| Feature | Status | Notes |
|---|---|---|
| Auto issue detection | ✅ | Missing values, duplicates, outliers, type mismatches, whitespace |
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
| Column Analysis | ✅ | dtype, null %, unique count, mean, median, mode, min, max |
| Aggregation (group by + agg function) | ✅ | Sum, mean, count, min, max; rendered as bar chart |
| Trend detection per numeric column | ✅ | Linear slope — Increasing / Stable / Decreasing / Volatile (R² < 0.1) badge |
| Trend chart | ✅ | Recharts line chart with direction label |

---

## Anomaly & Correlation Detection (Detect Tab)

| Feature | Status | Notes |
|---|---|---|
| IQR-based anomaly detection | ✅ | Per-column outlier count + sample values |
| Correlation heatmap | ✅ | Pearson, color-coded grid for all numeric columns |
| Guided workflow card | ✅ | Explains IQR method and how to interpret results |

---

## ML Predictions (Predict Tab)

| Feature | Status | Notes |
|---|---|---|
| Linear regression forecast | ✅ | scikit-learn LinearRegression |
| Date column (optional) | ✅ | Time-axis labeling |
| Steps-ahead configuration (1-20) | ✅ | |
| Predicted value per step | ✅ | |
| Confidence band (lower/upper bound) | ✅ | +/- 1 x residual standard error, sqrt(SS_res / (n-2)) (about a 68% band, not 95%) |
| R-squared (model fit quality) | ✅ | Shown as High/Medium/Low confidence badge |
| Slope / trend rate | ✅ | Per-period change, color-coded |
| Forecast area chart | ✅ | Recharts AreaChart with shaded confidence band |
| Results table | ✅ | Period, expected value, estimated range |

---

## Manual Editing (Edit Tab)

| Feature | Status | Notes |
|---|---|---|
| Inline cell editing | ✅ | Click any cell to edit |
| Undo (Ctrl+Z) | ✅ | Last 50 edits |
| Redo (Ctrl+Y) | ✅ | Last 50 edits |
| Save edits | ✅ | Persisted to dataset as a new version |
| Draft autosave | ✅ | Unsaved edits (cells, rows, column renames) kept in the browser; survive refresh/close |
| Restore or discard draft | ✅ | On return, user chooses "Restore edits" or "Discard"; drafts from an older version are cleared, never applied |
| Leave-page warning | ✅ | Browser warns before closing/refreshing with unsaved edits |
| Row virtualization | ✅ | @tanstack/react-virtual for large datasets |

---

## Dataset Versioning

| Feature | Status | Notes |
|---|---|---|
| Automatic snapshot on every operation | ✅ | JSONB stored in PostgreSQL |
| Version history panel | ✅ | Shows all versions with timestamps |
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
| Prediction area chart | ✅ | Forecast with confidence band |
| Anomaly bar chart | ✅ | Outlier counts per column |

---

## UX & Reliability

| Feature | Status | Notes |
|---|---|---|
| Guided workflow cards (all 5 tabs) | ✅ | Indigo info card at top of each workspace tab |
| Landing page (hero, features, contact) | ✅ | |
| Contact form with success feedback | ✅ | Client-side with green success banner |
| React Error Boundary (all tabs) | ✅ | Crash recovery — shows error + "Try again" button |
| OCR file-type callout on dashboard | ✅ | Highlights PNG/JPG image support |
| Zero TypeScript errors | ✅ | tsc --noEmit passes clean |

---

## Capstone Compliance

| Capstone Requirement | Status |
|---|---|
| Data Ingestion (CSV/Excel/JSON/OCR) | ✅ |
| Automated Data Cleaning | ✅ |
| ML Trend Detection | ✅ |
| ML Anomaly Detection | ✅ |
| Visualization Dashboard | ✅ |
| Export Functionality | ✅ |
| Version Control | ✅ |
| Guided Workflow for Non-Technical Users | ✅ |
| User Authentication | ✅ |
| 100% UI Completeness | ✅ |
| 30%+ Functionality | ✅ (exceeds — ~90%+ end-to-end) |
