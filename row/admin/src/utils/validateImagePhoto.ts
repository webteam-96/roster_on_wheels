// Photo validation for any image upload across V1, V2, and the mobile API.
//
// Project rule (2026-06-10):
//   - NO minimum file size — user can upload anything from a 1 KB thumbnail up.
//   - NO minimum dimensions — older migrated photos are low-res but still valid.
//   - Maximum 5 MB stored. Anything larger is auto-compressed by
//     lib/uploadValidate.ts before this validator sees the file, so by the time
//     we get here it should already fit.
//   - `strict` mode is kept as a parameter for backwards compatibility with
//     callers, but it no longer enforces minimums — only the format + max size
//     checks remain. We keep returning dimensions + size for the UI preview.

export const PHOTO_QUALITY = {
  minWidth: 0,                    // no minimum dimension
  minHeight: 0,                   // no minimum dimension
  minBytes: 0,                    // no minimum size
  maxBytes: 5 * 1024 * 1024,      // 5 MB
  allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"] as const,
} as const;

export interface ImageInfo {
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PhotoValidationResult {
  ok: boolean;
  error?: string;
  info: ImageInfo;
}

export async function validateImagePhoto(
  file: File,
  strict: boolean = false
): Promise<PhotoValidationResult> {
  const empty: ImageInfo = { width: 0, height: 0, sizeBytes: file?.size ?? 0 };

  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected.", info: empty };
  }

  // Format check (always strict — type matters in both modes)
  const lower = file.name.toLowerCase();
  const ext = lower.includes(".") ? "." + lower.split(".").pop() : "";
  if (!PHOTO_QUALITY.allowedExtensions.includes(ext as typeof PHOTO_QUALITY.allowedExtensions[number])) {
    return {
      ok: false,
      error: `Invalid file type. Allowed: ${PHOTO_QUALITY.allowedExtensions.map(e => e.slice(1)).join(", ")}.`,
      info: empty,
    };
  }

  // Max size (always strict — prevent runaway uploads regardless of mode)
  if (file.size > PHOTO_QUALITY.maxBytes) {
    return {
      ok: false,
      error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum ${PHOTO_QUALITY.maxBytes / (1024 * 1024)} MB.`,
      info: { ...empty, sizeBytes: file.size },
    };
  }

  // Read dimensions via the browser
  const dims = await readImageDimensions(file);
  const info: ImageInfo = { width: dims.width, height: dims.height, sizeBytes: file.size };

  // No minimum-size / minimum-dimension checks per project rule. `strict` is
  // accepted for callsite compatibility but no longer enforces anything beyond
  // the format + max-size checks above.
  void strict;

  return { ok: true, info };
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

// Pretty-print "1920 × 1280 · 1.2 MB" for display next to a photo preview.
export function formatImageInfo(info: ImageInfo | null | undefined): string {
  if (!info) return "";
  const parts: string[] = [];
  if (info.width > 0 && info.height > 0) parts.push(`${info.width} × ${info.height}`);
  if (info.sizeBytes > 0) {
    const kb = info.sizeBytes / 1024;
    parts.push(kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`);
  }
  return parts.join(" · ");
}

// Quality grade chip helper — kept for any UI that wants to surface "low res"
// info alongside a preview. Always returns a chip when dimensions are known so
// the UI can still inform without blocking. Threshold is purely informational.
export function gradeImage(info: ImageInfo | null | undefined): { label: string; tone: "good" | "ok" | "low" } | null {
  if (!info || info.width === 0) return null;
  if (info.width >= 1200 && info.height >= 800) return { label: "Good quality", tone: "good" };
  if (info.width >= 800 && info.height >= 600) return { label: "Below recommended", tone: "ok" };
  return { label: "Low resolution", tone: "low" };
}

// Hint text rendered near the file picker.
export const PHOTO_UPLOAD_HINT = `JPG / PNG / WEBP · up to ${PHOTO_QUALITY.maxBytes / (1024 * 1024)} MB (larger photos auto-compressed)`;
