"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClubMenu, ClubSubMenu } from "@/types/menu";
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
import { districtYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import { getLinkTypeLabel } from "./menuListHelpers";

export function useMenuList() {
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

  const { isSuperAdmin, isAdmin, selectedDistrictId, user } = useAuth();
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

  // No Rotary year on this data — one menu, one set of links, one About page,
  // all live now — so changing it needs CURRENT-year rights.
  // Named siteCurrentYearId: this page already has its own currentYearId.
  const { years: rotaryYears, currentYearId: siteCurrentYearId } = useRotaryYears();
  const siteRights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYearless(siteRights, siteCurrentYearId, isSuperAdmin);
  // YWAR-BADGE-YEARLESS — name the CURRENT year, not the years held.
  // This data is not filed by Rotary year, so "you can make changes in
  // 2025-26" is untrue: those years cannot help here. See ViewOnlyBadge.
  const ywarCurrentYearLabel =
    rotaryYears.find((y) => y.id === siteCurrentYearId)?.yearLabel ?? "";

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

  return {
    router, searchParams, returnTo, currentYearId, goBack, isSuperAdmin, isAdmin, selectedDistrictId, user, districtId, districtNumber, setDistrictNumber, menus, setMenus, loading, setLoading, successMessage, setSuccessMessage, errorMessage, setErrorMessage, searchQuery, setSearchQuery, expandedMenuIds, setExpandedMenuIds, subMenusMap, setSubMenusMap, loadingSubMenus, setLoadingSubMenus, dialogOpen, setDialogOpen, dialogMode, setDialogMode, editingMenu, setEditingMenu, editingSubMenu, setEditingSubMenu, parentMenuId, setParentMenuId, saving, setSaving, formName, setFormName, formLinkType, setFormLinkType, formLinkValue, setFormLinkValue, formSortOrder, setFormSortOrder, formIsActive, setFormIsActive, uploading, setUploading, deleteTarget, setDeleteTarget, rotaryYears, siteCurrentYearId, siteRights, canManage, ywarCurrentYearLabel, filteredMenus, fetchMenus, fetchSubMenus, toggleExpand, openAddMenuDialog, openEditMenuDialog, openAddSubMenuDialog, openEditSubMenuDialog, handleFileUpload, handleSave, handleDelete, handleToggleMenuActive, handleToggleSubMenuActive, isSearching, menuDragProps, subDragItem, subDragOverItem, handleSubMenuDragEnd, subDragProps,
  };
}

export type DistrictAdminMenuListPageState = ReturnType<typeof useMenuList>;
