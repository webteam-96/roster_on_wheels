"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
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
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
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
          className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}

export default function DistrictMenuListPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

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
          <Label>Document *</Label>
          {formLinkValue ? (
            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate flex-1">{formLinkValue.split("/").pop()}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFormLinkValue("")}>
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
                <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md hover:border-primary/50 transition-colors">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {uploading ? "Uploading..." : "Click to upload document"}
                  </span>
                </div>
              </label>
              <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX (max 10 MB)</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <Label>Link Value *</Label>
        <Input
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
      className="bg-muted/30 hover:bg-muted/50 transition-colors"
      {...(canManage ? subDragProps(sub.menuId, index) : {})}
    >
      <TableCell className="pl-12">
        <span className="text-muted-foreground mr-2">&#x2514;</span>
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
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab inline-block" />
        </TableCell>
      )}
      {canManage && (
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
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
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget({ type: "submenu", item: sub, menuId: sub.menuId })}>
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
    </TableRow>
  );

  const renderSubMenuCard = (sub: ClubSubMenu, index: number, _total: number) => (
    <Card
      key={sub.id}
      className="border-muted ml-6"
      {...(canManage ? subDragProps(sub.menuId, index) : {})}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{sub.subMenuName}</p>
            <div className="flex gap-1 mt-1 items-center">
              <LinkTypeBadgeWithView linkType={sub.linkType} linkValue={sub.linkValue} className="text-xs" />
              <Badge variant={sub.isActive ? "default" : "secondary"} className="text-xs">
                {sub.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
          {canManage && (
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
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
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget({ type: "submenu", item: sub, menuId: sub.menuId })}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtNumber ? `District ${districtNumber} - Menu List` : "Menu List"}
              </h2>
              <p className="text-muted-foreground text-base">Manage website navigation menus</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddMenuDialog} disabled={menus.length >= 9}>
              <Plus className="mr-2 h-4 w-4" />Add Menu
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Menu count badge */}
        {!loading && (
          <div className="flex items-center gap-4 flex-wrap">
            <Badge variant="secondary">
              {menus.length}/9 Menus
            </Badge>
          </div>
        )}

        {/* Empty state */}
        {!loading && menus.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <List className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No menus yet</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Menu" to create your first navigation menu.' : "No menus have been added yet."}
            </p>
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
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
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
                    <Card className="border-primary/20" {...dragHandlers}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <button onClick={() => toggleExpand(menu.id)} className="flex-shrink-0">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{menu.menuName}</p>
                            <div className="flex gap-1 mt-1 flex-wrap">
                              <LinkTypeBadgeWithView linkType={menu.linkType} linkValue={menu.linkValue} className="text-xs" />
                              <Badge variant={menu.isActive ? "default" : "secondary"} className="text-xs">
                                {menu.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {menu.subMenuCount > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  {menu.subMenuCount} sub
                                </Badge>
                              )}
                            </div>
                          </div>
                          {canManage && !isSearching && (
                            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
                          )}
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
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
                                  <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget({ type: "menu", item: menu })}>
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    {/* Expanded sub-menus */}
                    {isExpanded && (
                      <div className="space-y-2 mt-2">
                        {isLoadingSubs && (
                          <div className="flex justify-center py-4 ml-6">
                            <RotaryLoader size="sm" />
                          </div>
                        )}
                        {!isLoadingSubs && subs.length === 0 && (
                          <p className="text-sm text-muted-foreground ml-6 py-2">No sub-menus</p>
                        )}
                        {!isLoadingSubs && subs.map((sub, si) => renderSubMenuCard(sub, si, subs.length))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground text-base font-semibold">Menu Name</TableHead>
                    <TableHead className="w-32 text-primary-foreground text-base font-semibold">Link Type</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Status</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Sub-Menus</TableHead>
                    {canManage && <TableHead className="w-16 text-center text-primary-foreground text-base font-semibold">Sort</TableHead>}
                    {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
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
                      <>
                        <TableRow key={menu.id} className="hover:bg-primary/5 transition-colors" {...dragHandlers}>
                          <TableCell>
                            <button onClick={() => toggleExpand(menu.id)} className="flex items-center gap-2 font-medium">
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
                              <Badge variant="outline">{menu.subMenuCount}</Badge>
                            )}
                          </TableCell>
                          {canManage && (
                            <TableCell className="text-center">
                              {!isSearching && (
                                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab inline-block" />
                              )}
                            </TableCell>
                          )}
                          {canManage && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
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
                                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget({ type: "menu", item: menu })}>
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
                          <TableRow key={`${menu.id}-loading`}>
                            <TableCell colSpan={canManage ? 6 : 4} className="py-4">
                              <div className="flex justify-center">
                                <RotaryLoader size="sm" />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        {isExpanded && !isLoadingSubs && subs.length === 0 && (
                          <TableRow key={`${menu.id}-empty`}>
                            <TableCell colSpan={canManage ? 6 : 4} className="pl-12 text-sm text-muted-foreground py-3">
                              No sub-menus
                            </TableCell>
                          </TableRow>
                        )}
                        {isExpanded && !isLoadingSubs && subs.map((sub, si) => renderSubMenuRow(sub, si, subs.length))}
                      </>
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
              <DialogTitle>
                {dialogMode === "menu"
                  ? editingMenu ? "Edit Menu" : "Add Menu"
                  : editingSubMenu ? "Edit Sub-Menu" : "Add Sub-Menu"}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === "menu"
                  ? editingMenu ? "Update the menu details." : "Create a new navigation menu."
                  : editingSubMenu ? "Update the sub-menu details." : "Create a new sub-menu."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Name */}
              <div className="space-y-2">
                <Label>{dialogMode === "menu" ? "Menu Name" : "Sub-Menu Name"} *</Label>
                <Input
                  placeholder={dialogMode === "menu" ? "Enter menu name" : "Enter sub-menu name"}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* Link Type */}
              <div className="space-y-2">
                <Label>Link Type *</Label>
                <Select value={formLinkType} onValueChange={(val) => { setFormLinkType(val); setFormLinkValue(""); }}>
                  <SelectTrigger>
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
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={1}
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger>
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
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !formName.trim()}>
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
          iconClassName="text-destructive"
          title={deleteTarget?.type === "menu" ? "Delete Menu" : "Delete Sub-Menu"}
          description={
            deleteTarget?.type === "menu" ? (
              <>
                Are you sure you want to delete <span className="font-semibold text-foreground">{(deleteTarget?.item as ClubMenu)?.menuName}</span>?
                {(deleteTarget?.item as ClubMenu)?.subMenuCount > 0 && (
                  <> This will also delete <span className="font-semibold">{(deleteTarget.item as ClubMenu).subMenuCount}</span> sub-menu(s).</>
                )}
                {" "}This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete <span className="font-semibold text-foreground">{(deleteTarget?.item as ClubSubMenu)?.subMenuName}</span>? This action cannot be undone.
              </>
            )
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
    </ProtectedRoute>
  );
}
