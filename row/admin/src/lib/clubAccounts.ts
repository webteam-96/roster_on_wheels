/** Club accounts helpers (gap agent). Money is added in whole cents so 0.1 + 0.2 is 0.30, as on the server. */

/** A typed amount ("1,250.50") as a number with two decimals, or null when it is not a valid amount. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
}

export interface DraftLine { accountId: number | null; debit: string; credit: string }

/** Totals of a draft entry and whether the server would accept it as balanced. */
export function draftTotals(lines: DraftLine[]): { debit: number; credit: number; balanced: boolean; problem: string | null } {
  let dc = 0, cc = 0, used = 0;
  for (const l of lines) {
    const d = l.debit.trim() ? parseAmount(l.debit) : 0;
    const c = l.credit.trim() ? parseAmount(l.credit) : 0;
    if (d === null || c === null) return { debit: dc / 100, credit: cc / 100, balanced: false, problem: "One amount is not a valid number." };
    if (!d && !c) continue;
    if (d && c) return { debit: dc / 100, credit: cc / 100, balanced: false, problem: "A line is a debit or a credit, not both." };
    if (!l.accountId) return { debit: dc / 100, credit: cc / 100, balanced: false, problem: "Choose an account on every line with an amount." };
    dc += Math.round(d * 100);
    cc += Math.round(c * 100);
    used++;
  }
  const debit = dc / 100, credit = cc / 100;
  if (used < 2) return { debit, credit, balanced: false, problem: "An entry needs at least two lines." };
  if (dc !== cc) return { debit, credit, balanced: false, problem: "Debits and credits must be equal." };
  return { debit, credit, balanced: true, problem: null };
}

/** The Rotary year that holds a date: 1 July to 30 June. */
export function rotaryYearRange(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

export const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Club funds" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
] as const;
