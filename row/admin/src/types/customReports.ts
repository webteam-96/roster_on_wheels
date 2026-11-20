// Custom report builder (api/DTOs/CustomReportDtos.cs).
export type CustomReportScope = "club" | "district";
export type CustomReportFormat = "xlsx" | "csv" | "pdf";
export type CustomReportFieldType = "text" | "number" | "date" | "bool";
export type CustomReportOp = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "empty" | "notempty";

export interface CustomReportField { key: string; label: string; type: CustomReportFieldType }
export interface CustomReportSource { key: string; label: string; fields: CustomReportField[] }

export interface CustomReportFilter { field: string; op: CustomReportOp; value: string | null }

export interface CustomReportDefinition {
  source: string;
  columns: string[];
  filters: CustomReportFilter[];
  sortBy: string | null;
  sortDesc: boolean;
  groupBy: string | null;
  sumFields: string[];
  yearId: number | null;
}

export interface SaveCustomReport {
  name: string;
  definition: CustomReportDefinition;
  scheduleMonthly: boolean;
  scheduleDay: number;
  scheduleFormat: CustomReportFormat;
}

export interface CustomReport extends SaveCustomReport {
  id: number;
  lastSentAt: string | null;
  createdByName: string | null;
  modifiedAt: string | null;
}

export interface CustomReportColumn { key: string; label: string; type: CustomReportFieldType }
export interface CustomReportResult {
  columns: CustomReportColumn[];
  rows: (string | number | null)[][];
  truncated: boolean;
}
