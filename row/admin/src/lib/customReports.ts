import type {
  CustomReportDefinition, CustomReportField, CustomReportFieldType, CustomReportOp,
} from "@/types/customReports";

// Helpers for the report builder (api/Services/CustomReportQuery.cs holds the rules and the whitelist).

export const OP_LABELS: Record<CustomReportOp, string> = {
  eq: "is", neq: "is not", contains: "contains", gt: "is more than", gte: "is at least",
  lt: "is less than", lte: "is at most", empty: "is empty", notempty: "is not empty",
};

/** The operators that make sense for a field type (same rule as the server). */
export function opsFor(type: CustomReportFieldType): CustomReportOp[] {
  if (type === "text") return ["eq", "neq", "contains", "empty", "notempty"];
  if (type === "bool") return ["eq"];
  return ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notempty"];
}

export const needsValue = (op: CustomReportOp): boolean => op !== "empty" && op !== "notempty";

export function emptyDefinition(source: string): CustomReportDefinition {
  return { source, columns: [], filters: [], sortBy: null, sortDesc: false, groupBy: null, sumFields: [], yearId: null };
}

/** Drops whatever does not belong to the chosen source's fields (after the source changes). */
export function keepValid(d: CustomReportDefinition, fields: CustomReportField[]): CustomReportDefinition {
  const keys = new Set(fields.map((f) => f.key));
  const numbers = new Set(fields.filter((f) => f.type === "number").map((f) => f.key));
  return {
    ...d,
    columns: d.columns.filter((c) => keys.has(c)),
    filters: d.filters.filter((f) => keys.has(f.field)),
    sortBy: d.sortBy && (keys.has(d.sortBy) || d.sortBy === "count") ? d.sortBy : null,
    groupBy: d.groupBy && keys.has(d.groupBy) ? d.groupBy : null,
    sumFields: d.sumFields.filter((s) => numbers.has(s)),
  };
}

/** A problem the server would reject, said before the round trip; null when the definition can run. */
export function definitionProblem(d: CustomReportDefinition): string | null {
  if (!d.source) return "Choose a source.";
  if (!d.groupBy && d.columns.length === 0) return "Choose at least one column, or a field to group by.";
  const missing = d.filters.find((f) => needsValue(f.op) && !(f.value ?? "").trim());
  if (missing) return "Every filter needs a value.";
  return null;
}

/** Display text for a cell; bool columns come as 1 / 0. */
export function cellText(
  value: string | number | null, type: CustomReportFieldType,
  fmt: { number: (n: number) => string; date: (d: string) => string },
): string {
  if (value == null || value === "") return "";
  if (type === "bool") return Number(value) === 1 ? "Yes" : "No";
  if (type === "number") return fmt.number(Number(value));
  if (type === "date") return fmt.date(String(value));
  return String(value);
}
