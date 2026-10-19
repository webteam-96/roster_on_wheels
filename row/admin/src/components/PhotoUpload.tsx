"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { uploadPhoto, getPhotoUrl } from "@/services/api";
import { Camera, User } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";
import { PHOTO_MAX_MB, HARD_CAP_MB } from "@/lib/uploadValidate";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useImageCropUpload } from "@/hooks/useImageCropUpload";

// Square crop — this photo is always rendered in a circular/square frame
// (24×24 here, small avatars in listings). 600×600 is retina-comfortable for
// those sizes without storing a needlessly large file per member.
const PHOTO_ASPECT = 1;
const PHOTO_MAX_OUTPUT = 600;

interface PhotoUploadProps {
  currentPath: string | null;
  type: "profile" | "family" | "familymember";
  onUploaded: (path: string) => void;
  className?: string;
}

export default function PhotoUpload({
  currentPath,
  type,
  onUploaded,
  className = "",
}: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hook state lives inside this component, so each PhotoUpload instance on the
  // page (profile + one per family member) owns its own crop dialog.
  const crop = useImageCropUpload();

  const photoUrl = preview || (currentPath ? getPhotoUrl(currentPath) : "");

  // startCrop validates and (if needed) compresses before opening the cropper:
  // a 200 MB phone photo is rejected with a clear message; a 12 MB DSLR photo
  // compresses to ~3-4 MB while staying sharp.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setError(null);
      crop.startCrop(file);
    }
    e.target.value = "";
  };

  const handleCropSave = async (blob: Blob) => {
    setUploading(true);
    try {
      const cropped = new File([blob], `photo-${Date.now()}.png`, { type: "image/png" });

      // Local preview from the CROPPED file so the user sees what's actually uploaded.
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(cropped);

      const upload = await uploadPhoto(cropped, type);
      onUploaded(upload.path);
      crop.cancel();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="relative h-24 w-24 overflow-hidden rounded-full bg-primary/5 border-2 border-dashed border-primary/30">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt="Photo"
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <User className="h-10 w-10" />
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <RotaryLoader size="sm" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.webp"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        <Camera className="mr-2 h-4 w-4" />
        {currentPath || preview ? "Change Photo" : "Upload Photo"}
      </Button>
      <p className="text-xs text-muted-foreground mt-1.5">
        JPG, PNG, WEBP · up to {PHOTO_MAX_MB} MB (larger photos auto-compressed, &gt; {HARD_CAP_MB} MB rejected)
      </p>
      {(error || crop.error) && (
        <p className="text-xs text-destructive mt-1 max-w-[12rem] text-center">{error || crop.error}</p>
      )}

      <ImageCropDialog
        open={crop.open}
        imageSrc={crop.imageSrc}
        aspect={PHOTO_ASPECT}
        maxOutputWidth={PHOTO_MAX_OUTPUT}
        title="Crop Photo"
        saving={uploading}
        onCancel={crop.cancel}
        onSave={handleCropSave}
      />
    </div>
  );
}
