/**
 * Port of PhoneNumberNormalizer.cs: the number column holds the national part;
 * a leading "+<country code>" typed into it is removed (up to three times).
 */
const SEPARATED_CODE = /^\+\d{1,4}[\s\-.]+/;

export function stripCountryCode(number: string | null | undefined, phoneCode: string | null | undefined): string | null | undefined {
  if (!number || !number.trim()) return number;
  let n = number.trim();
  for (let i = 0; i < 3 && n.startsWith("+"); i++) {
    const next = stripOnce(n, phoneCode);
    if (next === n) break;
    n = next;
  }
  return n;
}

function stripOnce(n: string, phoneCode: string | null | undefined): string {
  const codeDigits = (phoneCode ?? "").replace(/\D/g, "");
  const afterPlus = n.slice(1).trimStart();
  if (codeDigits && afterPlus.startsWith(codeDigits)) {
    const rest = afterPlus.slice(codeDigits.length).replace(/^[ \-.]+/, "");
    if (/\d/.test(rest)) return rest.trim();
  }
  const m = SEPARATED_CODE.exec(n);
  if (m) {
    const rest = n.slice(m[0].length).trim();
    if (/\d/.test(rest)) return rest;
  }
  return n;
}
