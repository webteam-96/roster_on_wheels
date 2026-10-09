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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDistrictAdminCache } from "@/contexts/DistrictAdminDashboardCacheContext";
import {
  CalendarDays, Megaphone, Folder, FileText,
  Plus, Search, Filter, MoreHorizontal, Pencil, Trash2, Eye,
  AlertTriangle, Loader2, ExternalLink, MessageSquare,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import AlertModal from "@/components/AlertModal";
import SendStatusBadges from "@/components/SendStatusBadges";
import { useAuth } from "@/contexts/AuthContext";
import {
  getDistrictUpcomingEvents, getDistrictUpcomingEvent, deleteDistrictUpcomingEvent,
  getDistrictAnnouncements, deleteDistrictAnnouncement,
  getDistrictDocuments, deleteDistrictDocument,
  getDistrictNewsletters, deleteDistrictNewsletter,
  getPhotoUrl,
} from "@/services/api";
import type { UpcomingEventListItem, UpcomingEventDetail } from "@/types/upcomingEvent";
import type { AnnouncementListItem } from "@/types/announcement";
import type { DocumentListItem } from "@/types/document";
import type { NewsletterListItem } from "@/types/newsletter";

const RETURN_TO_QS = `?returnTo=${encodeURIComponent("/district-admin-dashboard/communication")}`;

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Published", label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired", label: "Expired" },
];

const PAGE_SIZE_PREVIEW = 8;
const PAGE_SIZE_FETCH = 15;

