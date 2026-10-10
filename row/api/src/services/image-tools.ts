import sharp from "sharp";
import { basename, extname } from "node:path";
import type { UploadedFile } from "./media-storage";

/**
 * Ports of ImageCompressor.cs and ImageQualityValidator.cs.
 *
 * Compressor: a raster photo over 5 MB (e.g. from the mobile app, which does
 * not shrink photos) is scaled to a 2560px longest side and re-encoded as
 * JPEG at falling quality until it fits. Anything within budget, or anything
 * that fails to decode, is returned unchanged.
 *
 * Validator: format and max size only (no minimums since 2026-06-10); width
 * and height are read from the file header for display.
 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 2560;
const COMPRESSIBLE = [".jpg", ".jpeg", ".png", ".webp"];
export const DEFAULT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

export async function ensureWithinLimit(file: UploadedFile | undefined, maxBytes = IMAGE_MAX_BYTES, maxDimension = MAX_DIMENSION): Promise<UploadedFile | undefined> {
  if (!file || file.size === 0 || file.size <= maxBytes) return file;
  const ext = extname(file.originalname).toLowerCase();
  if (!COMPRESSIBLE.includes(ext)) return file;
  try {
    const meta = await sharp(file.buffer).metadata();
    if (!meta.width || !meta.height) return file;
    let pipeline = sharp(file.buffer).rotate();
    if (Math.max(meta.width, meta.height) > maxDimension) pipeline = pipeline.resize({ width: maxDimension, height: maxDimension, fit: "inside" });
    const raw = await pipeline.toBuffer();
    let best: Buffer | null = null;
    for (let quality = 90; quality >= 35; quality -= 10) {
      best = await sharp(raw).jpeg({ quality }).toBuffer();
      if (best.length <= maxBytes) break;
    }
    if (!best || best.length >= file.size) return file;
    return { ...file, originalname: basename(file.originalname, extname(file.originalname)) + ".jpg", buffer: best, size: best.length, mimetype: "image/jpeg" };
  } catch {
    return file;
  }
}

export interface ImageValidation {
  ok: boolean;
  error: string | null;
  width: number;
  height: number;
  sizeBytes: number;
}

export function validateImage(file: UploadedFile | undefined, _strict: boolean, allowedExtensions: string[] = DEFAULT_IMAGE_EXTENSIONS, maxBytes = IMAGE_MAX_BYTES): ImageValidation {
  if (!file || file.size === 0) return { ok: false, error: "No file uploaded.", width: 0, height: 0, sizeBytes: 0 };
  const ext = extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return { ok: false, error: `Invalid file type. Allowed: ${allowedExtensions.map((e) => e.replace(/^\./, "")).join(", ")}.`, width: 0, height: 0, sizeBytes: file.size };
  }
  if (file.size > maxBytes) {
    const mb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
    return { ok: false, error: `File too large (${mb} MB). Maximum ${Math.floor(maxBytes / (1024 * 1024))} MB.`, width: 0, height: 0, sizeBytes: file.size };
  }
  const [width, height] = readDimensions(file.buffer, ext);
  return { ok: true, error: null, width, height, sizeBytes: file.size };
}

function readDimensions(b: Buffer, ext: string): [number, number] {
  try {
    switch (ext) {
      case ".png":
        if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return [0, 0];
        return [b.readInt32BE(16), b.readInt32BE(20)];
      case ".gif":
        if (b.length < 10 || b.toString("ascii", 0, 3) !== "GIF") return [0, 0];
        return [b.readUInt16LE(6), b.readUInt16LE(8)];
      case ".webp": {
        if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return [0, 0];
        const chunk = b.toString("ascii", 12, 16);
        if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
        if (chunk === "VP8L") {
          const [b1, b2, b3, b4] = [b[21], b[22], b[23], b[24]];
          return [(b1 | ((b2 & 0x3f) << 8)) + 1, ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) + 1];
        }
        if (chunk === "VP8X") return [(b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1];
        return [0, 0];
      }
      case ".jpg":
      case ".jpeg": {
        if (b[0] !== 0xff || b[1] !== 0xd8) return [0, 0];
        let i = 2;
        while (i < b.length) {
          while (i < b.length && b[i] !== 0xff) i++;
          while (i < b.length && b[i] === 0xff) i++;
          if (i >= b.length) return [0, 0];
          const marker = b[i++];
          if (marker === 0xd9 || marker === 0xda) return [0, 0];
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            if (i + 7 > b.length) return [0, 0];
            return [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)];
          }
          if (i + 2 > b.length) return [0, 0];
          const len = b.readUInt16BE(i);
          if (len < 2) return [0, 0];
          i += len;
        }
        return [0, 0];
      }
      default:
        return [0, 0];
    }
  } catch {
    return [0, 0];
  }
}

export const PHOTO_MAX_EDGE = 2560;
export const PHOTO_JPEG_QUALITY = 88;
// shortcut: sharp cannot decode BMP, so BMP uploads are kept as sent (RIZones re-encoded them); add a BMP decoder if that matters.
const OPTIMIZABLE = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

/**
 * Port of PhotoEncoder.cs: longest side capped at 2560 px (never enlarged), the phone's
 * rotation applied, saved as JPEG 88. PNG/WEBP with real transparency keep their format and
 * are re-saved only when they had to be shrunk. The new bytes are returned only when clearly
 * smaller (or shrunk); otherwise, and on any failure, null = keep the original.
 */
