import type { Money } from "@/types/serviceHours";

/** Amounts per currency as one line ("LKR 1,500.00; USD 50.00"); empty when there are none. */
export function moneyLine(list: Money[], money: (amount: number, currency?: string | null) => string): string {
  return list.map((m) => money(m.amount, m.currency || null)).join("; ");
}

/** The amount typed in a form, or null when it is not a positive number with at most two decimals. */
export function parseAmount(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** The file name for a downloaded report. */
export function reportFileName(scope: string, yearLabel: string): string {
  const slug = scope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "service";
  return `${slug}-service-report-${yearLabel}.xlsx`;
}

/** Saves a downloaded file in the browser. */
export function saveBlob(blob: Blob, name: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.URL.revokeObjectURL(url);
}
