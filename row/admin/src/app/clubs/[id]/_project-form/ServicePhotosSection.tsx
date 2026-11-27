"use client";

import FieldLabel from "@/components/form/FieldLabel";
import SectionCard from "@/components/form/SectionCard";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RotaryLoader from "@/components/RotaryLoader";
import { Upload, X, Star, Camera } from "@/components/icons";
import type { ServiceFormConfig } from "./config";
import type { ServiceProjectFields, PhotoItem } from "./useServiceProjectFields";

type Props = {
  cfg: ServiceFormConfig;
  mode: "add" | "edit";
  form: ServiceProjectFields;
};

export default function ServicePhotosSection({ cfg, mode, form }: Props) {
  const { photos, photoInputRef, handlePhotoSelect, setPrimaryPhoto, removePhoto, updatePhotoDescription } = form;
  const look = cfg.look;
  const wide = look.photoLayout === "wide";

  const tile = (photo: PhotoItem) => (
    <div key={photo.id} className={look.photoTile}>
      <div className={look.photoInner}>
        {photo.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.previewUrl} alt="" className="w-full h-full object-contain" />
        )}
        {photo.uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <RotaryLoader size="sm" />
          </div>
        )}
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton type="button" onClick={() => setPrimaryPhoto(photo.id)}
            className={photo.isPrimary ? "bg-amber-400 text-amber-900" : "bg-black/50 text-white"} aria-label={look.primaryAriaLabel} aria-pressed={photo.isPrimary}>
            <Star className="h-3 w-3" />
          </IconButton>
          <IconButton aria-label="Remove photo" type="button" onClick={() => removePhoto(photo.id)} >
            <X className="h-3 w-3" />
          </IconButton>
        </div>
        {photo.isPrimary && (
          <div className="absolute bottom-0 left-0 right-0 bg-amber-400/90 text-amber-900 text-[10px] font-bold text-center py-0.5">PRIMARY</div>
        )}
      </div>
      <div className={wide ? "p-2 space-y-1" : "p-2"}>
        <Textarea
          value={photo.description}
          onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(photo.id, e.target.value); }}
          placeholder={look.photoDescPlaceholder}
          rows={2}
          maxLength={500}
          className="row-field-sm resize-none"
        />
        <p className="text-[10px] text-slate-400 text-right">{photo.description.length}/500</p>
      </div>
    </div>
  );

  return (
    <SectionCard number={4} icon={Camera} title="Photos">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FieldLabel required>Upload Photos (1 mandatory, max 5)</FieldLabel>
          <span className="text-xs text-slate-500">{photos.length}/5</span>
        </div>
        {wide ? (
          <>
            {photos.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {photos.map(tile)}
              </div>
            )}
            {photos.length < 5 && (
              <Button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="h-auto w-full border-dashed py-6 flex-col gap-1" variant="outline">
                <Upload className="h-5 w-5" />
                <span className="text-xs font-medium">Add Photo</span>
              </Button>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map(tile)}
            {photos.length < 5 && (
              <Button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="h-auto border-dashed aspect-square flex-col gap-1" variant="outline">
                <Upload className="h-5 w-5" />
                <span className="text-xs">Add Photo</span>
              </Button>
            )}
          </div>
        )}
        <input ref={photoInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={handlePhotoSelect} />
        <p className="text-xs text-slate-400">
          {mode === "add" ? "JPG, JPEG, PNG, GIF, WEBP · up to 5 MB · auto-compressed if larger" : "JPG, JPEG, PNG, GIF, WEBP · max 10 MB"}
        </p>
      </div>
    </SectionCard>
  );
}
