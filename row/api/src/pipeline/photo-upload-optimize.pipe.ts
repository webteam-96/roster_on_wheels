import { Injectable, Logger, type PipeTransform } from "@nestjs/common";
import { optimizePhoto } from "../services/image-tools";
import type { UploadedFile } from "../services/media-storage";

const isUpload = (v: unknown): v is UploadedFile & { fieldname?: string } =>
  !!v && typeof v === "object" && Buffer.isBuffer((v as UploadedFile).buffer) && typeof (v as UploadedFile).originalname === "string";

/**
 * Port of PhotoUploadOptimizeFilter.cs (a global filter there): every uploaded photo handed
 * to an action (@UploadedFile / @UploadedFiles) is replaced by its 2560 px / JPEG-88 version
 * before the action runs. Non-photos (PDF, Office, GIF, SVG...) pass through untouched.
 */
@Injectable()
export class PhotoUploadOptimizePipe implements PipeTransform {
  private readonly log = new Logger("PhotoUploadOptimizeFilter");

  async transform(value: unknown) {
    if (isUpload(value)) return this.optimize(value);
    if (Array.isArray(value) && value.length && value.every(isUpload)) return Promise.all(value.map((f) => this.optimize(f)));
    return value;
  }

  private async optimize<T extends UploadedFile>(file: T): Promise<T> {
    const r = await optimizePhoto(file);
    if (r.changed)
      this.log.log(`Photo optimised: ${file.originalname} -> ${r.file.originalname} (${Math.floor(file.size / 1024)} KB -> ${Math.floor(r.file.size / 1024)} KB)`);
    return r.file;
  }
}
