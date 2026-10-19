import type { CleaningOperation } from "@/lib/api";

function quoteSingle(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function quoteList(values: string[]): string {
  return `[${values.map(quoteSingle).join(", ")}]`;
}

function colsOrAll(op: CleaningOperation): string[] {
  if (op.columns && op.columns.length > 0) return op.columns;
  if (op.column) return [op.column];
  return [];
}

function operationToPandas(op: CleaningOperation, idx: number): string[] {
  const lines: string[] = [];
  const stepHeader = `# Step ${idx + 1}: ${op.operation_type}`;
  lines.push(stepHeader);

  switch (op.operation_type) {
    case "fill_mean": {
      const cols = colsOrAll(op);
      if (cols.length === 0) {
        lines.push("df = df.fillna(df.mean(numeric_only=True))");
      } else {
        lines.push(`for _col in ${quoteList(cols)}:`);
        lines.push("    df[_col] = df[_col].fillna(df[_col].mean())");
      }
      break;
    }
    case "fill_median": {
      const cols = colsOrAll(op);
      if (cols.length === 0) {
        lines.push("df = df.fillna(df.median(numeric_only=True))");
      } else {
        lines.push(`for _col in ${quoteList(cols)}:`);
        lines.push("    df[_col] = df[_col].fillna(df[_col].median())");
      }
      break;
    }
    case "fill_mode": {
      const cols = colsOrAll(op);
      const target = cols.length === 0 ? "df.columns" : quoteList(cols);
      lines.push(`for _col in ${target}:`);
      lines.push("    _modes = df[_col].mode(dropna=True)");
      lines.push("    if len(_modes) > 0:");
      lines.push("        df[_col] = df[_col].fillna(_modes.iloc[0])");
      break;
    }
    case "drop_rows": {
      const cols = colsOrAll(op);
      if (op.drop_all_missing || cols.length === 0) {
        lines.push("df = df.dropna(how='any').reset_index(drop=True)");
      } else {
        lines.push(`df = df.dropna(subset=${quoteList(cols)}).reset_index(drop=True)`);
      }
      break;
    }
    case "remove_all_duplicates": {
      lines.push("df = df.drop_duplicates().reset_index(drop=True)");
      break;
    }
    case "convert_column_type": {
      const cols = colsOrAll(op);
      const target = op.target_type ?? "string";
      const pandasMap: Record<string, string> = {
        numeric: "pd.to_numeric(df[_col], errors='coerce')",
        string: "df[_col].astype('string')",
        datetime: "pd.to_datetime(df[_col], errors='coerce')",
        categorical: "df[_col].astype('category')",
        boolean: "df[_col].astype('boolean')",
      };
      const expr = pandasMap[target] ?? "df[_col].astype('string')";
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push(`    df[_col] = ${expr}`);
      break;
    }
    case "trim_whitespace": {
      const cols = colsOrAll(op);
      const target = cols.length === 0 ? "df.select_dtypes(include='object').columns" : quoteList(cols);
      lines.push(`for _col in ${target}:`);
      lines.push("    df[_col] = df[_col].astype('string').str.strip()");
      break;
    }
    case "lowercase_column": {
      const cols = colsOrAll(op);
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push("    df[_col] = df[_col].astype('string').str.lower()");
      break;
    }
    case "standardize_dates": {
      const cols = colsOrAll(op);
      const fmtMap: Record<string, string> = { iso: "%Y-%m-%d", us: "%m/%d/%Y", eu: "%d/%m/%Y" };
      const fmt = op.output_format ? fmtMap[op.output_format] : "%Y-%m-%d";
      const dayfirst = op.dayfirst_hint === "day" ? "True" : op.dayfirst_hint === "month" ? "False" : "False";
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push(`    _parsed = pd.to_datetime(df[_col], errors='coerce', dayfirst=${dayfirst})`);
      if (op.unparseable_action === "null") {
        lines.push(`    df[_col] = _parsed.dt.strftime(${quoteSingle(fmt)})`);
      } else {
        lines.push(`    df[_col] = _parsed.dt.strftime(${quoteSingle(fmt)}).fillna(df[_col])`);
      }
      break;
    }
    case "sort_values": {
      const cols = colsOrAll(op);
      const ascending = op.ascending !== false;
      lines.push(`df = df.sort_values(by=${quoteList(cols)}, ascending=${ascending ? "True" : "False"}).reset_index(drop=True)`);
      break;
    }
    case "fill_pattern": {
      const key = op.key_column ?? "";
      const target = op.target_column_fill ?? "";
      lines.push(`# Pattern fill: group by ${quoteSingle(key)} (ignoring case and extra spaces), fill missing values in ${quoteSingle(target)} with the per-group mode.`);
      lines.push(`_key = df[${quoteSingle(key)}].map(lambda v: (str(v).strip().casefold() or None) if pd.notna(v) else None)`);
      lines.push(`def _pattern_fill(s):`);
      lines.push(`    _m = s.mode(dropna=True)`);
      lines.push(`    return s.fillna(_m.iloc[0]) if len(_m) > 0 else s`);
      lines.push(`df[${quoteSingle(target)}] = df[${quoteSingle(target)}].fillna(df.groupby(_key, dropna=True)[${quoteSingle(target)}].transform(_pattern_fill))`);
      break;
    }
    case "derive_column": {
      const name = op.new_column_name ?? "new_column";
      const expr = op.expression ?? "0";
      lines.push(`# Derived column from formula. df.eval supports bare column names + arithmetic;`);
      lines.push(`# if your expression uses helpers like abs/round/min/max, rewrite with df.apply.`);
      lines.push(`df[${quoteSingle(name)}] = df.eval(${quoteSingle(expr)})`);
      break;
    }
    case "standardize_categories": {
      const col = op.column ?? (op.columns && op.columns[0]) ?? "";
      const mapping = op.value_mapping ?? {};
      const entries = Object.entries(mapping)
        .map(([from, to]) => `${quoteSingle(from)}: ${quoteSingle(to)}`)
        .join(", ");
      lines.push(`# Collapse inconsistent category labels to canonical values.`);
      lines.push(`df[${quoteSingle(col)}] = df[${quoteSingle(col)}].replace({${entries}})`);
      break;
    }
    case "replace_with_missing": {
      const cols = colsOrAll(op);
      const tokens = op.missing_tokens && op.missing_tokens.length > 0
        ? op.missing_tokens
        : ["NA", "N/A", "n/a", "none", "null", "nan", "-", "?", "unknown", "missing", "Not applicable"];
      lines.push("import numpy as np");
      lines.push(`_missing_tokens = [t.strip().casefold() for t in ${quoteList(tokens)}]`);
      lines.push(`for _col in ${quoteList(cols)}:`);
      lines.push(`    _norm = df[_col].astype('string').str.strip().str.casefold()`);
      lines.push(`    df.loc[_norm.isin(_missing_tokens), _col] = np.nan`);
      break;
    }
    case "remove_outliers": {
      const col = op.column ?? (op.columns && op.columns[0]) ?? "";
      lines.push(`# Drop rows where ${col} is an IQR outlier (Q1-1.5*IQR / Q3+1.5*IQR).`);
      lines.push(`_vals = pd.to_numeric(df[${quoteSingle(col)}], errors='coerce')`);
      lines.push(`_q1, _q3 = _vals.quantile(0.25), _vals.quantile(0.75)`);
      lines.push(`_iqr = _q3 - _q1`);
      lines.push(`_low, _high = _q1 - 1.5 * _iqr, _q3 + 1.5 * _iqr`);
      lines.push(`df = df[~(_vals.notna() & ((_vals < _low) | (_vals > _high)))].reset_index(drop=True)`);
      break;
    }
    case "nullify_outliers": {
      const col = op.column ?? (op.columns && op.columns[0]) ?? "";
      lines.push("import numpy as np");
      lines.push(`# Blank out IQR outliers in ${col} (rows kept) so they can be filled afterward.`);
      lines.push(`_vals = pd.to_numeric(df[${quoteSingle(col)}], errors='coerce')`);
      lines.push(`_q1, _q3 = _vals.quantile(0.25), _vals.quantile(0.75)`);
      lines.push(`_iqr = _q3 - _q1`);
      lines.push(`_low, _high = _q1 - 1.5 * _iqr, _q3 + 1.5 * _iqr`);
      lines.push(`df.loc[_vals.notna() & ((_vals < _low) | (_vals > _high)), ${quoteSingle(col)}] = np.nan`);
      break;
    }
    default: {
      lines.push(`# Operation '${op.operation_type}' has no pandas translation yet.`);
    }
  }

  return lines;
}

export function operationsToPandasScript(ops: CleaningOperation[], datasetName: string): string {
  const safeName = datasetName.replace(/'/g, "");
  const header = [
    `"""Reproducible cleaning script generated by Smartalyze.`,
    ``,
    `Dataset: ${safeName}`,
    `Generated: ${new Date().toISOString()}`,
    `Operations: ${ops.length}`,
    ``,
    `Usage:`,
    `    1. Place your source file next to this script (CSV assumed).`,
    `    2. Adjust the read_* call below if your file is XLSX or JSON.`,
    `    3. Run: python ${safeName.replace(/[^A-Za-z0-9_-]/g, "_") || "cleaning_script"}.py`,
    `"""`,
    ``,
    `import pandas as pd`,
    ``,
    `# Load the dataset — update this path for your environment.`,
    `df = pd.read_csv(${quoteSingle(safeName)})`,
    ``,
  ];

  const body: string[] = [];
  if (ops.length === 0) {
    body.push(`# No cleaning operations were queued.`);
  } else {
    ops.forEach((op, idx) => {
      body.push(...operationToPandas(op, idx));
      body.push("");
    });
  }

  const footer = [
    `# Save the cleaned dataset.`,
    `df.to_csv(${quoteSingle("cleaned_" + safeName)}, index=False)`,
    `print(f"Saved cleaned dataset: {len(df)} rows, {len(df.columns)} columns.")`,
    ``,
  ];

  return [...header, ...body, ...footer].join("\n");
}
