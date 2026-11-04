// The preview fill rule on its own (lib/sample.ts), so it can be tested without a request.

/** Real rows win; an empty or missing list gets the sample rows only on a preview, never on a live visit. */
export function pickRows<T>(rows: T[] | null, isPreview: boolean, sample: () => T[]): T[] | null {
  return rows && rows.length > 0 ? rows : isPreview ? sample() : rows;
}
