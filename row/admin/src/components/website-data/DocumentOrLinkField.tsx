"use client";

import { useState } from "react";
import { Upload, X, FileText, Link as LinkIcon } from "@/components/icons";

/**
 * Shared "Document OR Link" field for club/district banners & advertisements.
 *
 * Rules (per product): an item can point to a DOCUMENT, or a LINK, or NEITHER —
 * never both. Both are optional. Uploading a document clears any typed link and
 * vice-versa; the two inputs disable each other so the mutual-exclusivity is enforced
 * in the UI as well as the API.
 */
export interface DocumentOrLinkValue {
  documentPath?: string;   // stored path/filename returned by the upload endpoint
  documentName: string;    // display name of the picked file
  linkUrl: string;         // external URL
}

export default function DocumentOrLinkField({
  value,
  onChange,
  uploadDocument,
  accept = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png",
  onError,
}: {
  value: DocumentOrLinkValue;
  onChange: (v: DocumentOrLinkValue) => void;
  uploadDocument: (file: File) => Promise<string>;
  accept?: string;
  onError?: (msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const { documentPath, documentName, linkUrl } = value;
  const hasLink = !!linkUrl.trim();

  const MAX_MB = 10;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > MAX_MB * 1024 * 1024) {
      onError?.(`Document is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed is ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      const path = await uploadDocument(file);
      // Picking a document clears any link — they're mutually exclusive.
      onChange({ documentPath: path, documentName: file.name, linkUrl: "" });
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { message?: string } | string } };
      const msg = (typeof ex.response?.data === "object" && ex.response?.data?.message)
        || (typeof ex.response?.data === "string" ? ex.response.data : undefined)
        || "Failed to upload document.";
      onError?.(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {documentPath ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <FileText className="h-4 w-4 text-emerald-700 flex-shrink-0" />
          <span className="text-sm text-emerald-800 truncate flex-1">{documentName || "Document attached"}</span>
          <button
            type="button"
            onClick={() => onChange({ documentPath: undefined, documentName: "", linkUrl })}
            className="text-slate-500 hover:text-slate-700"
            aria-label="Remove document"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <label
            className={`flex items-center gap-2 w-full px-4 py-3 border-2 border-dashed rounded-lg transition-colors text-slate-500
              ${hasLink ? "border-slate-100 opacity-50 cursor-not-allowed" : "border-slate-200 hover:border-amber-300 hover:bg-amber-50/40 cursor-pointer"}`}
          >
            <Upload className="h-4 w-4" />
            <span className="text-sm">{uploading ? "Uploading…" : "Click to upload a document (max 10 MB)"}</span>
            <input type="file" accept={accept} className="hidden" disabled={hasLink || uploading} onChange={handleFile} />
          </label>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> OR <span className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
            <LinkIcon className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <input
              type="url"
              value={linkUrl}
              disabled={!!documentPath}
              onChange={(e) => onChange({ documentPath: undefined, documentName: "", linkUrl: e.target.value })}
              placeholder="https://example.com/…"
              className="flex-1 text-sm outline-none bg-transparent disabled:opacity-50"
            />
          </div>
        </>
      )}
      <p className="text-xs text-slate-400">Optional. Attach a document <b>or</b> paste a link. Not both.</p>
    </div>
  );
}
