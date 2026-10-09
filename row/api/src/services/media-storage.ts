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
