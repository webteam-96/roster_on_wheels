"use client";

// Pairs with <ImageCropDialog> to cut the per-page boilerplate down to:
// file input -> startCrop(file) -> <ImageCropDialog {...cropDialogProps} onSave={...}>
// Handles the existing validate/compress step (lib/uploadValidate.ts) and
// reading the file to a data URL before handing off to the crop dialog.

import { useState } from "react";
import { tryValidateAndProcessUpload } from "@/lib/uploadValidate";

export function useImageCropUpload() {
  const [open, setOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCrop = async (file: File) => {
    setError(null);
    const result = await tryValidateAndProcessUpload(file, /* treatAsImage */ true);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setOpen(true);
    };
    reader.readAsDataURL(result.file);
  };

  const cancel = () => {
    setOpen(false);
    setImageSrc(null);
  };

  return { open, imageSrc, error, startCrop, cancel };
}
