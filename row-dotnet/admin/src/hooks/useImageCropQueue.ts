"use client";

// Multi-file sibling of useImageCropUpload, for the project-photo uploaders.
// Those let an admin pick several files in one go (multiple, up to 5), so a
// single startCrop/cancel pair isn't enough: every selected file has to be
// confirmed in the crop dialog, one after another, before it uploads.
//
// The page keeps ONE <ImageCropDialog> bound to `current` and calls `commit`
// with its own upload. Saving (or skipping) drops the head of the queue, which
// swaps the dialog onto the next pending file — or closes it when none are left.

import { useState } from "react";
import { tryValidateAndProcessUpload } from "@/lib/uploadValidate";

export interface CropQueueItem {
  /** Original file name — pages quote it in per-file error messages. */
  name: string;
  dataUrl: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function useImageCropQueue() {
  const [queue, setQueue] = useState<CropQueueItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Validates/compresses each file and reads it to the data URL the crop dialog
  // needs. Returns messages for files that couldn't be prepared so the caller
  // surfaces them through its own error UI.
  const enqueue = async (files: File[]): Promise<string[]> => {
    const prepared: CropQueueItem[] = [];
    const errors: string[] = [];
    for (const file of files) {
      const result = await tryValidateAndProcessUpload(file, /* treatAsImage */ true);
      if (!result.ok) {
        errors.push(`${file.name}: ${result.error}`);
        continue;
      }
      try {
        prepared.push({ name: file.name, dataUrl: await readAsDataUrl(result.file) });
      } catch {
        errors.push(`Could not read ${file.name}.`);
      }
    }
    if (prepared.length > 0) setQueue((prev) => [...prev, ...prepared]);
    return errors;
  };

  const skip = () => setQueue((prev) => prev.slice(1));

  // Advances even when the upload threw — a failed photo shouldn't trap the user
  // on the same crop step with the rest of their selection stuck behind it.
  const commit = async (upload: () => Promise<void>) => {
    setSaving(true);
    try {
      await upload();
    } finally {
      setSaving(false);
      skip();
    }
  };

  return {
    open: queue.length > 0,
    current: queue[0] ?? null,
    pending: queue.length,
    saving,
    enqueue,
    skip,
    commit,
  };
}
