"use client";

/**
 * Menu List v2 listing — Website Data sub-module.
 *
 * Mirrors the design language of the Club Admin Dashboard (KPI tiles +
 * dense table). Data is still served by the existing v1 endpoints
 * (getClubMenus + getClubSubMenus + updateClubMenu/SubMenu + delete +
 * reorder bulk + getClub).
 *
 * The v1 page (`../page.tsx`) is hierarchical — 8 default menus seeded
 * by the API + at most 1 custom menu, each with optional sub-menus.
 * The v2 keeps the same hierarchy: each row expands to reveal its
 * sub-menus, and active/default/custom counts surface as KPI tiles.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, AlertTriangle, ChevronDown, ChevronRight, Edit3, ExternalLink, Eye, EyeOff,
  GripVertical, Layers, List, Loader2, Pencil, Plus, PlusCircle, Search,
  Shield, Star, Trash2, TrendingUp,
} from "@/components/icons";
import {
  deleteClubMenu, deleteClubSubMenu, getClub, getClubMenus, getClubSubMenus,
  reorderMenusBulk, reorderSubMenusBulk, setClubMenuActive, updateClubMenu, updateClubSubMenu,
} from "@/services/api";
import { ClubMenu, ClubSubMenu, LINK_TYPES, isHomeMenu } from "@/types/menu";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { SkeletonRows } from "@/components/row/AppKit";

function getLinkTypeLabel(value: string): string {
  return LINK_TYPES.find((t) => t.value === value)?.label || value;
}

function linkTypeChipStyle(value: string): string {
  switch (value) {
    case "page": return "bg-blue-50 text-blue-700 border-blue-200";
    case "external": return "bg-violet-50 text-violet-700 border-violet-200";
    case "document": return "bg-amber-50 text-amber-700 border-amber-200";
    case "html": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default: return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

// Build a URL that can be opened in a new tab from the menu's link-type +
// link-value. Returns null for types that don't make sense to "open" (page,
// html — those are internal site routes, not standalone resources). For
// document/file uploads, prepend the API base if the stored path is relative
// (e.g. "/Documents/menu/123.pdf" → "https://portal.example.org/API/Documents/menu/123.pdf").
function resolveOpenUrl(linkType: string, linkValue: string | null | undefined): string | null {
  if (!linkValue || !linkValue.trim()) return null;
  const v = linkValue.trim();
  if (linkType === "document" || linkType === "file" || linkType === "pdf") {
    if (v.startsWith("http://") || v.startsWith("https://")) return v;
    const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
    return base + (v.startsWith("/") ? v : "/" + v);
  }
  if (linkType === "external" || linkType === "url" || linkType === "weblink") {
    if (v.startsWith("http://") || v.startsWith("https://")) return v;
    return "https://" + v;
  }
  return null;
}

export default function MenuListV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [menus, setMenus] = useState<ClubMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [search, setSearch] = useState("");

  // Expanded menus & sub-menu cache
  const [expandedMenuIds, setExpandedMenuIds] = useState<Set<number>>(new Set());
  const [subMenusMap, setSubMenusMap] = useState<Record<number, ClubSubMenu[]>>({});
  const [loadingSubMenus, setLoadingSubMenus] = useState<Set<number>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<
    { type: "menu"; item: ClubMenu }
    | { type: "submenu"; item: ClubSubMenu; menuId: number }
    | null
  >(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → add/edit → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/website-data/menu_list/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  // Back arrow honors parent returnTo (e.g. /club-admin-dashboard/my-club-website).
  const backHref = parentReturnTo || `/clubs/${clubId}/website-data`;

  // Spec cap: 8 default + max 1 custom = 9 total.
  const customMenuCount = menus.filter((m) => !m.isDefault).length;
  const addMenuDisabled = customMenuCount >= 1;
  const addUrl = `/clubs/${clubId}/website-data/menu_list/v2/add?returnTo=${returnTo}`;

  const isSearching = search.trim() !== "";

  const fetchMenus = useCallback(async () => {
    setLoadingRecords(true);
    try {
      const data = await getClubMenus(clubId);
      setMenus(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string } };
      const msg = (typeof e.response?.data === "object" && e.response?.data?.message)
        || (typeof e.response?.data === "string" ? e.response.data : undefined)
        || "Failed to load menus.";
      setErrorMessage(msg);
    } finally {
      setLoadingRecords(false);
    }
  }, [clubId]);

  useEffect(() => {
    // Guard: useParams() can briefly yield an empty object during client-side
    // navigation/hydration, making clubId = NaN. Skip the fetch in that case;
    // the effect will re-run once params.id is populated.
    if (!Number.isFinite(clubId)) return;
    let cancelled = false;
    async function init() {
      // Fetch club name and menus independently — a transient failure on
      // getClub (e.g. a 403 from the kill-switch check) must NOT prevent the
      // menu list from loading, or the listing would stay empty even though
      // the data exists.
      try {
        const club = await getClub(clubId);
        if (!cancelled) setClubName(club.clubName);
      } catch {
        // ignore — clubName falls back to "—" in the header
      }
      if (cancelled) return;
      await fetchMenus();
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, fetchMenus]);

  const fetchSubMenus = useCallback(async (menuId: number) => {
    setLoadingSubMenus((prev) => new Set(prev).add(menuId));
    try {
      const data = await getClubSubMenus(clubId, menuId);
      setSubMenusMap((prev) => ({ ...prev, [menuId]: data }));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load sub-menus.");
    } finally {
      setLoadingSubMenus((prev) => {
        const next = new Set(prev);
        next.delete(menuId);
        return next;
      });
    }
  }, [clubId]);

  const toggleExpand = (menuId: number) => {
    setExpandedMenuIds((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) {
        next.delete(menuId);
      } else {
        next.add(menuId);
        if (!subMenusMap[menuId]) fetchSubMenus(menuId);
      }
      return next;
    });
  };

  // ===== Filter (search) =====

  const filteredMenus = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return menus;
    return menus.filter((menu) =>
      menu.menuName.toLowerCase().includes(q)
      || getLinkTypeLabel(menu.linkType).toLowerCase().includes(q)
      || (menu.isActive ? "active" : "inactive").includes(q)
    );
  }, [menus, search]);

  // ===== KPIs =====

  const totalMenus = menus.length;
  const activeMenus = menus.filter((m) => m.isActive).length;
  const defaultMenus = menus.filter((m) => m.isDefault).length;

  // ===== Drag-and-drop reorder (top-level menus) =====

  const { dragProps: menuDragProps } = useDragSort(
    menus,
    setMenus,
    async (orderedIds) => {
      try { await reorderMenusBulk(clubId, orderedIds); }
      catch {
        setErrorMessage("Failed to reorder menus.");
        await fetchMenus();
      }
    }
  );

  // ===== Drag-and-drop reorder (sub-menus, per parent) =====

  const subDragItem = useRef<{ menuId: number; idx: number } | null>(null);
  const subDragOverItem = useRef<{ menuId: number; idx: number } | null>(null);

  const handleSubMenuDragEnd = async (menuId: number) => {
    const start = subDragItem.current;
    const end = subDragOverItem.current;
    subDragItem.current = null;
    subDragOverItem.current = null;
    if (!start || !end || start.menuId !== menuId || end.menuId !== menuId || start.idx === end.idx) return;

    const subs = subMenusMap[menuId] || [];
    const reordered = [...subs];
    const [removed] = reordered.splice(start.idx, 1);
    reordered.splice(end.idx, 0, removed);
    setSubMenusMap((prev) => ({ ...prev, [menuId]: reordered }));

    try {
      await reorderSubMenusBulk(clubId, menuId, reordered.map((s) => s.id));
    } catch {
      setErrorMessage("Failed to reorder sub-menus.");
      await fetchSubMenus(menuId);
    }
  };

  const subDragProps = (menuId: number, idx: number) => ({
    draggable: true,
    onDragStart: () => { subDragItem.current = { menuId, idx }; },
    onDragEnter: () => { subDragOverItem.current = { menuId, idx }; },
    onDragEnd: () => handleSubMenuDragEnd(menuId),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    style: { cursor: "grab" } as React.CSSProperties,
  });

  // ===== Toggle Active =====

  const handleToggleMenuActive = async (menu: ClubMenu) => {
    try {
      await setClubMenuActive(clubId, menu.id, !menu.isActive);
      setSuccessMessage(menu.isActive ? "Menu deactivated." : "Menu activated.");
      await fetchMenus();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update menu status.");
    }
  };

  const handleToggleSubMenuActive = async (sub: ClubSubMenu) => {
    try {
      await updateClubSubMenu(clubId, sub.menuId, sub.id, {
        subMenuName: sub.subMenuName,
        linkType: sub.linkType,
        linkValue: sub.linkValue,
        sortOrder: sub.sortOrder,
        isActive: !sub.isActive,
      });
      setSuccessMessage(sub.isActive ? "Sub-menu deactivated." : "Sub-menu activated.");
      await fetchSubMenus(sub.menuId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update sub-menu status.");
    }
  };

  // ===== Delete =====

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "menu") {
        await deleteClubMenu(clubId, deleteTarget.item.id);
        setSuccessMessage("Menu deleted successfully.");
        await fetchMenus();
      } else {
        await deleteClubSubMenu(clubId, deleteTarget.menuId, deleteTarget.item.id);
        setSuccessMessage("Sub-menu deleted successfully.");
        await fetchSubMenus(deleteTarget.menuId);
        await fetchMenus();
      }
      setDeleteTarget(null);
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  const editMenuHref = (menu: ClubMenu) =>
    `/clubs/${clubId}/website-data/menu_list/v2/${menu.id}/edit?returnTo=${returnTo}`;

  const addSubMenuHref = (menu: ClubMenu) =>
    `/clubs/${clubId}/website-data/menu_list/v2/${menu.id}/edit?returnTo=${returnTo}&addSub=1`;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Menu List"
        pageSubtitle="Public website navigation menus"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Menu List</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Website navigation · {clubName || "–"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Menus"     value={fmtInt(totalMenus)}      subtitle="Top-level entries"        icon={List}       color="blue" />
          <KpiCard title="Active"          value={fmtInt(activeMenus)}     subtitle={`${activeMenus}/9 visible`} icon={TrendingUp} color="green" />
          <KpiCard title="Default"         value={fmtInt(defaultMenus)}    subtitle="Seeded by system"         icon={Shield}     color="purple" />
          <KpiCard title="Custom"          value={fmtInt(customMenuCount)} subtitle={`${customMenuCount}/1 max`} icon={Star}       color="gold" />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Navigation Menus</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {defaultMenus} default menu{defaultMenus === 1 ? "" : "s"} auto-seeded ·{" "}
                {customMenuCount >= 1
                  ? `custom slot used (${customMenuCount}/1)`
                  : "1 custom slot available"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-auto">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search menus…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 pr-3 h-10 py-0 text-sm border border-slate-200 rounded-[12px] w-full sm:w-48 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
                />
              </div>
              {canManage && (
                <Link
                  href={addMenuDisabled ? "#" : addUrl}
                  onClick={(e) => { if (addMenuDisabled) e.preventDefault(); }}
                  title={addMenuDisabled
                    ? "Only 1 custom menu is allowed (in addition to the 8 default menus). Edit or delete the existing custom menu first."
                    : "Add a custom menu"}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                    addMenuDisabled
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-[#17458F] text-white hover:bg-[#123A78]"
                  }`}
                  aria-disabled={addMenuDisabled}
                >
                  <Plus size={13} /> Add Custom Menu
                </Link>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {loading || loadingRecords ? (
              <SkeletonRows />
            ) : (
              <table className="w-full min-w-[640px] md:min-w-full text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                  <tr>
                    <th className="px-3 py-2.5 text-left w-10">Sr</th>
                    <th className="px-3 py-2.5 text-left">Menu Name</th>
                    <th className="px-3 py-2.5 text-left w-32">Link Type</th>
                    <th className="px-3 py-2.5 text-left w-24">Status</th>
                    <th className="px-3 py-2.5 text-left w-24">Sub-Menus</th>
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Visibility</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Edit</th>}
                    {canManage && <th className="px-3 py-2.5 text-right w-16">Delete</th>}
                    {canManage && <th className="px-3 py-2.5 text-center w-16">Sort</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMenus.map((menu, i) => {
                    const isExpanded = expandedMenuIds.has(menu.id);
                    const subs = subMenusMap[menu.id] || [];
                    const isLoadingSubs = loadingSubMenus.has(menu.id);
                    const realIdx = menus.findIndex((m) => m.id === menu.id);
                    const dragEnabled = canManage && !isSearching;
                    const totalCols = canManage ? 9 : 5;
                    return (
                      <Row
                        key={menu.id}
                        menu={menu}
                        i={i}
                        isExpanded={isExpanded}
                        subs={subs}
                        isLoadingSubs={isLoadingSubs}
                        canManage={canManage}
                        dragEnabled={dragEnabled}
                        dragProps={dragEnabled ? menuDragProps(realIdx) : {}}
                        subDragProps={subDragProps}
                        totalCols={totalCols}
                        onToggleExpand={() => toggleExpand(menu.id)}
                        onToggleActive={() => handleToggleMenuActive(menu)}
                        onToggleSubActive={(s) => handleToggleSubMenuActive(s)}
                        editHref={editMenuHref(menu)}
                        addSubHref={addSubMenuHref(menu)}
                        returnTo={returnTo}
                        onDeleteMenu={() => setDeleteTarget({ type: "menu", item: menu })}
                        onDeleteSub={(s) => setDeleteTarget({ type: "submenu", item: s, menuId: s.menuId })}
                      />
                    );
                  })}
                  {filteredMenus.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 9 : 5} className="px-4 py-10 text-center text-slate-400">
                        {isSearching ? "No menus match your search." : "No menus configured."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
            {filteredMenus.length} menu{filteredMenus.length === 1 ? "" : "s"} · {customMenuCount}/1 custom · {defaultMenus} default
          </div>
        </div>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title={deleteTarget?.type === "menu" ? "Delete Menu" : "Delete Sub-Menu"}
          description={
            deleteTarget?.type === "menu" ? (
              <>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">{deleteTarget.item.menuName}</span>?
                {deleteTarget.item.subMenuCount > 0 && (
                  <> This will also delete <span className="font-semibold">{deleteTarget.item.subMenuCount}</span> sub-menu(s).</>
                )}
                {" "}This action cannot be undone.
              </>
            ) : deleteTarget?.type === "submenu" ? (
              <>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-foreground">{deleteTarget.item.subMenuName}</span>? This action cannot be undone.
              </>
            ) : null
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
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

// ───────────────────────────────────────────────────────────────
// Row (top-level menu + its expanded sub-menus, rendered inline).
// ───────────────────────────────────────────────────────────────

interface RowProps {
  menu: ClubMenu;
  i: number;
  isExpanded: boolean;
  subs: ClubSubMenu[];
  isLoadingSubs: boolean;
  canManage: boolean;
  dragEnabled: boolean;
  dragProps: Record<string, unknown>;
  subDragProps: (menuId: number, idx: number) => Record<string, unknown>;
  totalCols: number;
  onToggleExpand: () => void;
  onToggleActive: () => void;
  onToggleSubActive: (s: ClubSubMenu) => void;
  editHref: string;
  addSubHref: string;
  returnTo: string;
  onDeleteMenu: () => void;
  onDeleteSub: (s: ClubSubMenu) => void;
}

function Row(props: RowProps) {
  const {
    menu, i, isExpanded, subs, isLoadingSubs, canManage, dragEnabled, dragProps,
    subDragProps, totalCols, onToggleExpand, onToggleActive, onToggleSubActive,
    editHref, addSubHref, returnTo, onDeleteMenu, onDeleteSub,
  } = props;

  return (
    <>
      <tr className="hover:bg-blue-50/40" {...dragProps}>
        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-2 font-medium text-slate-800 hover:text-blue-700"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>{menu.menuName}</span>
            {menu.isDefault && (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">
                Default
              </span>
            )}
          </button>
        </td>
        <td className="px-3 py-2">
          <div className="inline-flex items-center gap-1.5">
            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${linkTypeChipStyle(menu.linkType)}`}>
              {getLinkTypeLabel(menu.linkType)}
            </span>
            {/* View-uploaded-content button — only when the linkValue can be
                opened externally (uploaded document / external URL). Lets
                the admin verify what they actually uploaded. */}
            {(() => {
              const openUrl = resolveOpenUrl(menu.linkType, menu.linkValue);
              return openUrl ? (
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open uploaded file / link in a new tab"
                  className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                >
                  <ExternalLink size={13} />
                </a>
              ) : null;
            })()}
          </div>
        </td>
        <td className="px-3 py-2">
          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
            menu.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"
          }`}>
            {menu.isActive ? "Active" : "Inactive"}
          </span>
        </td>
        <td className="px-3 py-2 text-slate-600">
          {menu.subMenuCount > 0 ? (
            <button
              type="button"
              onClick={onToggleExpand}
              title="View / manage sub-menus"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-blue-700"
            >
              <Layers className="h-3.5 w-3.5 text-slate-400" />{menu.subMenuCount}
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : canManage ? (
            <Link
              href={addSubHref}
              title="Add a sub-menu under this menu"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              <PlusCircle className="h-3.5 w-3.5" /> Add
            </Link>
          ) : (
            <span className="text-slate-300 text-xs">, </span>
          )}
        </td>
        {canManage && (
          <td className="px-3 py-2 text-right">
            {isHomeMenu(menu) ? (
              <span className="text-slate-300 text-xs" title="Home menu is always active">, </span>
            ) : (
            <button
              type="button"
              onClick={onToggleActive}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
              aria-label={menu.isActive ? "Deactivate menu" : "Activate menu"}
              title={menu.isActive ? "Deactivate" : "Activate"}
            >
              {menu.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            )}
          </td>
        )}
        {canManage && (
          <td className="px-3 py-2 text-right">
            {isHomeMenu(menu) ? (
              <span className="text-slate-300 text-xs" title="Home menu cannot be edited">, </span>
            ) : (
            <Link
              href={editHref}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
              aria-label="Edit menu"
              title="Edit"
            >
              <Edit3 size={13} />
            </Link>
            )}
          </td>
        )}
        {canManage && (
          <td className="px-3 py-2 text-right">
            {!menu.isDefault ? (
              <button
                type="button"
                onClick={onDeleteMenu}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                aria-label="Delete menu"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            ) : (
              <span className="text-slate-300 text-xs" title="Default menus cannot be deleted">, </span>
            )}
          </td>
        )}
        {canManage && (
          <td className="px-3 py-2 text-center"
            title={dragEnabled ? "Drag to reorder" : "Clear search to enable reorder"}>
            <GripVertical className={`h-4 w-4 inline-block ${dragEnabled ? "text-slate-400 cursor-grab" : "text-slate-300 cursor-not-allowed"}`} />
          </td>
        )}
      </tr>

      {/* Expanded sub-menus */}
      {isExpanded && isLoadingSubs && (
        <tr>
          <td colSpan={totalCols} className="py-4">
            <SkeletonRows />
          </td>
        </tr>
      )}
      {isExpanded && !isLoadingSubs && subs.length === 0 && (
        <tr>
          <td colSpan={totalCols} className="px-4 py-3 bg-slate-50/50">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 pl-7">No sub-menus under this menu.</span>
              {canManage && (
                <Link
                  href={addSubHref}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-white"
                >
                  <PlusCircle size={12} /> Add Sub-Menu
                </Link>
              )}
            </div>
          </td>
        </tr>
      )}
      {isExpanded && !isLoadingSubs && subs.length > 0 && (
        <tr>
          <td colSpan={totalCols} className="bg-slate-50/50 px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Sub-menus</span>
              {canManage && (
                <Link
                  href={addSubHref}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-white"
                >
                  <PlusCircle size={12} /> Add Sub-Menu
                </Link>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {subs.filter(s => (s.subMenuName ?? "").trim() !== "").map((sub, si) => (
                    <tr key={sub.id} className="hover:bg-blue-50/30" {...(canManage ? subDragProps(sub.menuId, si) : {})}>
                      <td className="px-3 py-2 w-6 text-slate-400">{si + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-700">
                        <span className="text-slate-300 mr-1">└</span>{sub.subMenuName}
                        {sub.isSystemManaged && (
                          <span className="ml-2 inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                            System
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 w-32">
                        <div className="inline-flex items-center gap-1.5">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${linkTypeChipStyle(sub.linkType)}`}>
                            {getLinkTypeLabel(sub.linkType)}
                          </span>
                          {/* Same view-uploaded-content button as the parent menu row */}
                          {(() => {
                            const openUrl = resolveOpenUrl(sub.linkType, sub.linkValue);
                            return openUrl ? (
                              <a
                                href={openUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open uploaded file / link in a new tab"
                                className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                              >
                                <ExternalLink size={13} />
                              </a>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td className="px-3 py-2 w-24">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                          sub.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"
                        }`}>
                          {sub.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-3 py-2 w-16 text-right">
                          <button
                            type="button"
                            onClick={() => onToggleSubActive(sub)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label={sub.isActive ? "Deactivate sub-menu" : "Activate sub-menu"}
                            title={sub.isActive ? "Deactivate" : "Activate"}
                          >
                            {sub.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </td>
                      )}
                      {canManage && (
                        <td className="px-3 py-2 w-16 text-right">
                          <Link
                            href={`?editSub=${sub.id}&parentMenu=${sub.menuId}`}
                            scroll={false}
                            onClick={(e) => {
                              // Edit a sub-menu uses the parent menu edit page.
                              e.preventDefault();
                              window.location.href = `${window.location.pathname.replace(/\/v2$/, "/v2")}/${sub.menuId}/edit?returnTo=${returnTo}&editSub=${sub.id}`;
                            }}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label="Edit sub-menu"
                            title="Edit"
                          >
                            <Pencil size={13} />
                          </Link>
                        </td>
                      )}
                      {canManage && (
                        <td className="px-3 py-2 w-16 text-right">
                          <button
                            type="button"
                            onClick={() => onDeleteSub(sub)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            aria-label="Delete sub-menu"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                      {canManage && (
                        <td className="px-3 py-2 w-12 text-center">
                          <GripVertical className="h-4 w-4 inline-block text-slate-400 cursor-grab" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
