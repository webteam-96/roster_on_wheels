"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import { Folder, FileText, AlertTriangle, ExternalLink } from "@/components/icons";
import AlertModal from "@/components/AlertModal";
import SendStatusBadges from "@/components/SendStatusBadges";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYearless, isCurrentYearSelected, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import {
  getDistrictDocuments,
  deleteDistrictDocument,
  getDistrictNewsletters,
  deleteDistrictNewsletter,
  getPhotoUrl,
} from "@/services/api";
import type { DocumentListItem } from "@/types/document";
import type { NewsletterListItem } from "@/types/newsletter";
import { returnQs, PAGE_SIZE_PREVIEW, PAGE_SIZE_FETCH, fmtDateTime, fmtDate, StatusChip, SectionShell, RowActions, DetailModal, useDebounced } from "./sectionShared";

// ═══════════════════════════════════════════════════════════════════════════
// 3. Shared Documents (district-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export function DocumentsSection({ districtId }: { districtId: number }) {
  const { isSuperAdmin, isAdmin, user } = useAuth();
  // District announcements, events and documents carry NO Rotary year — they are
  // the district's current state — so changing them needs CURRENT-year rights.
  const { years: rotaryYears, currentYearId } = useRotaryYears();
  const commsRights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  // ⚠️ AND the picker: this data has no Rotary year, so the year-less rule
  // alone kept Add and Edit on screen while a past year was selected, which
  // reads as the year rule having failed. The list is not year-filtered —
  // nothing else on the screen changes, only the buttons.
  // Both hooks unconditionally: folding them into the || would skip one when
  // the URL carries a year, which React counts as a hook-order change.
  const yearParams = useSearchParams();
  const yearCache = useDistrictAdminCache();
  const selectedYearId = Number(yearParams?.get("yearId") ?? "") || yearCache.yearId || 0;
  const canManage = (isSuperAdmin || isAdmin)
    && canEditYearless(commsRights, currentYearId, isSuperAdmin)
    && isCurrentYearSelected(selectedYearId, currentYearId, commsRights);
  // Names the CURRENT year in the badge — the member's own years are not the
  // point here, since only a current-year admin can ever change this data.
  const currentYearLabel = rotaryYears.find((y) => y.isCurrent)?.yearLabel ?? "";
  const editableYears = heldYearLabels(commsRights, rotaryYears.map((y) => ({ id: y.id, label: y.yearLabel })));
  const canDelete = canManage;

  const [status, setStatus] = useState<string>("Published");
  const [search, setSearch] = useState("");
  const debSearch = useDebounced(search);

  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [viewItem, setViewItem] = useState<DocumentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDistrictDocuments(districtId, 1, PAGE_SIZE_FETCH, status === "all" ? undefined : status, debSearch || undefined);
      setItems(res.items || []);
      setTotal(res.totalCount ?? (res.items?.length ?? 0));
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [districtId, status, debSearch]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictDocument(districtId, deleteTarget.id);
      setDeleteTarget(null);
      fetchList();
    } catch {
      setBanner({ tone: "error", text: "Failed to delete." });
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <SectionShell
        icon={Folder}
        iconClass="text-amber-600"
        title="Documents"
        count={total}
        status={status}
        onStatusChange={setStatus}
        search={search}
        onSearchChange={setSearch}
        addHref={`/districts/${districtId}/documents/v2/add${returnQs("documents", yearParams?.get("yearId"))}`}
        canAdd={canManage}
        editableYears={editableYears}
        currentYearOnly={currentYearLabel}
        loading={loading}
      >
        {banner && (
          <div className={`mx-4 mt-2 rounded-md text-xs px-2.5 py-1.5 border ${
            banner.tone === "success"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-rose-50 text-rose-700 border-rose-200"
          }`}>
            {banner.text}
          </div>
        )}
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center flex-1 flex flex-col items-center justify-center gap-2">
            <Folder className="h-10 w-10 text-slate-300" />
            <p className="text-xs text-slate-400">No documents.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 flex-1 max-h-[420px] overflow-y-auto">
            {items.slice(0, PAGE_SIZE_PREVIEW).map((d) => (
              <li
                key={d.id}
                className="px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => setViewItem(d)}
                >
                  <p className="text-sm font-medium text-slate-800 truncate">{d.title || "–"}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                    <span>{fmtDate(d.publishDateTime)}</span>
                    <StatusChip status={d.status} />
                    {d.accessType && (
                      <span className="uppercase tracking-wide text-[9px] font-semibold text-slate-500">{d.accessType.replace(/_/g, " ")}</span>
                    )}
                  </div>
                </div>
                <RowActions
                  onView={() => setViewItem(d)}
                  editHref={`/districts/${districtId}/documents/v2/${d.id}/edit${returnQs("documents", yearParams?.get("yearId"))}`}
                  onDelete={() => setDeleteTarget(d)}
                  canEdit={canManage}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/documents${returnQs("documents", yearParams?.get("yearId"))}`}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  View all {total} documents →
                </Link>
              </li>
            )}
          </ul>
        )}
      </SectionShell>

      <DetailModal
        open={!!viewItem}
        onClose={() => setViewItem(null)}
        title={viewItem?.title || ""}
        status={viewItem?.status}
        fields={[
          { label: "Original File Name", value: viewItem?.originalFileName || "–", full: true },
          { label: "Access Type", value: viewItem?.accessType?.replace(/_/g, " ") || "–" },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDateTime) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDateTime) },
          { label: "File", full: true, value: viewItem?.filePath
              ? <a href={getPhotoUrl(viewItem.filePath) || "#"} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open file <ExternalLink size={11}/></a>
              : "–" },
        ]}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Document"
        description={<>Delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This cannot be undone.</>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Newsletters (district-scoped, year-bound)
// ═══════════════════════════════════════════════════════════════════════════

export function NewslettersSection({ districtId }: { districtId: number }) {
  const { isSuperAdmin, isAdmin, user } = useAuth();
  // District announcements, events and documents carry NO Rotary year — they are
  // the district's current state — so changing them needs CURRENT-year rights.
  const { years: rotaryYears, currentYearId } = useRotaryYears();
  const commsRights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYearless(commsRights, currentYearId, isSuperAdmin);
  const editableYears = heldYearLabels(commsRights, rotaryYears.map((y) => ({ id: y.id, label: y.yearLabel })));
  const canDelete = canManage;
  // Newsletters API is year-scoped (uses per-year tables). Prefer the URL
  // ?yearId=; fall back to the district cache context which has the resolved
  // current year — that way we don't send yearId=0 which triggers a slow
  // all-tables scan on the backend.
  const searchParams = useSearchParams();
  const cache = useDistrictAdminCache();
  const urlYearStr = searchParams?.get("yearId") ?? "";
  const urlYearId = urlYearStr ? parseInt(urlYearStr, 10) || 0 : 0;
  const yearId = urlYearId || cache.yearId || 0;

  const [status, setStatus] = useState<string>("Published");
  const [search, setSearch] = useState("");
  const debSearch = useDebounced(search);

  const [items, setItems] = useState<NewsletterListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [viewItem, setViewItem] = useState<NewsletterListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsletterListItem | null>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const fetchList = useCallback(async () => {
    if (!yearId) return;
    setLoading(true);
    try {
      const res = await getDistrictNewsletters(districtId, yearId, 1, PAGE_SIZE_FETCH, status === "all" ? undefined : status, debSearch || undefined);
      setItems(res.items || []);
      setTotal(res.totalCount ?? (res.items?.length ?? 0));
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [districtId, yearId, status, debSearch]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictNewsletter(districtId, deleteTarget.id);
      setDeleteTarget(null);
      fetchList();
    } catch {
      setBanner({ tone: "error", text: "Failed to delete." });
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <SectionShell
        icon={FileText}
        iconClass="text-emerald-600"
        title="GML"
        count={total}
        status={status}
        onStatusChange={setStatus}
        search={search}
        onSearchChange={setSearch}
        addHref={`/districts/${districtId}/newsletters/v2/add${returnQs("newsletters", searchParams?.get("yearId"))}`}
        canAdd={canManage}
        editableYears={editableYears}
        loading={loading}
      >
        {banner && (
          <div className={`mx-4 mt-2 rounded-md text-xs px-2.5 py-1.5 border ${
            banner.tone === "success"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-rose-50 text-rose-700 border-rose-200"
          }`}>
            {banner.text}
          </div>
        )}
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center flex-1 flex flex-col items-center justify-center gap-2">
            <FileText className="h-10 w-10 text-slate-300" />
            <p className="text-xs text-slate-400">No newsletters.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 flex-1 max-h-[420px] overflow-y-auto">
            {items.slice(0, PAGE_SIZE_PREVIEW).map((n) => (
              <li
                key={n.id}
                className="px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2"
              >
                <div
                  className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer"
                  onClick={() => setViewItem(n)}
                >
                  <div className="w-10 h-10 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 border border-emerald-100">
                    <FileText size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{n.title || "–"}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                      <span>{fmtDate(n.publishDateTime)}</span>
                      <StatusChip status={n.status} />
                      <span className="uppercase tracking-wide text-[9px] font-semibold text-slate-500">{n.attachmentType}</span>
                      <SendStatusBadges item={n} />
                    </div>
                  </div>
                </div>
                <RowActions
                  onView={() => setViewItem(n)}
                  editHref={`/districts/${districtId}/newsletters/v2/${n.id}/edit${returnQs("newsletters", searchParams?.get("yearId"))}`}
                  onDelete={() => setDeleteTarget(n)}
                  canEdit={canManage}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/newsletters${returnQs("newsletters", searchParams?.get("yearId"))}`}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  View all {total} newsletters →
                </Link>
              </li>
            )}
          </ul>
        )}
      </SectionShell>

      <DetailModal
        open={!!viewItem}
        onClose={() => setViewItem(null)}
        title={viewItem?.title || ""}
        status={viewItem?.status}
        fields={[
          { label: "Attachment Type", value: viewItem?.attachmentType || "–" },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDateTime) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDateTime) },
          {
            label: viewItem?.attachmentType === "file" ? "File" : "Link URL",
            full: true,
            value: viewItem?.attachmentType === "file"
              ? (viewItem.filePath
                  ? <a href={getPhotoUrl(viewItem.filePath) || "#"} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open file <ExternalLink size={11}/></a>
                  : "–")
              : (viewItem?.linkUrl
                  ? <a href={viewItem.linkUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">{viewItem.linkUrl} <ExternalLink size={11}/></a>
                  : "–"),
          },
        ]}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Newsletter"
        description={<>Delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This cannot be undone.</>}
        confirmLabel="Delete"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirm={handleDelete}
        cancelLabel="Cancel"
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
