# Smartalyze

Smartalyze is a web-based data cleaning, analysis, and insight generation system built for non-technical users. Upload a dataset — or snap a photo of a printed table — and Smartalyze walks you through cleaning, exploring, detecting anomalies, forecasting trends, and exporting results, all without writing a single line of code.

> **Capstone Project** · Davao Del Norte State College · Bachelor of Science in Information Technology

---

## Live Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 (PostCSS) |
| Charts | Recharts 3 (Bar, Pie, Line, Area) |
| Backend | FastAPI 0.135 (Python 3.12) |
| ORM | SQLAlchemy 2 (async) |
| Data | pandas 3, scikit-learn 1.8, scipy |
| OCR | EasyOCR + img2table |
| Database | PostgreSQL (Neon Cloud) with JSONB snapshots |
| Auth | Bearer tokens, bcrypt-hashed passwords |

---

## Features

### Data Ingestion
- Upload **CSV, Excel (.xlsx/.xls), and JSON** files
- Upload a **PNG/JPG image** of a printed table — EasyOCR extracts it automatically
- File type validation (extension whitelist) returns a clean error for unsupported formats

### Automated Data Cleaning (Prepare Tab)
- Auto-detect issues: missing values, duplicates, outliers, type mismatches, whitespace
- 10+ cleaning operations: fill missing (mean/median/mode/custom), drop rows/columns, trim whitespace, normalize case, convert types, remove duplicates, replace values, rename columns, clip outliers
- Queue-based workflow: stage multiple operations, preview, then apply all at once
- Save result as a new dataset version

### Data Exploration (Explore Tab)
- **Column Analysis** — dtype, null count, unique count, mean/median/mode, min/max
- **Aggregation** — group by categorical column, aggregate numeric columns (sum, mean, count, min, max), rendered as a bar chart
- **Trends** — detect increasing/stable/decreasing trends per numeric column with directional labels

### Anomaly & Correlation Detection (Detect Tab)
- **Anomaly Detection** — IQR-based statistical outlier detection, per-column results with count and sample values
- **Correlation Analysis** — Pearson correlation heatmap across all numeric columns

### ML Predictions (Predict Tab)
- Linear regression forecast on any numeric column
- Optional date column for time-axis labeling
- Configurable steps ahead (1–20)
- Returns: predicted values, a 95% prediction interval per step (lower/upper), R², slope, trend direction badge

### Manual Editing (Edit Tab)
- Click any cell to edit its value inline
- Undo / Redo (Ctrl+Z / Ctrl+Y) with full edit history
- Row virtualization via `@tanstack/react-virtual` for large datasets
- Save edits directly to the dataset

### Dataset Versioning
- Every clean/edit operation saves a JSONB snapshot
- History panel shows all versions with timestamps
- One-click restore to any previous version

### Export
- Download the current dataset as **CSV, XLSX, JSON, or Parquet**

### Authentication
- Register, login, change username/password, delete account
- Sessions expire and revocation is enforced server-side

### UX Guidance
- Guided workflow cards on every tab explain what to do next
- Health score (% complete data) shown per dataset on the dashboard
- React Error Boundary on all tabs — a crashed tab shows a recovery button instead of a blank screen
- OCR model pre-warmed on server startup (no 30-second freeze on first image upload)

---

## Project Structure

```
smartalyze-web/
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Landing page (hero, features, contact form)
│   │   ├── dashboard/page.tsx    # Dataset list, upload, health scores
│   │   ├── dataset/[id]/page.tsx # Workspace with all 5 tabs
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── profile/page.tsx
│   ├── components/
│   │   ├── dataset/
│   │   │   ├── PrepareTab.tsx    # Cleaning workflow
│   │   │   ├── ExploreTab.tsx    # Column stats, aggregation, trends
│   │   │   ├── DetectTab.tsx     # Anomaly + correlation
│   │   │   ├── PredictTab.tsx    # ML forecast
│   │   │   └── EditTab.tsx       # Inline cell editing
│   │   └── TabErrorBoundary.tsx  # Crash recovery wrapper
│   └── lib/api.ts                # Typed API client (31 endpoints)
│
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app, middleware, startup hooks
│   │   ├── routes/               # Thin HTTP layer (auth, datasets, cleaning, analysis)
│   │   ├── services/             # Business logic + DB operations
│   │   │   ├── auth_service.py
│   │   │   ├── dataset_service.py
│   │   │   ├── cleaning_service.py
│   │   │   ├── analysis_service.py
│   │   │   └── ocr_service.py    # EasyOCR + img2table, pre-warmed on startup
│   │   ├── models/               # SQLAlchemy ORM models
│   │   ├── schemas/              # Pydantic request/response models
│   │   └── db/                   # Async engine + session
│   └── requirements.txt
│
└── README.md
```

---

## Getting Started

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
# Create a .env file with DATABASE_URL and SECRET_KEY
uvicorn app.main:app --reload
```

Backend runs on `http://localhost:8000`. Health check: `GET /` → `{"message": "Smartalyze API is running"}`

### Frontend

```bash
cd frontend
npm install
# Create a .env.local file with NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Frontend runs on `http://localhost:3000`.

---

## Design Principles

- **Dataset-first** — every feature operates on a named, versioned dataset
- **Non-technical users first** — guided workflow cards on every tab, health score UX, plain-language labels
- **No forced steps** — users can jump to any tab at any time
- **Version everything** — JSONB snapshots make every operation reversible
- **Secure by default** — tokens expire, revocation is enforced, file types are whitelisted
