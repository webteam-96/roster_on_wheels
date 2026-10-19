"use client";

/**
 * Shared crop dialog — generalizes the react-easy-crop pattern that used to be
 * copy-pasted across club/rotary logos, banners, advertisements, and the
 * international president photo (4 separate copies of createImage/getCroppedImg
 * + near-identical dialog JSX). New upload spots should use this instead of
 * writing another copy.
 *
 * Usage: open with a data-URL `imageSrc` (e.g. from FileReader.readAsDataURL),
 * lock `aspect` to whatever shape the destination needs, and get back a PNG
 * Blob via onSave — the caller is responsible for wrapping it in a File and
 * uploading it (upload endpoints differ too much across ~65 call sites to
 * bake that in here).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area, MediaSize } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RotaryLoader from "@/components/RotaryLoader";
import { Image as ImageIcon, RectangleHorizontal, RectangleVertical, Save, Square, X, ZoomIn, ZoomOut } from "@/components/icons";
import { getCroppedImageBlob, deriveOutputSize, probeNaturalZoom } from "@/lib/imageCrop";

/** Shapes offered by the in-dialog selector when `allowOrientation` is on. */
export type CropOrientation = "landscape" | "portrait" | "square" | "original";

const ORIENTATION_OPTIONS: { key: CropOrientation; label: string; Icon: typeof Square }[] = [
  { key: "landscape", label: "Landscape", Icon: RectangleHorizontal },
  { key: "portrait", label: "Portrait", Icon: RectangleVertical },
  { key: "square", label: "Square", Icon: Square },
  { key: "original", label: "Original", Icon: ImageIcon },
];

export interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  /**
   * Aspect ratio (width / height), e.g. 1 for square, 300/80 for a wide banner.
   *
   * By default this is a HARD LOCK — the destination needs exactly this shape
   * (logos, website banners, circular member avatars). With `allowOrientation`
   * it becomes only the DEFAULT ("Landscape") shape and the user can switch to
   * portrait/square/original.
   *
   * NOTE: react-easy-crop falls back to its own 4/3 default when this is
   * undefined — it has no free-form mode — so omitting it is a 4:3 lock, not a
   * free crop. Use `allowOrientation` and the "Original" option for content
   * (ad/sponsor posters etc.) that must keep its own shape.
   */
  aspect?: number;
  /**
   * Shows a Landscape / Portrait / Square / Original selector inside the dialog.
   * Off by default so every existing caller keeps its locked ratio; turn it on
   * for content photos (project photos, event + announcement images, ad posters)
   * where a portrait poster is legitimate.
   */
  allowOrientation?: boolean;
  /** Ratio used by the Portrait option. 3:4 suits posters/flyers and A4 scans. */
  portraitAspect?: number;
  /** Output width in px, clamped to the crop rectangle's own size (never upscales). */
  maxOutputWidth?: number;
  /**
   * Minimum output width in px for THIS usage. When the current crop would yield a
   * blob narrower than this, the Save button is disabled and an inline note explains
   * why — so a too-small crop can't be produced (banners need >=1200; advertisements
   * have no minimum). Omit for no minimum.
   */
  minOutputWidth?: number;
  title?: string;
  saving?: boolean;
  minZoom?: number;
  maxZoom?: number;
  onCancel: () => void;
  onSave: (blob: Blob) => void | Promise<void>;
}

export default function ImageCropDialog({
  open,
  imageSrc,
  aspect,
  allowOrientation = false,
  portraitAspect = 3 / 4,
  maxOutputWidth = 1200,
  minOutputWidth,
  title = "Crop Photo",
  saving = false,
  // Zoom must not go below 1: react-easy-crop sizes the crop box from the
  // image's fitted (zoom-1) size, so at zoom < 1 the image shrinks away from a
  // crop box that stays put — which is what produced the "crop frame wider than
  // the image" letterbox on portrait sources.
  minZoom = 1,
  maxZoom = 3,
  onCancel,
  onSave,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [orientation, setOrientation] = useState<CropOrientation>("landscape");
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset crop state and pick a natural-size initial zoom each time a new
  // image is opened for cropping.
  useEffect(() => {
    if (!open || !imageSrc) return;
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
    setOrientation("landscape");
    setNaturalAspect(null);
    const canvasW = containerRef.current?.offsetWidth || 720;
    probeNaturalZoom(imageSrc, canvasW).then((z) => setZoom(Math.max(minZoom, z)));
  }, [open, imageSrc, minZoom]);

  // The shape actually handed to the cropper. Without the selector this is the
  // caller's ratio verbatim, so locked callers behave exactly as before.
  const landscapeAspect = aspect ?? 4 / 3;
  const effectiveAspect = !allowOrientation
    ? aspect
    : orientation === "portrait"
      ? portraitAspect
      : orientation === "square"
        ? 1
        : orientation === "original"
          ? (naturalAspect ?? landscapeAspect)
          : landscapeAspect;

  // A portrait source defaults to the portrait shape, so the common case (an
  // A4/story-format poster) needs no toggling at all.
  const handleMediaLoaded = useCallback(
    (mediaSize: MediaSize) => {
      const ratio = mediaSize.naturalWidth / mediaSize.naturalHeight;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      setNaturalAspect(ratio);
      if (allowOrientation && ratio < 0.95) setOrientation("portrait");
    },
    [allowOrientation],
  );

  // Re-fit on shape change: recentre the crop box and drop back to the fitted
  // zoom, so the new box always sits inside the image with no empty margin.
  const selectOrientation = (next: CropOrientation) => {
    setOrientation(next);
    setCrop({ x: 0, y: 0 });
    setZoom(minZoom);
  };

  // Projected output width for the current crop (same clamp getCroppedImageBlob uses).
  // Drives the min-width guard so the user can't confirm a too-small crop.
  const projectedWidth = croppedAreaPixels
    ? deriveOutputSize(croppedAreaPixels.width, croppedAreaPixels.height, effectiveAspect, maxOutputWidth).width
    : 0;
  const belowMin = !!minOutputWidth && projectedWidth > 0 && projectedWidth < minOutputWidth;

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels || belowMin) return;
    const outputSize = deriveOutputSize(croppedAreaPixels.width, croppedAreaPixels.height, effectiveAspect, maxOutputWidth);
    const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, outputSize);
    await onSave(blob);
  };

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {allowOrientation && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">Shape</span>
              {ORIENTATION_OPTIONS.map(({ key, label, Icon }) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={orientation === key ? "default" : "outline"}
                  onClick={() => selectOrientation(key)}
                  disabled={saving}
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5" />
                  {label}
                </Button>
              ))}
            </div>
          )}
          <div ref={containerRef} className="relative w-full h-[480px] bg-black rounded">
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={effectiveAspect}
                cropShape="rect"
                showGrid={false}
                minZoom={minZoom}
                maxZoom={maxZoom}
                objectFit="contain"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                onMediaLoaded={handleMediaLoaded}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <ZoomOut className="h-4 w-4 text-muted-foreground" />
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground w-12">{(zoom * 100).toFixed(0)}%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Drag the image to reposition · scroll-wheel or slider to zoom.
            {allowOrientation && " Pick Portrait for a tall poster, or Original to keep the photo's own shape uncropped."}
          </p>
          {belowMin && (
            <p className="text-xs font-medium text-amber-600">
              Crop is only {projectedWidth}px wide. This needs at least {minOutputWidth}px for a clean, non-blurry display.
              Zoom out, reposition, or upload a larger source image.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4 mr-2" />Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !croppedAreaPixels || belowMin}>
            {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