export async function encodePhoto(original: Buffer, extension: string, quality = PHOTO_JPEG_QUALITY, maxEdge = PHOTO_MAX_EDGE): Promise<{ bytes: Buffer; extension: string; contentType: string; width: number; height: number } | null> {
  try {
    const ext = extension.toLowerCase();
    const meta = await sharp(original, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    const resize = Math.max(meta.width, meta.height) > maxEdge;
    // Only a pixel with alpha < 255 means the transparency must be kept (screenshots often carry an opaque alpha channel).
    const transparent = !!meta.hasAlpha && (await sharp(original, { failOn: "none" }).stats()).channels[3]?.min < 255;
    if (transparent && !resize) return null;
    let pipeline = sharp(original, { failOn: "none" }).rotate();
    if (resize) pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: "inside", kernel: "mitchell" });
    let out: { data: Buffer; info: sharp.OutputInfo };
    let newExt: string, contentType: string;
    if (!transparent) {
      out = await pipeline.jpeg({ quality }).toBuffer({ resolveWithObject: true });
      [newExt, contentType] = [".jpg", "image/jpeg"];
    } else if (ext === ".webp") {
      out = await pipeline.webp({ quality }).toBuffer({ resolveWithObject: true });
      [newExt, contentType] = [".webp", "image/webp"];
    } else {
      out = await pipeline.png().toBuffer({ resolveWithObject: true });
      [newExt, contentType] = [".png", "image/png"];
    }
    const worthIt = out.data.length < original.length * 0.9 || (resize && out.data.length < original.length);
    return worthIt ? { bytes: out.data, extension: newExt, contentType, width: out.info.width, height: out.info.height } : null;
  } catch {
    return null; // never fail an upload because of optimisation
  }
}

/** Port of PhotoOptimizer.cs: the upload re-saved by encodePhoto (same field, new name/extension), or the original. */
export async function optimizePhoto<T extends UploadedFile>(file: T): Promise<{ file: T; changed: boolean }> {
  const ext = extname(file.originalname ?? "").toLowerCase();
  if (!file.size || !OPTIMIZABLE.includes(ext)) return { file, changed: false };
  const enc = await encodePhoto(file.buffer, ext);
  if (!enc) return { file, changed: false };
  const base = basename(file.originalname, extname(file.originalname)).trim() || "photo";
  return { file: { ...file, originalname: base + enc.extension, buffer: enc.bytes, size: enc.bytes.length, mimetype: enc.contentType }, changed: true };
}
