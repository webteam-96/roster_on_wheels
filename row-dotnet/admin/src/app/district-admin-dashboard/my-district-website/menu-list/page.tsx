"use client";

/**
 * Menu List — District Admin Dashboard V2 route
 * ---------------------------------------------------------------------------
 * Mirror of src/app/districts/[id]/website-data/menu_list/page.tsx (READ-ONLY
 * source) rendered inside the DA dashboard navy sidebar shell.
 *
 * Differences vs the V1 source:
 *   - districtId comes from AuthContext (selectedDistrictId) — NOT from
 *     useParams — because this route has no [id] segment.
 *   - Back / Cancel navigate via goBack() honouring ?returnTo=; falls back
 *     to /district-admin-dashboard/my-district-website. yearId is preserved.
 *   - Palette shifted to the V2 DA dashboard tokens (navy #1e3a5f, gold
 *     #F7A81B underline, slate typography, rounded-2xl bg-white cards,
 *     slate-tuned inputs).
 *
 * Everything else is preserved verbatim from V1: parent/child menu tree with
 * expand/collapse, drag-sort for both menus and sub-menus, add/edit inline
 * dialog with dynamic Link Value input (page/external/document/html), file
 * upload for document type, isDefault-aware edit/delete gating, 9-menu cap,
 * active/inactive toggle, delete confirmation with cascade wording, search,
 * mobile card view + desktop table view, admin-role gating (SA || Admin).
 * ---------------------------------------------------------------------------
 */

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClubMenu, ClubSubMenu, LINK_TYPES, isHomeMenu } from "@/types/menu";
import {
  getDistrictMenus,
  createDistrictMenu,
  updateDistrictMenu,
  setDistrictMenuActive,
  deleteDistrictMenu,
  reorderDistrictMenusBulk,
  uploadDistrictMenuDocument,
  getDistrictSubMenus,
  createDistrictSubMenu,
  updateDistrictSubMenu,
  deleteDistrictSubMenu,
  reorderDistrictSubMenusBulk,
  getDistrict,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal,
  AlertTriangle, ExternalLink, Eye, EyeOff, ChevronDown, ChevronRight,
  GripVertical, List, Upload, X, FileText, PlusCircle,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

function getLinkTypeLabel(value: string): string {
  return LINK_TYPES.find((t) => t.value === value)?.label || value;
}

function getLinkTypeBadgeVariant(value: string): "default" | "secondary" | "outline" {
  switch (value) {
    case "page": return "default";
    case "external": return "secondary";
    case "document": return "outline";
    default: return "secondary";
  }
}

// Build a URL openable in a new tab — used by LinkTypeBadgeWithView so the
// admin can preview any uploaded document / external URL. Document/file/pdf
// values are prepended with the API base if relative. External URLs are
// passed through (with https:// auto-prepended). Page/html → null.
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

function LinkTypeBadgeWithView({ linkType, linkValue, className }: {
  linkType: string;
  linkValue: string | null | undefined;
  className?: string;
}) {
  const openUrl = resolveOpenUrl(linkType, linkValue);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={getLinkTypeBadgeVariant(linkType)} className={className}>
        {getLinkTypeLabel(linkType)}
      </Badge>
      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open uploaded file / link in a new tab"
          className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}

export default function DistrictAdminMenuListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");

  const goBack = () => {
    const dest = returnTo || "/district-admin-dashboard/my-district-website";
    if (!currentYearId) { router.push(dest); return; }
    const sep = dest.includes("?") ? "&" : "?";
    router.push(`${dest}${sep}yearId=${encodeURIComponent(currentYearId)}`);
  };

  const { isSuperAdmin, isAdmin, selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;

  const [districtNumber, setDistrictNumber] = useState("");
  const [menus, setMenus] = useState<ClubMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Expanded menus & sub-menu cache
  const [expandedMenuIds, setExpandedMenuIds] = useState<Set<number>>(new Set());
  const [subMenusMap, setSubMenusMap] = useState<Record<number, ClubSubMenu[]>>({});
  const [loadingSubMenus, setLoadingSubMenus] = useState<Set<number>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"menu" | "submenu">("menu");
  const [editingMenu, setEditingMenu] = useState<ClubMenu | null>(null);
  const [editingSubMenu, setEditingSubMenu] = useState<ClubSubMenu | null>(null);
  const [parentMenuId, setParentMenuId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formLinkType, setFormLinkType] = useState("page");
  const [formLinkValue, setFormLinkValue] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(1);
  const [formIsActive, setFormIsActive] = useState("1");
  const [uploading, setUploading] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<{ type: "menu" | "submenu"; item: ClubMenu | ClubSubMenu; menuId?: number } | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  const filteredMenus = menus.filter((menu) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      menu.menuName.toLowerCase().includes(q) ||
      getLinkTypeLabel(menu.linkType).toLowerCase().includes(q) ||
      (menu.isActive ? "active" : "inactive").includes(q)
    );
  });

  const fetchMenus = useCallback(async () => {
    try {
      const data = await getDistrictMenus(districtId);
      setMenus(data);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load menus.");
    }
  }, [districtId]);

  useEffect(() => {
    if (!districtId) return;
    async function fetchInitial() {
      setLoading(true);
      try {
        const districtData = await getDistrict(districtId);
        setDistrictNumber(districtData.districtNumber);
        await fetchMenus();
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [districtId, fetchMenus]);

  const fetchSubMenus = useCallback(async (menuId: number) => {
    setLoadingSubMenus((prev) => new Set(prev).add(menuId));
    try {
      const data = await getDistrictSubMenus(districtId, menuId);
      setSubMenusMap((prev) => ({ ...prev, [menuId]: data }));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load sub-menus.");
    } finally {
      setLoadingSubMenus((prev) => {
        const next = new Set(prev);
        next.delete(menuId);
        return next;
      });
    }
  }, [districtId]);

  const toggleExpand = (menuId: number) => {
    setExpandedMenuIds((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) {
        next.delete(menuId);
      } else {
        next.add(menuId);
        if (!subMenusMap[menuId]) {
          fetchSubMenus(menuId);
        }
      }
      return next;
    });
  };

  // ===== Menu Dialog =====

  const openAddMenuDialog = () => {
    setDialogMode("menu");
    setEditingMenu(null);
    setEditingSubMenu(null);
    setParentMenuId(null);
    setFormName("");
    setFormLinkType("page");
    setFormLinkValue("");
    setFormSortOrder(menus.length + 1);
    setFormIsActive("1");
    setDialogOpen(true);
  };

  const openEditMenuDialog = (menu: ClubMenu) => {
    setDialogMode("menu");
    setEditingMenu(menu);
    setEditingSubMenu(null);
    setParentMenuId(null);
    setFormName(menu.menuName);
    setFormLinkType(menu.linkType);
    setFormLinkValue(menu.linkValue);
    setFormSortOrder(menu.sortOrder);
    setFormIsActive(menu.isActive ? "1" : "0");
    setDialogOpen(true);
  };

  // ===== SubMenu Dialog =====

  const openAddSubMenuDialog = (menuId: number) => {
    setDialogMode("submenu");
    setEditingMenu(null);
    setEditingSubMenu(null);
    setParentMenuId(menuId);
    setFormName("");
    setFormLinkType("page");
    setFormLinkValue("");
    const subs = subMenusMap[menuId] || [];
    setFormSortOrder(subs.length + 1);
    setFormIsActive("1");
    setDialogOpen(true);
  };

  const openEditSubMenuDialog = (sub: ClubSubMenu) => {
    setDialogMode("submenu");
    setEditingMenu(null);
    setEditingSubMenu(sub);
    setParentMenuId(sub.menuId);
    setFormName(sub.subMenuName);
    setFormLinkType(sub.linkType);
    setFormLinkValue(sub.linkValue);
    setFormSortOrder(sub.sortOrder);
    setFormIsActive(sub.isActive ? "1" : "0");
    setDialogOpen(true);
  };

  // ===== File Upload =====

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadDistrictMenuDocument(districtId, file);
      setFormLinkValue(result.path);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload document.");
    } finally {
      setUploading(false);
    }
    e.target.value = "";
  };

  // ===== Save =====

  const handleSave = async () => {
    if (!formName.trim()) {
      setErrorMessage("Please enter a name.");
      return;
    }

    // Enforce 9-menu cap on save (not just on the Add button). Only
    // gates CREATE — edits of existing rows are always allowed.
    if (dialogMode === "menu" && !editingMenu && menus.length >= 9) {
      setErrorMessage(`Menu limit reached (${menus.length}/9). Delete an existing menu before adding a new one.`);
      return;
    }

    setSaving(true);
    try {
      if (dialogMode === "menu") {
        if (editingMenu) {
          await updateDistrictMenu(districtId, editingMenu.id, {
            menuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkValue,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Menu updated successfully.");
        } else {
          await createDistrictMenu(districtId, {
            menuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkValue,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Menu added successfully.");
        }
        setDialogOpen(false);
        await fetchMenus();
      } else {
        if (editingSubMenu && parentMenuId) {
          await updateDistrictSubMenu(districtId, parentMenuId, editingSubMenu.id, {
            subMenuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkValue,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Sub-menu updated successfully.");
        } else if (parentMenuId) {
          await createDistrictSubMenu(districtId, parentMenuId, {
            subMenuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkValue,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Sub-menu added successfully.");
        }
        setDialogOpen(false);
        if (parentMenuId) {
          await fetchSubMenus(parentMenuId);
          await fetchMenus();
        }
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to save.";
      setErrorMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  // ===== Delete =====

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "menu") {
        await deleteDistrictMenu(districtId, (deleteTarget.item as ClubMenu).id);
        setSuccessMessage("Menu deleted successfully.");
        await fetchMenus();
      } else {
        const sub = deleteTarget.item as ClubSubMenu;
        await deleteDistrictSubMenu(districtId, sub.menuId, sub.id);
        setSuccessMessage("Sub-menu deleted successfully.");
        await fetchSubMenus(sub.menuId);
        await fetchMenus();
      }
      setDeleteTarget(null);
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  // ===== Toggle Active =====

  const handleToggleMenuActive = async (menu: ClubMenu) => {
    try {
      await setDistrictMenuActive(districtId, menu.id, !menu.isActive);
      setSuccessMessage(menu.isActive ? "Menu deactivated." : "Menu activated.");
      await fetchMenus();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update menu status.");
    }
  };

  const handleToggleSubMenuActive = async (sub: ClubSubMenu) => {
    try {
      await updateDistrictSubMenu(districtId, sub.menuId, sub.id, {
        subMenuName: sub.subMenuName,
        linkType: sub.linkType,
        linkValue: sub.linkValue,
        sortOrder: sub.sortOrder,
        isActive: !sub.isActive,
      });
      setSuccessMessage(sub.isActive ? "Sub-menu deactivated." : "Sub-menu activated.");
      await fetchSubMenus(sub.menuId);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update sub-menu status.");
    }
  };

  // ===== Drag-and-drop reorder =====

  const isSearching = searchQuery.trim() !== "";

  const { dragProps: menuDragProps } = useDragSort(
    menus,
    setMenus,
    async (orderedIds) => {
      try {
        await reorderDistrictMenusBulk(districtId, orderedIds);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to reorder menus.");
        await fetchMenus();
      }
    }
  );

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
      await reorderDistrictSubMenusBulk(districtId, menuId, reordered.map((s) => s.id));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to reorder sub-menus.");
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

  // ===== Render helpers =====

  const renderLinkValueInput = () => {
    if (formLinkType === "document") {
      return (
        <div className="space-y-2">
          <Label className="text-slate-600 text-sm">Document *</Label>
          {formLinkValue ? (
            <div className="flex items-center gap-2 p-2 border border-slate-200 rounded-md bg-slate-50">
              <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
              <span className="text-sm truncate flex-1 text-slate-700">{formLinkValue.split("/").pop()}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                onClick={() => setFormLinkValue("")}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                <div className="flex items-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-md hover:border-[#1e3a5f]/40 hover:bg-slate-50 transition-colors">
                  <Upload className="h-4 w-4 text-slate-500" />
                  <span className="text-sm text-slate-500">
                    {uploading ? "Uploading..." : "Click to upload document"}
                  </span>
                </div>
              </label>
              <p className="text-xs text-slate-500 mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX (max 10 MB)</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Label className="text-slate-600 text-sm">Link Value *</Label>
        <Input
          className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
          placeholder={formLinkType === "external" ? "https://..." : "Enter page name (e.g., About Us)"}
          value={formLinkValue}
          onChange={(e) => setFormLinkValue(e.target.value)}
        />
      </div>
    );
  };

  const renderSubMenuRow = (sub: ClubSubMenu, index: number, _total: number) => (
    <TableRow
      key={sub.id}
      className="bg-slate-50/60 hover:bg-slate-100/70 transition-colors"
      {...(canManage ? subDragProps(sub.menuId, index) : {})}
    >
      <TableCell className="pl-12 text-slate-700">
        <span className="text-slate-400 mr-2">&#x2514;</span>
        {sub.subMenuName}
      </TableCell>
      <TableCell>
        <LinkTypeBadgeWithView linkType={sub.linkType} linkValue={sub.linkValue} />
      </TableCell>
      <TableCell>
        <Badge variant={sub.isActive ? "default" : "secondary"}>
          {sub.isActive ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell></TableCell>
      {canManage && (
        <TableCell className="text-center">
          <GripVertical className="h-4 w-4 text-slate-400 cursor-grab inline-block" />
        </TableCell>
      )}
      {canManage && (
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEditSubMenuDialog(sub)}>
                <Pencil className="mr-2 h-4 w-4" />Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggleSubMenuActive(sub)}>
                {sub.isActive ? (
                  <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                ) : (
                  <><Eye className="mr-2 h-4 w-4" />Activate</>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-700"
                onClick={() => setDeleteTarget({ type: "submenu", item: sub, menuId: sub.menuId })}
              >
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
    </TableRow>
  );

  const renderSubMenuCard = (sub: ClubSubMenu, index: number, _total: number) => (
    <div
      key={sub.id}
      className="ml-6 bg-slate-50/70 rounded-2xl border border-slate-200 shadow-sm"
      {...(canManage ? subDragProps(sub.menuId, index) : {})}
    >
      <div className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-slate-800">{sub.subMenuName}</p>
            <div className="flex gap-1 mt-1 items-center flex-wrap">
              <LinkTypeBadgeWithView linkType={sub.linkType} linkValue={sub.linkValue} className="text-xs" />
              <Badge variant={sub.isActive ? "default" : "secondary"} className="text-xs">
                {sub.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
          {canManage && (
            <GripVertical className="h-4 w-4 text-slate-400 cursor-grab flex-shrink-0" />
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditSubMenuDialog(sub)}>
                  <Pencil className="mr-2 h-4 w-4" />Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleToggleSubMenuActive(sub)}>
                  {sub.isActive ? (
                    <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                  ) : (
                    <><Eye className="mr-2 h-4 w-4" />Activate</>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-700"
                  onClick={() => setDeleteTarget({ type: "submenu", item: sub, menuId: sub.menuId })}
                >
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* ── Header card ────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={goBack}
                className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#1e3a5f]">
                  {districtNumber ? `District ${districtNumber} - Menu List` : "Menu List"}
                </h2>
                <div className="h-0.5 w-16 bg-[#F7A81B] rounded mt-1.5" />
                <p className="text-sm text-slate-500 mt-1.5">Manage website navigation menus</p>
              </div>
            </div>
            {canManage && (
              <Button
                onClick={openAddMenuDialog}
                disabled={menus.length >= 9}
                className="bg-[#1e3a5f] hover:bg-[#152a44] text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                <Plus className="mr-2 h-4 w-4" />Add Menu
              </Button>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Menu count badge — red once the count reaches the 9-menu cap
            so admin sees they need to delete rows before adding new ones. */}
        {!loading && (
          <div className="flex items-center gap-4 flex-wrap">
            <Badge
              variant="outline"
              className={
                menus.length >= 9
                  ? "border-red-200 bg-red-50 text-red-700 font-medium"
                  : menus.length >= 8
                    ? "border-amber-200 bg-amber-50 text-amber-700 font-medium"
                    : "border-slate-200 bg-white text-slate-700 font-medium"
              }
            >
              {menus.length}/9 Menus
              {menus.length > 9 && " · Over limit — please delete extras"}
            </Badge>
          </div>
        )}

        {/* Empty state */}
        {!loading && menus.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <List className="h-12 w-12 text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-800">No menus yet</h3>
              <p className="text-sm text-slate-500 mt-2">
                {canManage ? 'Click "Add Menu" to create your first navigation menu.' : "No menus have been added yet."}
              </p>
            </div>
          </div>
        )}

        {/* Menus list */}
        {!loading && menus.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search menus..."
            />
            {filteredMenus.length === 0 && searchQuery.trim() !== "" ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                <p className="text-slate-500 text-sm py-8 text-center">
                  No results found for &quot;{searchQuery}&quot;
                </p>
              </div>
            ) : (
            <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-3">
              {filteredMenus.map((menu, _filteredIndex) => {
                const isExpanded = expandedMenuIds.has(menu.id);
                const subs = subMenusMap[menu.id] || [];
                const isLoadingSubs = loadingSubMenus.has(menu.id);
                const realIndex = menus.findIndex((m) => m.id === menu.id);
                const dragHandlers = canManage && !isSearching ? menuDragProps(realIndex) : {};
                return (
                  <div key={menu.id}>
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm" {...dragHandlers}>
                      <div className="p-4">
                        <div className="flex items-center gap-3">
                          <button onClick={() => toggleExpand(menu.id)} className="flex-shrink-0 text-slate-500 hover:text-[#1e3a5f]">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-slate-800">{menu.menuName}</p>
                            <div className="flex gap-1 mt-1 flex-wrap items-center">
                              <LinkTypeBadgeWithView linkType={menu.linkType} linkValue={menu.linkValue} className="text-xs" />
                              <Badge variant={menu.isActive ? "default" : "secondary"} className="text-xs">
                                {menu.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {menu.subMenuCount > 0 && (
                                <Badge variant="outline" className="text-xs border-slate-200 bg-white text-slate-700">
                                  {menu.subMenuCount} sub
                                </Badge>
                              )}
                            </div>
                          </div>
                          {canManage && !isSearching && (
                            <GripVertical className="h-4 w-4 text-slate-400 cursor-grab flex-shrink-0" />
                          )}
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {!menu.isDefault && (
                                  <DropdownMenuItem onClick={() => openEditMenuDialog(menu)}>
                                    <Pencil className="mr-2 h-4 w-4" />Edit
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => { if (!isExpanded) toggleExpand(menu.id); openAddSubMenuDialog(menu.id); }}>
                                  <PlusCircle className="mr-2 h-4 w-4" />Add Sub-Menu
                                </DropdownMenuItem>
                                {!isHomeMenu(menu) && (
                                  <DropdownMenuItem onClick={() => handleToggleMenuActive(menu)}>
                                    {menu.isActive ? (
                                      <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                                    ) : (
                                      <><Eye className="mr-2 h-4 w-4" />Activate</>
                                    )}
                                  </DropdownMenuItem>
                                )}
                                {!menu.isDefault && (
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-700"
                                    onClick={() => setDeleteTarget({ type: "menu", item: menu })}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Expanded sub-menus */}
                    {isExpanded && (
                      <div className="space-y-2 mt-2">
                        {isLoadingSubs && (
                          <div className="flex justify-center py-4 ml-6">
                            <RotaryLoader size="sm" />
                          </div>
                        )}
                        {!isLoadingSubs && subs.length === 0 && (
                          <p className="text-sm text-slate-500 ml-6 py-2">No sub-menus</p>
                        )}
                        {!isLoadingSubs && subs.map((sub, si) => renderSubMenuCard(sub, si, subs.length))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#1e3a5f] hover:bg-[#1e3a5f]">
                    <TableHead className="text-white text-base font-semibold">Menu Name</TableHead>
                    <TableHead className="w-32 text-white text-base font-semibold">Link Type</TableHead>
                    <TableHead className="w-24 text-white text-base font-semibold">Status</TableHead>
                    <TableHead className="w-24 text-white text-base font-semibold">Sub-Menus</TableHead>
                    {canManage && <TableHead className="w-16 text-center text-white text-base font-semibold">Sort</TableHead>}
                    {canManage && <TableHead className="w-12 text-white"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMenus.map((menu, _filteredIndex) => {
                    const isExpanded = expandedMenuIds.has(menu.id);
                    const subs = subMenusMap[menu.id] || [];
                    const isLoadingSubs = loadingSubMenus.has(menu.id);
                    const realIndex = menus.findIndex((m) => m.id === menu.id);
                    const dragHandlers = canManage && !isSearching ? menuDragProps(realIndex) : {};
                    return (
                      <Fragment key={menu.id}>
                        <TableRow className="hover:bg-slate-50/70 transition-colors" {...dragHandlers}>
                          <TableCell>
                            <button
                              onClick={() => toggleExpand(menu.id)}
                              className="flex items-center gap-2 font-medium text-slate-800 hover:text-[#1e3a5f]"
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {menu.menuName}
                            </button>
                          </TableCell>
                          <TableCell>
                            <LinkTypeBadgeWithView linkType={menu.linkType} linkValue={menu.linkValue} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={menu.isActive ? "default" : "secondary"}>
                              {menu.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {menu.subMenuCount > 0 && (
                              <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                                {menu.subMenuCount}
                              </Badge>
                            )}
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-center">
                              {!isSearching && (
                                <GripVertical className="h-4 w-4 text-slate-400 cursor-grab inline-block" />
                              )}
                            </TableCell>
                          )}
                          {canManage && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {!menu.isDefault && (
                                    <DropdownMenuItem onClick={() => openEditMenuDialog(menu)}>
                                      <Pencil className="mr-2 h-4 w-4" />Edit
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => { if (!isExpanded) toggleExpand(menu.id); openAddSubMenuDialog(menu.id); }}>
                                    <PlusCircle className="mr-2 h-4 w-4" />Add Sub-Menu
                                  </DropdownMenuItem>
                                  {!isHomeMenu(menu) && (
                                    <DropdownMenuItem onClick={() => handleToggleMenuActive(menu)}>
                                      {menu.isActive ? (
                                        <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                                      ) : (
                                        <><Eye className="mr-2 h-4 w-4" />Activate</>
                                      )}
                                    </DropdownMenuItem>
                                  )}
                                  {!menu.isDefault && (
                                    <DropdownMenuItem
                                      className="text-red-600 focus:text-red-700"
                                      onClick={() => setDeleteTarget({ type: "menu", item: menu })}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />Delete
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                        {/* Expanded sub-menus */}
                        {isExpanded && isLoadingSubs && (
                          <TableRow>
                            <TableCell colSpan={canManage ? 6 : 4} className="py-4">
                              <div className="flex justify-center">
                                <RotaryLoader size="sm" />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        {isExpanded && !isLoadingSubs && subs.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={canManage ? 6 : 4} className="pl-12 text-sm text-slate-500 py-3">
                              No sub-menus
                            </TableCell>
                          </TableRow>
                        )}
                        {isExpanded && !isLoadingSubs && subs.map((sub, si) => renderSubMenuRow(sub, si, subs.length))}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
            )}
          </>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-slate-800">
                {dialogMode === "menu"
                  ? editingMenu ? "Edit Menu" : "Add Menu"
                  : editingSubMenu ? "Edit Sub-Menu" : "Add Sub-Menu"}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                {dialogMode === "menu"
                  ? editingMenu ? "Update the menu details." : "Create a new navigation menu."
                  : editingSubMenu ? "Update the sub-menu details." : "Create a new sub-menu."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Name */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">
                  {dialogMode === "menu" ? "Menu Name" : "Sub-Menu Name"} *
                </Label>
                <Input
                  className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                  placeholder={dialogMode === "menu" ? "Enter menu name" : "Enter sub-menu name"}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* Link Type */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Link Type *</Label>
                <Select value={formLinkType} onValueChange={(val) => { setFormLinkType(val); setFormLinkValue(""); }}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
                    <SelectValue placeholder="Select link type" />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Link Value - dynamic */}
              {renderLinkValueInput()}

              {/* Sort Order */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Sort Order</Label>
                <Input
                  className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                  type="number"
                  min={1}
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="bg-[#1e3a5f] hover:bg-[#152a44] text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                {saving ? "Saving..." : (editingMenu || editingSubMenu) ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-red-500"
          title={deleteTarget?.type === "menu" ? "Delete Menu" : "Delete Sub-Menu"}
          description={
            deleteTarget?.type === "menu" ? (
              <>
                Are you sure you want to delete <span className="font-semibold text-slate-800">{(deleteTarget?.item as ClubMenu)?.menuName}</span>?
                {(deleteTarget?.item as ClubMenu)?.subMenuCount > 0 && (
                  <> This will also delete <span className="font-semibold">{(deleteTarget.item as ClubMenu).subMenuCount}</span> sub-menu(s).</>
                )}
                {" "}This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete <span className="font-semibold text-slate-800">{(deleteTarget?.item as ClubSubMenu)?.subMenuName}</span>? This action cannot be undone.
              </>
            )
          }
          confirmLabel="Delete"
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
