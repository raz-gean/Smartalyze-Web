---
name: statistician-validation-pack
description: Use when preparing Smartalyze for statistician validation (a panel requirement) or checking that its statistics (mean/median/mode, IQR outliers, Pearson correlation, linear-regression forecast with 95% prediction intervals, trend slope) are numerically correct against independent libraries.
---

# Statistician validation pack

Goal: a small, reproducible evidence table showing Smartalyze's numbers match an independent calculation, plus a plain list of its statistical assumptions.

## Process
1. Read the implementations first, because the pack must test what the code actually does, not textbook definitions: column stats and trend in `backend/app/services/analysis_service.py`, correlation in `correlation_service.py`, outliers in `quality_detection_service.py`, the forecast (search `LinearRegression`). Note the exact choices: IQR multiplier, percentile method, how the forecast range is built (a 95% prediction interval: predicted +/- t(0.975, n-2) x s x sqrt(1 + 1/n + (x0 - mean x)^2 / Sxx); compare it with statsmodels `get_prediction().summary_frame(alpha=0.05)` obs_ci), how trend labels (Increasing/Stable/Decreasing) are thresholded.
2. Create a small deterministic dataset in the scratchpad directory (fixed seed, a known linear trend plus noise, one planted outlier, two correlated columns). Never write it into the project.
3. Call the **service functions directly** from a scratch script run from `backend/` (as `backend/tests/test_quality_detection.py` does with `sys.path`), and compute the same quantities independently with `numpy`/`scipy.stats`/`statsmodels` (install in the scratch environment only if missing; do not add to `requirements.txt`).
4. Compare with a tolerance (e.g. 1e-9 for exact stats) and produce this table for the statistician:

| Statistic | Smartalyze result | Independent result | Library/function used | Match |
|---|---|---|---|---|

5. Add a short "Method notes and limitations" section: assumptions of linear regression (linearity, independence, roughly constant variance), that the forecast range is a 95% prediction interval valid only if those assumptions hold (fewer than 3 values: no range), that IQR flags outliers without assuming normality, Pearson measures linear association only, and that missing values are handled as the code does.

## Rules
- Do not change app code. If a result mismatches, report it as a finding with the inputs, both values, and the suspected cause; do not "fix" it silently. A deliberate difference (e.g. sample vs population std, percentile interpolation) is documented, not hidden.
- Save the table as Markdown in the scratchpad and show it to the user. Only write it to `docs/` if they ask.
- Be honest that this verifies numerical correctness; it does not replace the statistician's judgment on method suitability.
