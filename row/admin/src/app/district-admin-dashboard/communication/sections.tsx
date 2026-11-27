"use client";
/**
 * district-admin-dashboard/communication/sections.tsx
 * --------------------------------------------------------------------------
 * District Communication tab sections. Mirrors
 * club-admin-dashboard/communication/sections.tsx but wired to the district-
 * scoped endpoints (getDistrict{UpcomingEvents,Announcements,Documents,
 * Newsletters}) and points +Add / Edit at the existing v1 district pages
 * (there are no v2 district pages for these modules yet).
 *
 * Each section:
 *   - fetches its own paged list (status filter + search, defaults to Published)
 *   - opens a modal on row click showing every field
 *   - links "+ Add" and "Edit" to the district v1 pages with
 *     ?returnTo=/district-admin-dashboard/communication
 *   - offers Delete for Admin / SuperAdmin.
 *
 * The card visual shell is intentionally identical to the club version so the
 * two dashboards feel the same.
 */
import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import { CalendarDays, Megaphone, AlertTriangle, Loader2, ExternalLink } from "@/components/icons";
import AlertModal from "@/components/AlertModal";
import SendStatusBadges from "@/components/SendStatusBadges";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYearless, isCurrentYearSelected, heldYearLabels } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import {
  getDistrictUpcomingEvents,
  getDistrictUpcomingEvent,
  deleteDistrictUpcomingEvent,
  getDistrictAnnouncements,
  deleteDistrictAnnouncement,
  getPhotoUrl,
} from "@/services/api";
import type { UpcomingEventListItem, UpcomingEventDetail } from "@/types/upcomingEvent";
import type { AnnouncementListItem } from "@/types/announcement";
import { returnQs, PAGE_SIZE_PREVIEW, PAGE_SIZE_FETCH, fmtDateTime, fmtDate, StatusChip, SectionShell, RowActions, DetailModal, useDebounced } from "./sectionShared";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Upcoming Events (district-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export function UpcomingEventsSection({ districtId }: { districtId: number }) {
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

  const [items, setItems] = useState<UpcomingEventListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [viewItem, setViewItem] = useState<UpcomingEventListItem | null>(null);
  const [viewDetail, setViewDetail] = useState<UpcomingEventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<UpcomingEventListItem | null>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDistrictUpcomingEvents(districtId, 1, PAGE_SIZE_FETCH, status === "all" ? undefined : status, debSearch || undefined);
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

  const openView = useCallback(async (row: UpcomingEventListItem) => {
    setViewItem(row);
    setViewDetail(null);
    setDetailLoading(true);
    try {
      const d = await getDistrictUpcomingEvent(districtId, row.id);
      setViewDetail(d);
    } catch {
      setViewDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [districtId]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictUpcomingEvent(districtId, deleteTarget.id);
      setDeleteTarget(null);
      fetchList();
    } catch {
      setBanner({ tone: "error", text: "Failed to delete event." });
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <SectionShell
        icon={CalendarDays}
        iconClass="text-blue-600"
        title="Upcoming Events"
        count={total}
        status={status}
        onStatusChange={setStatus}
        search={search}
        onSearchChange={setSearch}
        addHref={`/districts/${districtId}/upcoming-events/v2/add${returnQs("events", yearParams?.get("yearId"))}`}
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
            <CalendarDays className="h-10 w-10 text-slate-300" />
            <p className="text-xs text-slate-400">No events for this filter.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 flex-1">
            {items.slice(0, PAGE_SIZE_PREVIEW).map((e) => (
              <li
                key={e.id}
                className="px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => openView(e)}
                >
                  <p className="text-sm font-medium text-slate-800 truncate">{e.title || "–"}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                    <span>{fmtDate(e.eventDate)}</span>
                    <StatusChip status={e.status} />
                    <SendStatusBadges item={e} />
                  </div>
                </div>
                <RowActions
                  onView={() => openView(e)}
                  editHref={`/districts/${districtId}/upcoming-events/v2/${e.id}/edit${returnQs("events", yearParams?.get("yearId"))}`}
                  onDelete={() => setDeleteTarget(e)}
                  canEdit={canManage}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/upcoming-events${returnQs("events", yearParams?.get("yearId"))}`}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  View all {total} events →
                </Link>
              </li>
            )}
          </ul>
        )}
      </SectionShell>

      <DetailModal
        open={!!viewItem}
        onClose={() => { setViewItem(null); setViewDetail(null); }}
        title={viewItem?.title || ""}
        imagePath={viewItem?.imagePath}
        status={viewItem?.status}
        fields={detailLoading || !viewDetail ? [
          { label: "Description", value: viewItem?.description ?? "–", full: true },
          { label: "Event Date", value: fmtDateTime(viewItem?.eventDate) },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDate) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDate) },
          { label: "Venue", value: viewItem?.eventVenue || "–" },
          { label: "Registration Link", value: viewItem?.registrationLink
              ? <a href={viewItem.registrationLink} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open <ExternalLink size={11}/></a>
              : "–" },
          { label: "Repeat Notification", value: viewItem?.isRepeatNotification ? "Yes" : "No" },
          ...(detailLoading ? [{ label: "Loading full details…", value: <Loader2 className="animate-spin h-4 w-4 text-slate-400" />, full: true }] : []),
        ] : [
          { label: "Description", value: viewDetail.description ?? "–", full: true },
          { label: "Event Date", value: fmtDateTime(viewDetail.eventDate) },
          { label: "Publish Date", value: fmtDateTime(viewDetail.publishDate) },
          { label: "Expiry Date", value: fmtDateTime(viewDetail.expiryDate) },
          { label: "Venue", value: viewDetail.eventVenue || "–" },
          { label: "Registration Link", value: viewDetail.registrationLink
              ? <a href={viewDetail.registrationLink} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open <ExternalLink size={11}/></a>
              : "–" },
          { label: "Repeat Notification", value: viewDetail.isRepeatNotification ? "Yes" : "No" },
          { label: "Reminders", full: true, value: viewDetail.reminders.length === 0
              ? "None"
              : <ul className="space-y-1 mt-0.5">{viewDetail.reminders.map((r) => <li key={r.id} className="text-xs">• {fmtDateTime(r.reminderDateTime)}</li>)}</ul>
          },
        ]}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Event"
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
// 2. Announcements (district-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export function AnnouncementsSection({ districtId }: { districtId: number }) {
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

  const [items, setItems] = useState<AnnouncementListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [viewItem, setViewItem] = useState<AnnouncementListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementListItem | null>(null);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDistrictAnnouncements(districtId, 1, PAGE_SIZE_FETCH, status === "all" ? undefined : status, debSearch || undefined);
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
      await deleteDistrictAnnouncement(districtId, deleteTarget.id);
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
        icon={Megaphone}
        iconClass="text-slate-600"
        title="Announcements"
        count={total}
        status={status}
        onStatusChange={setStatus}
        search={search}
        onSearchChange={setSearch}
        addHref={`/districts/${districtId}/announcements/v2/add${returnQs("announcements", yearParams?.get("yearId"))}`}
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
            <Megaphone className="h-10 w-10 text-slate-300" />
            <p className="text-xs text-slate-400">No announcements.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto flex-1">
            {items.slice(0, PAGE_SIZE_PREVIEW).map((a) => (
              <li
                key={a.id}
                className="px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2"
              >
                <div
                  className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer"
                  onClick={() => setViewItem(a)}
                >
                  {a.imagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getPhotoUrl(a.imagePath) || ""}
                      alt=""
                      className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-slate-200"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-slate-50 text-slate-600 flex items-center justify-center flex-shrink-0 border border-slate-100">
                      <Megaphone size={14} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.title || "–"}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                      <span>{fmtDate(a.publishDateTime)}</span>
                      <StatusChip status={a.status} />
                      <SendStatusBadges item={a} />
                    </div>
                  </div>
                </div>
                <RowActions
                  onView={() => setViewItem(a)}
                  editHref={`/districts/${districtId}/announcements/v2/${a.id}/edit${returnQs("announcements", yearParams?.get("yearId"))}`}
                  onDelete={() => setDeleteTarget(a)}
                  canEdit={canManage}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/announcements${returnQs("announcements", yearParams?.get("yearId"))}`}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  View all {total} announcements →
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
        imagePath={viewItem?.imagePath}
        status={viewItem?.status}
        fields={[
          { label: "Description", value: viewItem?.description ?? "–", full: true },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDateTime) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDateTime) },
          { label: "Display on Banner", value: viewItem?.isDisplayOnBanner ? "Yes" : "No" },
          { label: "Repeat Notification", value: viewItem?.isRepeatNotification ? "Yes" : "No" },
          { label: "Reminder Count", value: viewItem?.reminderCount ?? 0 },
        ]}
      />

      <AlertModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        icon={AlertTriangle}
        iconClassName="text-destructive"
        title="Delete Announcement"
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


// Moved to their own file (wave 3 split); still exported from here so "./sections" imports keep working.
export { DocumentsSection, NewslettersSection } from "./DocumentsNewslettersSections";
