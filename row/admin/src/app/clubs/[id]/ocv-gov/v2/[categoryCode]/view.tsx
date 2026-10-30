"use client";

/**
 * OCV / GOV v2 category view — frontend overhaul replacement.
 *
 * Handles all six in-scope categories (static_documents, financial_documents,
 * trust_documents, grants, additional_documents, dues). Same APIs as v1:
 *   getOcvCategories, getOcvDocumentTypes, getOcvDocuments,
 *   uploadOcvDocument, updateOcvDocument, deleteOcvDocument,
 *   downloadOcvDocumentBlob.
 *
 * Behaviors preserved from v1:
 *   - Upload form: type, file (always); customTypeName when type is "Others";
 *     amount + paidOn ONLY for dues.
 *   - allowMultiple=false guard: prevent a second upload for the same type.
 *   - Documents table with View / Download / Edit / Delete.
 *   - Client-side search filter (typeName, customTypeName, originalFileName, amount).
 *   - Edit/Delete via modal dialogs.
 *
 * `?returnTo=` honored: back arrow goes there; defaults to `/clubs/[id]/ocv-gov/v2`.
 *
 * Named export (OcvCategoryV2View) accepts optional clubId/categoryCode/embedded/yearId
 * so a specific category (e.g. "dues") can be rendered inline as its own tab — e.g. the
 * Club Admin E-Governance page embeds it as a standalone "Dues" tab, in addition to its
 * normal spot inside the OCV/GOV hub's category grid. The route's default export (in the
 * sibling page.tsx) is a prop-less wrapper so it still satisfies Next's PageProps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Upload, Search, FileText, Banknote, ShieldCheck, Gift,
  FilePlus2, IndianRupee, Eye, Download, Edit3, Trash2, Loader2, AlertTriangle, FolderUp,
} from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import {
  getOcvCategories,
  getOcvDocumentTypes,
  getOcvDocuments,
  uploadOcvDocument,
  updateOcvDocument,
  deleteOcvDocument,
  downloadOcvDocumentBlob,
} from "@/services/api";
import type { OcvCategory, OcvDocumentType, OcvDocumentListItem } from "@/types/ocvGov";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import LoadingButton from "@/components/v2/LoadingButton";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { appLocale } from "@/lib/appFormat";
import { formatMoney } from "@/lib/currency";
import { SkeletonRows } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const CATEGORY_VISUAL: Record<
  string,
  { icon: LucideIcon; accent: string; bg: string; tint: string }
> = {
  static_documents:     { icon: FileText,    accent: "text-blue-600",    bg: "bg-blue-50",    tint: "bg-blue-50/60" },
  financial_documents:  { icon: Banknote,    accent: "text-emerald-600", bg: "bg-emerald-50", tint: "bg-emerald-50/60" },
  trust_documents:      { icon: ShieldCheck, accent: "text-violet-600",  bg: "bg-violet-50",  tint: "bg-violet-50/60" },
  grants:               { icon: Gift,        accent: "text-amber-600",   bg: "bg-amber-50",   tint: "bg-amber-50/60" },
  additional_documents: { icon: FilePlus2,   accent: "text-teal-600",    bg: "bg-teal-50",    tint: "bg-teal-50/60" },
  dues:                 { icon: IndianRupee, accent: "text-rose-600",    bg: "bg-rose-50",    tint: "bg-rose-50/60" },
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return s; }
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "–";
  try {
    return new Date(s).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  } catch { return s; }
}

export function OcvCategoryV2View({
  clubId: propClubId,
  categoryCode: propCategoryCode,
  embedded = false,
  yearId: propYearId = null,
  returnTo: propReturnTo,
}: {
  clubId?: number;
  categoryCode?: string;
  embedded?: boolean;
  yearId?: number | null;
  returnTo?: string;
} = {}) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);
  const categoryCode = propCategoryCode ?? (params.categoryCode as string);
  const yearId = propYearId ?? Number(searchParams.get("yearId") || 0);
  const inboundReturnTo = propReturnTo ?? searchParams.get("returnTo");

  const isDues = categoryCode === "dues";

  const backHref = inboundReturnTo || `/clubs/${clubId}/ocv-gov/v2`;
  const visual = CATEGORY_VISUAL[categoryCode] ?? CATEGORY_VISUAL.additional_documents;
  const Icon = visual.icon;

  const [category, setCategory] = useState<OcvCategory | null>(null);
  const [docTypes, setDocTypes] = useState<OcvDocumentType[]>([]);
  const [documents, setDocuments] = useState<OcvDocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload form
  const [typeId, setTypeId] = useState("");
  const [customName, setCustomName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search
  const [search, setSearch] = useState("");

  // Edit
  const [editDoc, setEditDoc] = useState<OcvDocumentListItem | null>(null);
  const [editTypeId, setEditTypeId] = useState("");
  const [editCustomName, setEditCustomName] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editPaidOn, setEditPaidOn] = useState("");
  const [saving, setSaving] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<OcvDocumentListItem | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const refreshDocs = useCallback(async (catId: number) => {
    try {
      const docs = await getOcvDocuments(clubId, catId, yearId);
      setDocuments(docs);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (err as any)?.response?.data;
      setErrorMessage(e?.message || e?.detail || "Failed to load documents.");
    }
  }, [clubId, yearId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const cats = await getOcvCategories(clubId);
        if (cancelled) return;
        const cat = cats.find((c) => c.categoryCode === categoryCode);
        if (!cat) {
          setErrorMessage("Category not found.");
          setLoading(false);
          return;
        }
        setCategory(cat);
        const types = await getOcvDocumentTypes(clubId, cat.id);
        if (cancelled) return;
        setDocTypes(types);
        await refreshDocs(cat.id);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = (err as any)?.response?.data;
        if (!cancelled) {
          setErrorMessage(e?.message || e?.detail || "Failed to load.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [clubId, categoryCode, refreshDocs]);

  const selectedDocType = useMemo(
    () => docTypes.find((t) => t.id === Number(typeId)),
    [docTypes, typeId],
  );
  const isOthers = (tid: string) => {
    const t = docTypes.find((d) => d.id === Number(tid));
    return t?.typeName.toLowerCase() === "others";
  };
  const hasUpload = (tid: number) => documents.some((d) => d.typeId === tid);

  const duplicateBlock =
    !!selectedDocType && !selectedDocType.allowMultiple && hasUpload(selectedDocType.id);

  async function handleUpload() {
    if (!category || !typeId || !file) {
      setErrorMessage("Please choose a document type and a file.");
      return;
    }
    if (duplicateBlock) {
      setErrorMessage("This document type already has an upload. Edit or delete the existing record first.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("typeId", typeId);
      fd.append("categoryId", String(category.id));
      fd.append("yearId", String(yearId));
      if (isOthers(typeId) && customName.trim()) fd.append("customTypeName", customName.trim());
      if (isDues && amount) fd.append("amount", amount);
      if (isDues && paidOn) fd.append("paidOn", paidOn);

      await uploadOcvDocument(clubId, fd);
      await refreshDocs(category.id);

      setTypeId("");
      setCustomName("");
      setFile(null);
      setAmount("");
      setPaidOn("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSuccessMessage("Document uploaded successfully.");
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (err as any)?.response?.data;
      setErrorMessage(e?.message || e?.detail || "Failed to upload.");
    } finally {
      setUploading(false);
    }
  }

  function openEdit(doc: OcvDocumentListItem) {
    setEditDoc(doc);
    setEditTypeId(String(doc.typeId));
    setEditCustomName(doc.customTypeName || "");
    setEditFile(null);
    setEditAmount(doc.amount != null ? String(doc.amount) : "");
    setEditPaidOn(doc.paidOn ? doc.paidOn.split("T")[0] : "");
  }

  async function handleEditSave() {
    if (!editDoc || !category) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (editFile) fd.append("file", editFile);
      fd.append("typeId", editTypeId);
      if (isOthers(editTypeId) && editCustomName.trim()) fd.append("customTypeName", editCustomName.trim());
      if (isDues && editAmount) fd.append("amount", editAmount);
      if (isDues && editPaidOn) fd.append("paidOn", editPaidOn);

      await updateOcvDocument(clubId, editDoc.id, fd);
      await refreshDocs(category.id);
      setEditDoc(null);
      setSuccessMessage("Document updated.");
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (err as any)?.response?.data;
      setErrorMessage(e?.message || e?.detail || "Failed to update.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !category) return;
    try {
      await deleteOcvDocument(clubId, deleteTarget.id);
      await refreshDocs(category.id);
      setDeleteTarget(null);
      setSuccessMessage("Document deleted.");
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (err as any)?.response?.data;
      setDeleteTarget(null);
      setErrorMessage(e?.message || e?.detail || "Failed to delete.");
    }
  }

  function handleView(filePath: string) {
    window.open(`${API_URL}${filePath}`, "_blank", "noopener,noreferrer");
  }

  async function handleDownload(doc: OcvDocumentListItem) {
    try {
      const blob = await downloadOcvDocumentBlob(clubId, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.originalFileName || "document";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(`${API_URL}${doc.filePath}`, "_blank", "noopener,noreferrer");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) =>
      [
        d.typeName,
        d.customTypeName,
        d.originalFileName,
        d.amount != null ? String(d.amount) : null,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [documents, search]);

  const totalSize = useMemo(
    () => documents.reduce((acc, d) => acc + (d.fileSize || 0), 0),
    [documents],
  );
  const activeTypes = docTypes.filter((t) => t.isActive).length;
  const coveredTypes = useMemo(
    () => new Set(documents.map((d) => d.typeId)).size,
    [documents],
  );

  const body = (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            {!embedded && (
              <Link
                href={backHref}
                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Back"
              >
                <ArrowLeft size={15} />
              </Link>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${visual.bg} ${visual.accent}`}>
                  <Icon size={16} />
                </span>
                <h1 className="text-lg font-semibold text-slate-800 leading-tight">
                  {category?.categoryName || "Loading…"}
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-1">Upload and manage documents for this section.</p>
            </div>
          </div>
        </div>

        {/* KPI tiles */}
        {!loading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Documents"
              value={fmtInt(documents.length)}
              subtitle="Uploaded so far"
              icon={FolderUp}
              color="blue"
            />
            <KpiCard
              title="Coverage"
              value={`${coveredTypes}/${activeTypes}`}
              subtitle="Types with at least 1 file"
              icon={FileText}
              color="green"
            />
            <KpiCard
              title="Storage"
              value={formatBytes(totalSize)}
              subtitle="Total size on disk"
              icon={Upload}
              color="purple"
            />
            <KpiCard
              title="Document Types"
              value={fmtInt(activeTypes)}
              subtitle="Active in this category"
              icon={FilePlus2}
              color="gold"
            />
          </div>
        )}

        {/* Upload card */}
        {!loading && category && (
          <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden`}>
            <div className={`px-5 py-3 border-b border-slate-100 ${visual.tint}`}>
              <h2 className="text-sm font-semibold text-slate-800">Upload a document</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Allowed file types: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF.
              </p>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                {/* Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">Document Type</label>
                  <select
                    value={typeId}
                    onChange={(e) => setTypeId(e.target.value)}
                    className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  >
                    <option value="">Select type…</option>
                    {docTypes.filter((t) => t.isActive).map((t) => (
                      <option key={t.id} value={t.id}>{t.typeName}</option>
                    ))}
                  </select>
                </div>

                {/* Custom type (Others) */}
                {typeId && isOthers(typeId) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Document Name</label>
                    <input
                      type="text"
                      placeholder="Enter document name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                    />
                  </div>
                )}

                {/* File */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">Choose File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs file:font-medium hover:file:bg-slate-200"
                  />
                </div>

                {/* Dues only */}
                {isDues && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                    />
                  </div>
                )}
                {isDues && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Paid On</label>
                    <DateField value={paidOn} onChange={setPaidOn} className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
                  </div>
                )}

                {/* Upload button */}
                <div>
                  <LoadingButton
                    type="button"
                    onAction={handleUpload}
                    forcePending={uploading}
                    loadingLabel="Uploading…"
                    spinnerSize={14}
                    disabled={!typeId || !file || duplicateBlock}
                    className="inline-flex w-full items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {!uploading && <Upload size={14} />}
                    Upload
                  </LoadingButton>
                </div>
              </div>

              {duplicateBlock && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                  <AlertTriangle size={13} />
                  This document type already has an upload. Edit or delete the existing one first.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Documents table */}
        {!loading && category && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Documents</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {documents.length} record{documents.length === 1 ? "" : "s"} · {coveredTypes}/{activeTypes} types covered
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter documents…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <SkeletonRows />
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <Upload size={28} className="text-slate-300 mb-2" />
                  <p className="text-sm font-medium text-slate-600">No documents uploaded yet</p>
                  <p className="text-xs text-slate-400 mt-1">Use the form above to upload your first file.</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <Search size={24} className="text-slate-300 mb-2" />
                  <p className="text-sm font-medium text-slate-600">No documents match your filter</p>
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                    <tr>
                      <th className="px-3 py-2.5 text-left w-10">Sr</th>
                      <th className="px-3 py-2.5 text-left">Document Type</th>
                      <th className="px-3 py-2.5 text-left">File Name</th>
                      <th className="px-3 py-2.5 text-left w-24">Size</th>
                      {isDues && <th className="px-3 py-2.5 text-left w-28">Amount</th>}
                      {isDues && <th className="px-3 py-2.5 text-left w-32">Paid On</th>}
                      <th className="px-3 py-2.5 text-left w-44 whitespace-nowrap">Uploaded</th>
                      <th className="px-3 py-2.5 text-right w-40">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((doc, i) => (
                      <tr key={doc.id} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {doc.customTypeName ? `${doc.typeName}: ${doc.customTypeName}` : doc.typeName}
                        </td>
                        <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate" title={doc.originalFileName}>
                          {doc.originalFileName}
                        </td>
                        <td className="px-3 py-2 text-slate-500 tabular-nums">{formatBytes(doc.fileSize)}</td>
                        {isDues && (
                          <td className="px-3 py-2 text-slate-700 tabular-nums">
                            {doc.amount != null ? formatMoney(doc.amount) : "–"}
                          </td>
                        )}
                        {isDues && (
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatDate(doc.paidOn)}</td>
                        )}
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(doc.createdDate)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleView(doc.filePath)}
                              title="View"
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Eye size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(doc)}
                              title="Download"
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-violet-700 hover:bg-violet-50"
                            >
                              <Download size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(doc)}
                              title="Edit"
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(doc)}
                              title="Delete"
                              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Edit dialog */}
        <Dialog open={!!editDoc} onOpenChange={(o) => { if (!o) setEditDoc(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Document</DialogTitle>
              <DialogDescription>Update document details. Optionally replace the file.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Document Type</label>
                <select
                  value={editTypeId}
                  onChange={(e) => setEditTypeId(e.target.value)}
                  className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                >
                  <option value="">Select type…</option>
                  {docTypes.filter((t) => t.isActive).map((t) => (
                    <option key={t.id} value={t.id}>{t.typeName}</option>
                  ))}
                </select>
              </div>

              {editTypeId && isOthers(editTypeId) && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">Document Name</label>
                  <input
                    type="text"
                    placeholder="Enter document name"
                    value={editCustomName}
                    onChange={(e) => setEditCustomName(e.target.value)}
                    className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Replace File (optional)</label>
                <input
                  ref={editFileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                  onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700 file:text-xs file:font-medium hover:file:bg-slate-200"
                />
                {editDoc && (
                  <p className="text-xs text-slate-400">Current file: {editDoc.originalFileName}</p>
                )}
              </div>

              {isDues && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Paid On</label>
                    <DateField value={editPaidOn} onChange={setEditPaidOn} className="w-full px-2 h-10 py-0 text-sm border border-slate-200 rounded-[12px] bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]" />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setEditDoc(null)}
                disabled={saving}
                className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <LoadingButton
                type="button"
                onAction={handleEditSave}
                forcePending={saving}
                loadingLabel="Saving…"
                spinnerSize={14}
                className="inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-full bg-[#17458F] text-white hover:bg-[#17458F] disabled:opacity-50"
              >
                Save Changes
              </LoadingButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Document"
          description={
            <>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.originalFileName}</span>?
              This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
  );

  if (embedded) return body;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="OCV Category"
        pageSubtitle="Manage category documents"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        {body}
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
