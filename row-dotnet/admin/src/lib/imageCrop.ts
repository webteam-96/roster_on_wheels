// Shared crop-to-blob helpers for react-easy-crop, lifted out of the 4 places
// that used to copy-paste this (club/rotary logos, banners, advertisements,
// international president). Any new crop-capable upload spot should use these
// instead of re-implementing them.

export interface CropOutputSize {
  width: number;
  height: number;
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.setAttribute("crossOrigin", "anonymous");
    img.src = url;
  });
}

// Crops the visible portion of the source image (react-easy-crop's pixel-area
// output) to an exact output size and returns a PNG Blob. PNG (not JPEG) is
// deliberate — it preserves transparency, which matters for logos/emblems
// with a transparent background; a JPEG re-encode would collapse that onto a
// black canvas background.
export async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  outputSize: CropOutputSize,
): Promise<Blob> {
  const img = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported.");

  canvas.width = outputSize.width;
  canvas.height = outputSize.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    img,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, outputSize.width, outputSize.height,
  );

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

// Given the crop rectangle's own pixel size, derives an output size clamped
// to maxOutputWidth (never upscales past the source crop — just blurs for no
// visual benefit). When `aspect` is a locked ratio, height is derived from
// it (the crop rect is already that shape, but this keeps rounding exact).
// When `aspect` is omitted (free-form crop — e.g. advertisement posters/
// flyers that come in many shapes and shouldn't be forced into one ratio),
// height is derived from the crop rectangle's OWN proportions instead.
export function deriveOutputSize(
  pixelCropWidth: number,
  pixelCropHeight: number,
  aspect: number | undefined,
  maxOutputWidth: number,
): CropOutputSize {
  const width = Math.min(maxOutputWidth, Math.round(pixelCropWidth));
  const ratio = aspect ?? (pixelCropWidth / pixelCropHeight);
  const height = Math.round(width / ratio);
  return { width, height };
}

// Pre-loads a data URL so its natural pixel size is known before the crop
// dialog opens, so an initial zoom can be chosen that shows the image at (or
// near) its true size instead of an arbitrary default. Falls back to zoom=1
// if the probe fails for any reason.
export function probeNaturalZoom(dataUrl: string, canvasWidthPx: number): Promise<number> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      const naturalZoom = probe.naturalWidth / canvasWidthPx;
      resolve(Math.max(0.5, Math.min(3, naturalZoom)));
    };
    probe.onerror = () => resolve(1);
    probe.src = dataUrl;
  });
}
