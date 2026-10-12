"use client";

/**
 * District Newsletters v2 — Add Newsletter.
 *
 * District-scoped mirror of src/app/clubs/[id]/newsletters/v2/add/page.tsx.
 * Same fields, same validation, same data-shape — only the scope changes
 * (district instead of club) and the shell/API calls are swapped accordingly.
 *
 * v2 reads ONLY `?returnTo=` for cancel + post-save navigation. `?yearId=` is
 * also consumed from the URL (newsletters are year-scoped) and forwarded in
 * the create payload.
 *
 * districtId comes from URL params (source of truth) and is pushed into
 * AuthContext.selectedDistrictId on mount so the shell scope-picker stays
 * in sync — mirrors useSyncClubIdFromUrl's pattern.
 */

import { useEffect, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams } from "next/navigation";
import {
  Upload, X, FileText, Bell, Link2, FileUp, Info, Calendar,
} from "lucide-react";
import {
  getDistrict,
  createDistrictNewsletter,
  uploadDistrictNewsletterFile,
} from "@/services/api";
import { documentUploadHint, validateDocumentFile, describeUploadError, PDF_ONLY_EXTENSIONS } from "@/lib/uploadValidate";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import DistrictCommunicationTabBar from "@/components/dashboard/DistrictCommunicationTabBar";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import WhatsAppRecipientBadge from "@/components/WhatsAppRecipientBadge";
import { useAuth } from "@/contexts/AuthContext";

