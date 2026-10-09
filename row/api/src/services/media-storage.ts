import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import type { AppConfig } from "../config/app-config";

/**
 * Where uploaded files live: Media:WebRoot when it exists, else ./wwwroot
 * (IWebHostEnvironment.WebRootPath in the C#). main.ts serves this folder.
 */
export function webRootPath(config: AppConfig): string {
  const configured = config.get("Media:WebRoot");
  return configured && existsSync(configured) ? configured : join(process.cwd(), "wwwroot");
}

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

/** Save under webRoot/<folder...> as "<guid><ext>", as the C# upload helpers do. Returns the file name. */
export async function saveWithGuidName(config: AppConfig, file: UploadedFile, ...folder: string[]): Promise<string> {
  const dir = join(webRootPath(config), ...folder);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}${extname(file.originalname)}`;
  await writeFile(join(dir, fileName), file.buffer);
  return fileName;
}

/** Path.GetExtension(name).ToLower() */
export function lowerExtension(name: string): string {
  return extname(name).toLowerCase();
}

/** DateTime.Now.ToString("ddMMyyyyhhmmsstt"), server clock. */
function legacyStamp(now = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const h12 = now.getHours() % 12 || 12;
  return `${p2(now.getDate())}${p2(now.getMonth() + 1)}${now.getFullYear()}${p2(h12)}${p2(now.getMinutes())}${p2(now.getSeconds())}${now.getHours() < 12 ? "AM" : "PM"}`;
}

/**
 * Save as "<prefix><safe original name>_<8 hex><ddMMyyyyhhmmsstt><ext>" under
 * webRoot/<folder...> (the announcement, document and past-president upload
 * naming). Returns the file name.
 */
export async function saveWithReadableName(config: AppConfig, file: UploadedFile, prefix: string, ...folder: string[]): Promise<string> {
  const dir = join(webRootPath(config), ...folder);
  await mkdir(dir, { recursive: true });
  const ext = extname(file.originalname);
  const base = file.originalname.slice(0, file.originalname.length - ext.length).replace(/^.*[\/]/, "").replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
  const fileName = `${prefix}${base}_${randomUUID().replace(/-/g, "").slice(0, 8)}${legacyStamp()}${ext}`;
  await writeFile(join(dir, fileName), file.buffer);
  return fileName;
}
