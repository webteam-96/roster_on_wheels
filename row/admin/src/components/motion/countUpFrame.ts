// Frames of a KPI count-up. The value is already formatted for the viewer's locale ("$6.7K", "4,118", "1.234,50"),
// so only its digits are counted; every other character stays where the formatter put it.

const NUMBER = /\d(?:[\d.,\s'’]*\d)?/;

/** Decimal digits of a formatted number: a last separator followed by exactly three digits is a thousands one. */
function decimals(num: string): number {
  const tail = /[.,](\d+)$/.exec(num)?.[1] ?? "";
  return tail.length === 3 ? 0 : tail.length;
}

/** The text to show at `progress` 0..1, or null when the value has no single number to count ("2/5", "2026-27"). */
export function countUpFrame(value: string, progress: number): string | null {
  const m = NUMBER.exec(value);
  if (!m) return null;
  const [num] = m;
  const head = value.slice(0, m.index);
  const rest = value.slice(m.index + num.length);
  const digits = num.replace(/\D/g, "");
  if (/\d/.test(rest) || digits.length > 12) return null;
  if (progress >= 1) return value;

  const now = String(Math.round(Number(digits) * progress)).padStart(decimals(num) + 1, "0");
  // Put the separators back from the right and stop where the shorter number runs out of digits.
  let out = "";
  for (let i = num.length - 1, d = now.length - 1; i >= 0 && d >= 0; i--) {
    out = (/\d/.test(num[i]) ? now[d--] : num[i]) + out;
  }
  return head + out + rest;
}
