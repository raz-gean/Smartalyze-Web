// Plain-language names for the column types the data scan and analysis report,
// so internal names such as "datetime_string" never reach the screen.

export type ColumnTypeInfo = { label: string; tip: string };

const COLUMN_TYPES: Record<string, ColumnTypeInfo> = {
  numeric:         { label: "Numbers",               tip: "Numbers: supports averages, totals and charts" },
  numeric_string:  { label: "Numbers saved as text", tip: "Looks like numbers but is stored as text; convert it in Prepare" },
  categorical:     { label: "Categories",            tip: "Repeated labels: supports grouping and counts" },
  text:            { label: "Text",                  tip: "Free text: supports grouping and counts" },
  datetime:        { label: "Dates",                 tip: "Dates: supports trends over time" },
  datetime_string: { label: "Dates saved as text",   tip: "Looks like dates but is stored as text; convert it in Prepare" },
  boolean:         { label: "Yes / No",              tip: "Yes / No (true / false) values" },
  unknown:         { label: "Empty",                 tip: "No values to detect a type from" },
};

export function columnTypeInfo(type: string | null | undefined): ColumnTypeInfo {
  return COLUMN_TYPES[(type ?? "unknown").toLowerCase()] ?? { label: "Other", tip: "Mixed or unrecognised values" };
}
