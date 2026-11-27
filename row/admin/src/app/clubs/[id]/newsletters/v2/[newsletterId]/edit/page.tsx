"use client";

/**
 * Newsletters v2 — Edit Newsletter.
 *
 * Same data semantics as the v1 edit page: every field, every API call, every
 * validation rule is preserved verbatim (including the past-datetime bypass
 * for fields that haven't been changed from their original values). Visual
 * presentation uses the V2FormShell wrapper with dot-accented section cards.
 *
 * v2 reads ONLY `?returnTo=` — no `from`, no `returnUrl`, no `backUrl`.
 */

import { Input } from "@/components/ui/input";
import RadioPill from "@/components/form/RadioPill";
import FieldLabel from "@/components/form/FieldLabel";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams } from "next/navigation";
import {
  Upload, X, FileText, Bell, Link2, FileUp, Info, Calendar,
} from "@/components/icons";
import {
  getClub,
  getNewsletter,
  updateNewsletter,
  uploadNewsletterFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, PDF_ONLY_EXTENSIONS } from "@/lib/uploadValidate";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import RecipientBadge from "@/components/RecipientBadge";
import { toLocalDateParts } from "@/lib/dateUtils";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { TEXT_INPUT_REGEX } from "@/lib/textInput";
import { ListPageSkeleton } from "@/components/row/AppKit";

import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
const TOP_MESSAGE = "Edit publish window, attachment or notification options. Existing past dates remain valid unless you change them.";

