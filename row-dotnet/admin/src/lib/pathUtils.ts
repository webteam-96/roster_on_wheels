// Reduce a stored/preview path to just the filename so the DB keeps filename-only values
// (the API rebuilds the full URL on read). e.g. "/uploads/advertisement/x.png" -> "x.png".
export function fileNameOnly(path?: string | null): string {
  if (!path) return "";
  return path.split("/").pop() || "";
}
