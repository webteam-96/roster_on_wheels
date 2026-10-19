// ===== Upload validator + client-side image compressor =====
//
// Project rule (2026-06-10, revised):
//   Photos:    NO minimum size · max 5 MB stored. Anything between 5 MB and
//              the hard cap is auto-compressed to ≤ 5 MB. Above the hard cap → reject.
//   Documents: NO minimum size · max 20 MB stored. Above 20 MB → reject.
//   Hard cap:  50 MB for any upload type. Above this → alert before upload.
//
// The compressor never blurs — it resizes to a 2560 px long edge and steps JPEG
// quality from 0.92 down only as needed to fit, never below a 0.55 clarity floor.
//
// The backend ALSO enforces request body limits — this is the user-experience
// layer, not the security layer. Anyone bypassing the UI hits Program.cs's
// MaxRequestBodySize and gets a 413.

export const PHOTO_MAX_MB = 5;
export const DOC_MAX_MB = 20;
export const HARD_CAP_MB = 50;

// Kept as the legacy alias — older callers import MAX_STORED_MB. Defaults to
// the photo cap because that's the historical meaning.
export const MAX_STORED_MB = PHOTO_MAX_MB;

const PHOTO_MAX_BYTES = PHOTO_MAX_MB * 1024 * 1024;
const DOC_MAX_BYTES = DOC_MAX_MB * 1024 * 1024;
const HARD_CAP_BYTES = HARD_CAP_MB * 1024 * 1024;

const COMPRESS_MAX_EDGE_PX = 2560;        // long edge — high enough for retina display, low enough to fit 5MB
const COMPRESS_QUALITY_START = 0.92;       // start near-lossless
const COMPRESS_QUALITY_FLOOR = 0.55;       // never go below this — keeps photos clear, not blurry
const COMPRESS_QUALITY_STEP = 0.07;        // each retry drops quality this much

export class UploadValidationError extends Error {
  constructor(message: string) { super(message); this.name = "UploadValidationError"; }
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

// Browsers tag HEIC/HEIF without web image MIME on some platforms — accept by extension too.
function isLikelyImageByName(name: string): boolean {
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(name);
}

// Load an HTMLImageElement from a File. Cleans up the object URL when done.
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Resize the image to fit COMPRESS_MAX_EDGE_PX (keep aspect ratio).
// Then iteratively re-encode JPEG with decreasing quality until the result
// fits MAX_STORED_BYTES. Quality floor protects clarity — if we'd need to go
// lower we re-shrink the canvas instead.
async function compressImage(file: File): Promise<File> {
  const img = await loadImage(file);

  // First, downscale only if the image is larger than the max edge.
  const longEdge = Math.max(img.width, img.height);
  let scale = longEdge > COMPRESS_MAX_EDGE_PX ? COMPRESS_MAX_EDGE_PX / longEdge : 1;

  // The same canvas is reused across quality attempts; only scale changes if we
  // need to shrink further.
  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UploadValidationError("Browser does not support image compression.");
    // imageSmoothingQuality: 'high' gives Lanczos-like resampling on modern browsers — keeps detail crisp.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    // Try quality from start, stepping down. Stop on first fit.
    for (let q = COMPRESS_QUALITY_START; q >= COMPRESS_QUALITY_FLOOR; q -= COMPRESS_QUALITY_STEP) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", q),
      );
      if (!blob) continue;
      if (blob.size <= PHOTO_MAX_BYTES) {
        // Preserve original base filename, swap extension to .jpg.
        const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      }
    }

    // Didn't fit even at the quality floor — shrink the canvas by 15% and retry.
    scale *= 0.85;
  }

  throw new UploadValidationError(
    `Unable to compress image below ${PHOTO_MAX_MB} MB. Please use a smaller photo.`,
  );
}

/**
 * Validate and (if needed) compress a file before upload.
 *
 * - throws UploadValidationError if the file is unrecoverable (too big, document over cap, etc.)
 * - returns the original File if it's already under MAX_STORED_BYTES
 * - returns a NEW compressed File for oversized images
 *
 * @param file        the user-selected file
 * @param treatAsImage  override autodetection (e.g. for "image required" fields)
 */
export async function validateAndProcessUpload(
  file: File,
  treatAsImage?: boolean,
): Promise<File> {
  if (!file) throw new UploadValidationError("No file selected.");

  // Hard cap — refuse anything monstrous. 200 MB DSLR raw etc. lands here.
  if (file.size > HARD_CAP_BYTES) {
    throw new UploadValidationError(
      `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is ${HARD_CAP_MB} MB. Please reduce the file size and try again.`,
    );
  }

  const treatedAsImage = treatAsImage ?? (isImageFile(file) || isLikelyImageByName(file.name));

  if (treatedAsImage) {
    // Photo path: compress to ≤ 5 MB if larger, otherwise pass through.
    if (file.size <= PHOTO_MAX_BYTES) return file;
    return await compressImage(file);
  }

  // Document path: PDF/Word/Excel etc. — accept anything up to 20 MB. Above
  // that, reject (no safe auto-compress for documents).
  if (file.size <= DOC_MAX_BYTES) return file;
  throw new UploadValidationError(
    `Document max ${DOC_MAX_MB} MB: your file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Please reduce the file size and try again.`,
  );
}

