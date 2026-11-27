"use client";

/** Photos card (and the email-notification tick box) of this page, moved here unchanged. */

import FieldLabel from "@/components/form/FieldLabel";
import SectionCard from "@/components/form/SectionCard";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import RotaryLoader from "@/components/RotaryLoader";
import { Upload, X, Star, Camera } from "@/components/icons";

type Photo = { id: string; description: string; isPrimary: boolean; uploading: boolean; previewUrl?: string };

type Props = {
  photos: Photo[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPhotoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setPrimaryPhoto: (id: string) => void;
  removePhoto: (id: string) => void;
  updatePhotoDescription: (id: string, desc: string) => void;
  sendEmail: boolean;
  setSendEmail: (v: boolean) => void;
};

export default function PublicImagePhotosSection({
  photos, fileInputRef, onPhotoSelect, setPrimaryPhoto, removePhoto, updatePhotoDescription, sendEmail, setSendEmail,
}: Props) {
  return (
    <>
        {/* 5. Photos */}
        <SectionCard number={5} icon={Camera} title="Photos">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FieldLabel required>Upload Photos (1 mandatory, max 5)</FieldLabel>
              <span className="text-xs text-slate-500">{photos.length}/5</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group rounded-lg overflow-hidden border border-slate-200">
                  <div className="aspect-square">
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
                        className={photo.isPrimary ? "bg-amber-400 text-amber-900" : "bg-black/50 text-white"} aria-label="Set as primary photo" aria-pressed={photo.isPrimary}>
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
                  <Textarea
                    value={photo.description}
                    onChange={(e) => { if (e.target.value.length <= 500) updatePhotoDescription(photo.id, e.target.value); }}
                    placeholder="Photo description (max 500 chars)"
                    rows={2}
                    maxLength={500}
                    className="resize-none"
                  />
                </div>
              ))}
              {photos.length < 5 && (
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-auto border-dashed aspect-square flex-col gap-1" variant="outline">
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Add Photo</span>
                </Button>
              )}
            </div>
            <input ref={fileInputRef} type="file" className="hidden" accept=".jpg,.jpeg,.png,.gif,.webp" multiple onChange={onPhotoSelect} />
            <p className="text-xs text-slate-400">JPG, JPEG, PNG, GIF, WEBP &middot; up to 5 MB &middot; auto-compressed if larger</p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="accent-blue-600 h-4 w-4"
              />
              <span className="text-sm font-medium text-slate-700">Send Email notification</span>
            </label>
          </div>
        </SectionCard>
    </>
  );
}
