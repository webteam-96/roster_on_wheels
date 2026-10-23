// Shared class names for the N5 communication pages (same look as the district meeting compliance page).
export const card = "rounded-2xl border border-slate-200 bg-white p-5";
export const input = "rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
export const btnPrimary = "rounded-lg bg-azure px-3 py-1.5 text-sm font-semibold text-cream hover:bg-mint-ink disabled:opacity-60";
export const btnSecondary = "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60";

/** The API's message, else the fallback. */
export function errorOf(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}