// ===== Document / attachment upload UX helpers ==============================
//
// Added 2026-08 so every newsletter and document attachment screen shows the
// SAME limit hint up front (the way PhotoUpload does) and the SAME specific
// failure afterwards, instead of a generic "Failed to upload file.".
//
// These do NOT change any limit — DOC_MAX_MB (20) is what every newsletter /
// document upload endpoint enforces server-side.

/** Extension whitelists — these mirror the server's own checks. */
export const PDF_ONLY_EXTENSIONS: readonly string[] = [".pdf"];
export const DOC_EXTENSIONS: readonly string[] = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
];

/** "34.2 MB" / "780 KB" — so an error can state the file's ACTUAL size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** [".pdf", ".docx"] → "PDF, DOCX" */
function extensionLabel(exts: readonly string[]): string {
  return exts.map((x) => x.replace(/^\./, "").toUpperCase()).join(", ");
}

/**
 * The one-line hint rendered next to a document/newsletter file input.
 * Mirrors the photo-upload treatment ("JPG, PNG, WEBP · up to 5 MB …").
 */
export function documentUploadHint(exts: readonly string[] = DOC_EXTENSIONS): string {
  const label = extensionLabel(exts);
  return exts.length === 1
    ? `${label} only · up to ${DOC_MAX_MB} MB`
    : `${label} · up to ${DOC_MAX_MB} MB`;
}

/**
 * Client-side pre-check, run BEFORE the request goes out so a 34 MB file fails
 * instantly with a clear message instead of after a long upload.
 * Throws UploadValidationError.
 */
export function validateDocumentFile(
  file: File,
  exts: readonly string[] = DOC_EXTENSIONS,
): void {
  if (!file) throw new UploadValidationError("No file selected.");

  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!exts.includes(ext)) {
    throw new UploadValidationError(
      `"${file.name}" is not an accepted file type. ${extensionLabel(exts)} only.`,
    );
  }
  if (file.size === 0) {
    throw new UploadValidationError(
      `"${file.name}" is empty (0 bytes). Please choose a different file.`,
    );
  }
  if (file.size > DOC_MAX_BYTES) {
    throw new UploadValidationError(
      `This file is ${formatFileSize(file.size)}. The limit is ${DOC_MAX_MB} MB. Please compress it or choose a smaller file.`,
    );
  }
}

type MaybeHttpError = {
  response?: { status?: number; data?: unknown };
  code?: string;
  message?: string;
};

/**
 * Turn ANY upload failure into something the user can act on.
 *
 * Order matters:
 *  1. UploadValidationError  — already user-facing (size / type / compression).
 *  2. HTTP 413               — IIS/Kestrel refuse the body outright and often
 *                              return an EMPTY body, so there is no { message }
 *                              to read. Handled explicitly or the user gets a
 *                              blank error dialog.
 *  3. { message } from the API — this API returns that shape on 4xx.
 *  4. Any other status / network / timeout — named explicitly.
 */
export function describeUploadError(
  err: unknown,
  fallback = "Upload failed. Please try again.",
): string {
  if (err instanceof UploadValidationError) return err.message;

  const e = (err ?? {}) as MaybeHttpError;
  const status = e.response?.status;

  if (status === 413) {
    return `The file is too large for the server to accept (limit ${DOC_MAX_MB} MB). Please compress it or choose a smaller file.`;
  }

  // Read the server's own message when it sent one. IIS error pages come back
  // as raw HTML — never show that to a user.
  const data = e.response?.data;
  let serverMessage = "";
  if (typeof data === "string") serverMessage = data.trim();
  else if (data && typeof (data as { message?: unknown }).message === "string") {
    serverMessage = ((data as { message?: string }).message ?? "").trim();
  }
  if (serverMessage && !serverMessage.startsWith("<") && serverMessage.length <= 300) {
    return serverMessage;
  }

  if (status === 401 || status === 403) {
    return "You are not allowed to upload here. Please sign in again and retry.";
  }
  if (status) {
    return `Upload failed: the server returned an error (${status}). Please try again, or contact support if it keeps happening.`;
  }
  if (e.code === "ECONNABORTED") {
    return "Upload timed out. Please check your connection and try again.";
  }
  if (e.code === "ERR_NETWORK" || e.message === "Network Error") {
    return "Upload failed: could not reach the server. Check your internet connection and try again.";
  }

  return fallback;
}

/**
 * Convenience wrapper for code that wants a clear yes/no without throwing.
 * Returns either { ok: true, file } or { ok: false, error }.
 */
export async function tryValidateAndProcessUpload(
  file: File,
  treatAsImage?: boolean,
): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  try {
    const out = await validateAndProcessUpload(file, treatAsImage);
    return { ok: true, file: out };
  } catch (e) {
    return { ok: false, error: e instanceof UploadValidationError ? e.message : "Upload validation failed." };
  }
}