export default function NewslettersV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const newsletterId = Number(params.newsletterId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/newsletters/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTime, setExpiryTime] = useState("");
  const [attachmentType, setAttachmentType] = useState<"link" | "file">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [isSendEmail, setIsSendEmail] = useState(false);

  // Track original dates to allow existing past dates without validation error.
  const [originalPublishDateTime, setOriginalPublishDateTime] = useState("");
  const [originalExpiryDateTime, setOriginalExpiryDateTime] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [club, nl] = await Promise.all([
          getClub(clubId),
          getNewsletter(clubId, newsletterId),
        ]);
        setClubName(club.clubName);

        setTitle(nl.title || "");
        setAttachmentType((nl.attachmentType as "link" | "file") || "link");
        setLinkUrl(nl.linkUrl || "");
        setFilePath(nl.filePath || null);
        if (nl.filePath) {
          const parts = nl.filePath.split("/");
          setFileName(parts[parts.length - 1]);
        }
        setIsSendEmail(nl.isSendEmail ?? false);

        if (nl.publishDateTime) {
          const { date: pd, time: pt } = toLocalDateParts(nl.publishDateTime);
          setPublishDate(pd);
          setPublishTime(pt);
          setOriginalPublishDateTime(`${pd}T${pt}:00`);
        }

        if (nl.expiryDateTime) {
          const { date: ed, time: et } = toLocalDateParts(nl.expiryDateTime);
          setExpiryDate(ed);
          setExpiryTime(et);
          setOriginalExpiryDateTime(`${ed}T${et}:00`);
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load newsletter.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, newsletterId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (TEXT_INPUT_REGEX.test(val)) {
      setTitle(val);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input first so re-picking the SAME file after an error still fires onChange.
    e.target.value = "";
    if (!file) return;

    // Pre-check before the request goes out: an oversized or wrong-type file
    // fails instantly with a specific message instead of after a long upload.
    try {
      validateDocumentFile(file, PDF_ONLY_EXTENSIONS);
    } catch (err: unknown) {
      setErrorMessage(describeUploadError(err));
      return;
    }

    setFileName(file.name);
    setFileUploading(true);
    try {
      const result = await uploadNewsletterFile(clubId, file);
      setFilePath(result.path);
    } catch (err: unknown) {
      setFileName(null);
      setFilePath(null);
      setErrorMessage(describeUploadError(err));
    } finally {
      setFileUploading(false);
    }
  };

  const removeFile = () => {
    setFilePath(null);
    setFileName(null);
  };

  const handleSave = async () => {
    if (!title.trim()) { setErrorMessage("Title is required."); return; }
    if (title.trim().length > 50) { setErrorMessage("Title must be 50 characters or less."); return; }
    if (!publishDate || !publishTime) { setErrorMessage("Publish Date & Time is required."); return; }
    const publishDTStr = `${publishDate}T${publishTime}:00`;
    if (attachmentType === "link" && !linkUrl.trim()) { setErrorMessage("Link URL is required when attachment type is Link."); return; }
    if (attachmentType === "file" && !filePath) { setErrorMessage("Please upload a PDF file."); return; }
    if (fileUploading) { setErrorMessage("Please wait for file to finish uploading."); return; }

    setSaving(true);
    try {
      await updateNewsletter(clubId, newsletterId, {
        title: title.trim(),
        publishDateTime: publishDTStr,
        // Expiry kept for backend compatibility — UI no longer captures it
        expiryDateTime: "2099-12-31T23:59:00", // no expiry — UI doesn't capture one; matches mobile's never-expires sentinel
        attachmentType,
        linkUrl: attachmentType === "link" ? linkUrl.trim() : null,
        filePath: attachmentType === "file" ? filePath : null,
        isSendEmail,
      });
      setSuccessMessage("Newsletter updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update newsletter.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Newsletter"
        activeNavHref="/club-admin-dashboard/communication"
      >
      <V2FormShell
        title="Edit Newsletter"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/newsletters/v2`}
        saving={saving}
        saveLabel="Update Newsletter"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        <div>
        <div className="min-w-0">
        {/* 1. Newsletter Details */}
        <SectionCard number={1} icon={FileText} title="Newsletter Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel required hint="(max 50 chars)">Title</FieldLabel>
              <Input
                type="text"
                value={title}
                onChange={handleTitleChange}
                placeholder="Newsletter title"
                maxLength={50}
                
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
          </div>
        </SectionCard>

        {/* 2. Publish Window */}
        <SectionCard number={2} icon={Calendar} title="Publish Window">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Publish Date</FieldLabel>
              <DateField value={publishDate} onChange={setPublishDate} className="row-field w-full" />
            </div>
            <div>
              <FieldLabel required>Publish Time</FieldLabel>
              <Input
                type="time"
                value={publishTime}
                onChange={(e) => setPublishTime(e.target.value)}
                
              />
            </div>
          </div>
        </SectionCard>

        {/* 3. Attachment */}
        <SectionCard number={3} icon={Link2} title="Attachment">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <RadioPill
                checked={attachmentType === "link"}
                onChange={() => { setAttachmentType("link"); setFilePath(null); setFileName(null); }}
                label="Save Link"
                icon={Link2}
              />
              <RadioPill
                checked={attachmentType === "file"}
                onChange={() => { setAttachmentType("file"); setLinkUrl(""); }}
                label="Attach File (PDF)"
                icon={FileUp}
              />
            </div>

            {attachmentType === "link" && (
              <div>
                <FieldLabel required>Link URL</FieldLabel>
                <Input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com"
                  
                />
              </div>
            )}

            {attachmentType === "file" && (
              <div>
                <FieldLabel required>PDF File</FieldLabel>
                {fileName ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <FileUp className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm text-emerald-700 truncate flex-1">{fileName}</span>
                    {fileUploading && <RotaryLoader size="sm" />}
                    <IconButton type="button" onClick={removeFile} aria-label="Remove file">
                      <X className="h-4 w-4" />
                    </IconButton>
                  </div>
                ) : (
                  <div>
                    <Button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-auto py-3 border-dashed" variant="outline">
                      <Upload className="h-4 w-4" />
                      <span className="text-sm">Upload PDF file</span>
                    </Button>
                    <p className="text-xs text-slate-400 mt-1">{documentUploadHint(PDF_ONLY_EXTENSIONS)}</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf" onChange={handleFileSelect} />
              </div>
            )}
          </div>
        </SectionCard>

        {/* 4. Notification */}
        <SectionCard number={4} icon={Bell} title="Notification Settings">
          <label className="flex items-center gap-3 cursor-pointer mt-3">
            <input
              type="checkbox"
              checked={isSendEmail}
              onChange={(e) => setIsSendEmail(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm font-medium text-slate-700">Notify members via Email</span>
            {isSendEmail && <RecipientBadge scope="club" clubId={clubId} />}
          </label>
        </SectionCard>
        </div>

        </div>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Newsletter updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