const ENGLISH_ONLY_REGEX = /^[a-zA-Z0-9\s.,!?;:'"()\-&@#%+=/]*$/;

const TOP_MESSAGE = "District newsletters are visible to all clubs in the district during the configured publish window. After the expiry date the newsletter is archived but stays viewable in the listing.";

function FieldLabel({ children, hint, dot, required = true }: {
  children: React.ReactNode; hint?: string; dot: string; required?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function RadioPill({ checked, onChange, label, icon: Icon }: {
  checked: boolean; onChange: () => void; label: string; icon: React.ElementType;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium
        ${checked
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-slate-800"
        }`}
    >
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${checked ? "border-blue-500" : "border-slate-400"}`}>
        {checked && <div className="h-2 w-2 rounded-full bg-blue-500" />}
      </div>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </label>
  );
}

// Inline mirror of useSyncClubIdFromUrl for district scope. Kept here (not a
// shared hook) to match the pattern established by district upcoming-events v2.
function useSyncDistrictIdFromUrl(): void {
  const params = useParams();
  const rawId = params?.id;
  const urlDistrictId = typeof rawId === "string" ? Number(rawId) : NaN;
  const { selectedDistrictId, selectScope } = useAuth();

  useEffect(() => {
    if (
      Number.isFinite(urlDistrictId) &&
      urlDistrictId > 0 &&
      urlDistrictId !== selectedDistrictId
    ) {
      selectScope({ districtId: urlDistrictId });
    }
  }, [urlDistrictId, selectedDistrictId, selectScope]);
}

export default function DistrictNewslettersV2AddPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const urlYearId = searchParams.get("yearId");
  const yearId = urlYearId ? Number(urlYearId) : null;
  const { navigateAfterSave } = useV2ReturnTo(`/districts/${districtId}/newsletters`);

  const [districtName, setDistrictName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [publishTime, setPublishTime] = useState("");
  const [attachmentType, setAttachmentType] = useState<"link" | "file">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [isSendWhatsapp, setIsSendWhatsapp] = useState(false);
  const [isSendEmail, setIsSendEmail] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const district = await getDistrict(districtId);
        setDistrictName(`District ${district.districtNumber}`);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } | string } };
        if (e?.response?.status === 403) {
          setErrorMessage("You don't have permission to add newsletters for this district.");
        } else {
          const msg = typeof e?.response?.data === "string"
            ? e.response.data
            : e?.response?.data?.message;
          setErrorMessage(msg || "Failed to initialize.");
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [districtId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (ENGLISH_ONLY_REGEX.test(val)) {
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
      const result = await uploadDistrictNewsletterFile(districtId, file);
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
    if (attachmentType === "link" && !linkUrl.trim()) { setErrorMessage("Link URL is required when attachment type is Link."); return; }
    if (attachmentType === "file" && !filePath) { setErrorMessage("Please upload a PDF file."); return; }
    if (fileUploading) { setErrorMessage("Please wait for file to finish uploading."); return; }

    setSaving(true);
    try {
      await createDistrictNewsletter(districtId, {
        title: title.trim(),
        publishDateTime: `${publishDate}T${publishTime}:00`,
        // Expiry kept for backend compatibility — UI no longer captures it
        expiryDateTime: "2099-12-31T23:59:00", // no expiry — UI doesn't capture one; matches mobile's never-expires sentinel
        attachmentType,
        linkUrl: attachmentType === "link" ? linkUrl.trim() : null,
        filePath: attachmentType === "file" ? filePath : null,
        isSendWhatsapp,
        isSendEmail,
        yearId,
      });
      setSuccessMessage("Newsletter created successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } | string } };
      if (e?.response?.status === 403) {
        setErrorMessage("You don't have permission to add newsletters for this district.");
      } else {
        const msg = typeof e?.response?.data === "string"
          ? e.response.data
          : e?.response?.data?.message;
        setErrorMessage(msg || "Failed to save newsletter.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Add District GML"
          activeNavHref="/district-admin-dashboard/communication"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Add District GML"
        activeNavHref="/district-admin-dashboard/communication"
      >
        <div className="mb-4">
          <DistrictCommunicationTabBar />
        </div>
        <V2FormShell
          title="Add District GML"
          subtitle={districtName}
          defaultBack={`/districts/${districtId}/newsletters`}
          saving={saving}
          saveLabel="Save Newsletter"
          onSave={handleSave}
          banner={
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{TOP_MESSAGE}</span>
            </div>
          }
        >
          {/* 1. Newsletter Details */}
          <SectionCard number={1} icon={FileText} title="GML Details" dot="bg-blue-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FieldLabel hint="(max 50 chars, English only)" dot="bg-blue-500">Title</FieldLabel>
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Newsletter title"
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
              </div>
            </div>
          </SectionCard>

          {/* 2. Publish Window */}
          <SectionCard number={2} icon={Calendar} title="Publish Window" dot="bg-violet-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel dot="bg-violet-500">Publish Date</FieldLabel>
                <DateField value={publishDate} onChange={setPublishDate} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <FieldLabel dot="bg-violet-500">Publish Time</FieldLabel>
                <input
                  type="time"
                  value={publishTime}
                  onChange={(e) => setPublishTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </SectionCard>

          {/* 3. Attachment */}
          <SectionCard number={3} icon={Link2} title="Attachment" dot="bg-amber-600">
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
                  <FieldLabel dot="bg-amber-500">Link URL</FieldLabel>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}

              {attachmentType === "file" && (
                <div>
                  <FieldLabel dot="bg-amber-500">PDF File</FieldLabel>
                  {fileName ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <FileUp className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm text-emerald-700 truncate flex-1">{fileName}</span>
                      {fileUploading && <RotaryLoader size="sm" />}
                      <button type="button" onClick={removeFile}>
                        <X className="h-4 w-4 text-slate-500 hover:text-slate-700" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-lg hover:border-amber-300 transition-colors text-slate-500"
                      >
                        <Upload className="h-4 w-4" />
                        <span className="text-sm">Upload PDF file</span>
                      </button>
                      <p className="text-xs text-slate-400 mt-1">{documentUploadHint(PDF_ONLY_EXTENSIONS)}</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf" onChange={handleFileSelect} />
                </div>
              )}
            </div>
          </SectionCard>

          {/* 4. Notification */}
          <SectionCard number={4} icon={Bell} title="Notification Settings" dot="bg-emerald-600">
            {/* WhatsApp notify checkbox hidden 2026-09-07 per request — re-enable later. Value still submits (default off). */}
            {false && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isSendWhatsapp}
                onChange={(e) => setIsSendWhatsapp(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium text-slate-700">Notify members via WhatsApp</span>
              {isSendWhatsapp && <WhatsAppRecipientBadge scope="district" districtId={districtId} />}
            </label>
            )}
            <label className="flex items-center gap-3 cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={isSendEmail}
                onChange={(e) => setIsSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium text-slate-700">Notify members via Email</span>
              {isSendEmail && <WhatsAppRecipientBadge scope="district" districtId={districtId} channel="email" />}
            </label>
          </SectionCard>

          <SuccessAlert
            open={showSuccessDialog}
            title="Saved"
            description={successMessage || "Newsletter created successfully."}
            onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
          />
          <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        </V2FormShell>
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