// ── helpers ──────────────────────────────────────────────────────────────

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusChipStyle(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "published":   return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "unpublished": return "bg-amber-50 text-amber-700 border-amber-200";
    case "expired":     return "bg-rose-50 text-rose-700 border-rose-200";
    default:            return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusChipStyle(status)}`}>
      {status || "—"}
    </span>
  );
}

// ── Shared section shell ─────────────────────────────────────────────────

interface SectionShellProps {
  icon: React.ElementType;
  iconClass: string;
  title: string;
  count: number;
  status: string;
  onStatusChange: (s: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  addHref: string;
  loading: boolean;
  children: React.ReactNode;
}

function SectionShell({
  icon: Icon, iconClass, title, count,
  status, onStatusChange, search, onSearchChange,
  addHref, loading, children,
}: SectionShellProps) {
  const activeStatusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "All";
  const [filterOpen, setFilterOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <Icon size={16} className={iconClass} />
        <h3 className="text-sm font-semibold text-slate-800 truncate">{title}</h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 tabular-nums">
          {count}
        </span>
        {loading && <Loader2 size={12} className="text-slate-400 animate-spin" />}

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                title="Filter by status"
              >
                <Filter size={11} />
                <span className="whitespace-nowrap">{activeStatusLabel}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onStatusChange(o.value);
                    setFilterOpen(false);
                  }}
                  className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-100 ${
                    status === o.value ? "bg-slate-100 font-semibold text-slate-800" : "text-slate-600"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-6 pr-2 py-1 text-[11px] border border-slate-200 rounded-md w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <Link
            href={addHref}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
          >
            <Plus size={12} /> Add
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Row actions (View / Edit / Delete) ───────────────────────────────────

interface RowActionsProps {
  onView: () => void;
  editHref: string;
  onDelete: () => void;
  canDelete: boolean;
}

function RowActions({ onView, editHref, onDelete, canDelete }: RowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex-shrink-0"
          aria-label="Row actions"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem onClick={onView} className="text-xs cursor-pointer">
          <Eye size={12} className="mr-1.5" /> View
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-xs cursor-pointer">
          <Link href={editHref}>
            <Pencil size={12} className="mr-1.5" /> Edit
          </Link>
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem
            onClick={onDelete}
            className="text-xs text-rose-600 focus:text-rose-700 focus:bg-rose-50 cursor-pointer"
          >
            <Trash2 size={12} className="mr-1.5" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────

interface DetailField {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}

function DetailModal({
  open, onClose, title, imagePath, status, fields,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  imagePath?: string | null;
  status?: string;
  fields: DetailField[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-3 flex-wrap pr-8">
            <span className="min-w-0 flex-1 break-words">{title || "—"}</span>
            {status && (
              <span className="flex-shrink-0">
                <StatusChip status={status} />
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {imagePath && (
            <div className="w-full aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getPhotoUrl(imagePath) || ""}
                alt={title}
                className="h-full w-full object-contain"
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {fields.map((f, i) => (
              <div
                key={i}
                className={`min-w-0 ${f.full ? "sm:col-span-2" : ""}`}
              >
                <p className="text-[10px] uppercase text-slate-400 font-semibold tracking-wide">{f.label}</p>
                <div className="text-sm text-slate-800 mt-0.5 break-words">{f.value ?? "—"}</div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Debounce hook ────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Upcoming Events (district-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export function UpcomingEventsSection({ districtId }: { districtId: number }) {
  const { isSuperAdmin, isAdmin } = useAuth();
  const canDelete = isSuperAdmin || isAdmin;

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
        addHref={`/districts/${districtId}/upcoming-events/v2/add${RETURN_TO_QS}`}
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
                  <p className="text-sm font-medium text-slate-800 truncate">{e.title || "—"}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                    <span>{fmtDate(e.eventDate)}</span>
                    <StatusChip status={e.status} />
                    <SendStatusBadges item={e} />
                    {e.isSendWhatsapp && (
                      <span className="text-blue-600 inline-flex items-center gap-0.5">
                        <MessageSquare size={10} /> WhatsApp
                      </span>
                    )}
                  </div>
                </div>
                <RowActions
                  onView={() => openView(e)}
                  editHref={`/districts/${districtId}/upcoming-events/v2/${e.id}/edit${RETURN_TO_QS}`}
                  onDelete={() => setDeleteTarget(e)}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/upcoming-events${RETURN_TO_QS}`}
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
          { label: "Description", value: viewItem?.description ?? "—", full: true },
          { label: "Event Date", value: fmtDateTime(viewItem?.eventDate) },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDate) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDate) },
          { label: "Venue", value: viewItem?.eventVenue || "—" },
          { label: "Registration Link", value: viewItem?.registrationLink
              ? <a href={viewItem.registrationLink} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open <ExternalLink size={11}/></a>
              : "—" },
          { label: "Send WhatsApp", value: viewItem?.isSendWhatsapp ? "Yes" : "No" },
          { label: "Repeat Notification", value: viewItem?.isRepeatNotification ? "Yes" : "No" },
          ...(detailLoading ? [{ label: "Loading full details…", value: <Loader2 className="animate-spin h-4 w-4 text-slate-400" />, full: true }] : []),
        ] : [
          { label: "Description", value: viewDetail.description ?? "—", full: true },
          { label: "Event Date", value: fmtDateTime(viewDetail.eventDate) },
          { label: "Publish Date", value: fmtDateTime(viewDetail.publishDate) },
          { label: "Expiry Date", value: fmtDateTime(viewDetail.expiryDate) },
          { label: "Venue", value: viewDetail.eventVenue || "—" },
          { label: "Registration Link", value: viewDetail.registrationLink
              ? <a href={viewDetail.registrationLink} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open <ExternalLink size={11}/></a>
              : "—" },
          { label: "Send WhatsApp", value: viewDetail.isSendWhatsapp ? "Yes" : "No" },
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
  const { isSuperAdmin, isAdmin } = useAuth();
  const canDelete = isSuperAdmin || isAdmin;

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
        iconClass="text-purple-600"
        title="Announcements"
        count={total}
        status={status}
        onStatusChange={setStatus}
        search={search}
        onSearchChange={setSearch}
        addHref={`/districts/${districtId}/announcements/v2/add${RETURN_TO_QS}`}
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
                    <div className="w-10 h-10 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0 border border-purple-100">
                      <Megaphone size={14} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.title || "—"}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                      <span>{fmtDate(a.publishDateTime)}</span>
                      <StatusChip status={a.status} />
                      <SendStatusBadges item={a} />
                    </div>
                  </div>
                </div>
                <RowActions
                  onView={() => setViewItem(a)}
                  editHref={`/districts/${districtId}/announcements/v2/${a.id}/edit${RETURN_TO_QS}`}
                  onDelete={() => setDeleteTarget(a)}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/announcements${RETURN_TO_QS}`}
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
          { label: "Description", value: viewItem?.description ?? "—", full: true },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDateTime) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDateTime) },
          { label: "Display on Banner", value: viewItem?.isDisplayOnBanner ? "Yes" : "No" },
          { label: "Send WhatsApp", value: viewItem?.isSendWhatsapp ? "Yes" : "No" },
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

// ═══════════════════════════════════════════════════════════════════════════
// 3. Shared Documents (district-scoped)
// ═══════════════════════════════════════════════════════════════════════════

export function DocumentsSection({ districtId }: { districtId: number }) {
  const { isSuperAdmin, isAdmin } = useAuth();
  const canDelete = isSuperAdmin || isAdmin;

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
        addHref={`/districts/${districtId}/documents/v2/add${RETURN_TO_QS}`}
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
                  <p className="text-sm font-medium text-slate-800 truncate">{d.title || "—"}</p>
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
                  editHref={`/districts/${districtId}/documents/v2/${d.id}/edit${RETURN_TO_QS}`}
                  onDelete={() => setDeleteTarget(d)}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/documents${RETURN_TO_QS}`}
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
          { label: "Original File Name", value: viewItem?.originalFileName || "—", full: true },
          { label: "Access Type", value: viewItem?.accessType?.replace(/_/g, " ") || "—" },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDateTime) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDateTime) },
          { label: "File", full: true, value: viewItem?.filePath
              ? <a href={getPhotoUrl(viewItem.filePath) || "#"} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open file <ExternalLink size={11}/></a>
              : "—" },
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
  const { isSuperAdmin, isAdmin } = useAuth();
  const canDelete = isSuperAdmin || isAdmin;
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
        addHref={`/districts/${districtId}/newsletters/v2/add${RETURN_TO_QS}`}
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
                    <p className="text-sm font-medium text-slate-800 truncate">{n.title || "—"}</p>
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
                  editHref={`/districts/${districtId}/newsletters/v2/${n.id}/edit${RETURN_TO_QS}`}
                  onDelete={() => setDeleteTarget(n)}
                  canDelete={canDelete}
                />
              </li>
            ))}
            {total > PAGE_SIZE_PREVIEW && (
              <li className="px-4 py-2 text-center">
                <Link
                  href={`/districts/${districtId}/newsletters${RETURN_TO_QS}`}
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
          { label: "Attachment Type", value: viewItem?.attachmentType || "—" },
          { label: "Send WhatsApp", value: viewItem?.isSendWhatsapp ? "Yes" : "No" },
          { label: "Publish Date", value: fmtDateTime(viewItem?.publishDateTime) },
          { label: "Expiry Date", value: fmtDateTime(viewItem?.expiryDateTime) },
          {
            label: viewItem?.attachmentType === "file" ? "File" : "Link URL",
            full: true,
            value: viewItem?.attachmentType === "file"
              ? (viewItem.filePath
                  ? <a href={getPhotoUrl(viewItem.filePath) || "#"} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">Open file <ExternalLink size={11}/></a>
                  : "—")
              : (viewItem?.linkUrl
                  ? <a href={viewItem.linkUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline inline-flex items-center gap-1">{viewItem.linkUrl} <ExternalLink size={11}/></a>
                  : "—"),
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
