import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { ClubMenu, ClubSubMenu } from "@/types/menu";
import { getClubMenus, createClubMenu, updateClubMenu, setClubMenuActive, deleteClubMenu, reorderMenusBulk, uploadMenuDocument, getClubSubMenus, createClubSubMenu, updateClubSubMenu, deleteClubSubMenu, reorderSubMenusBulk, getClub } from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pencil, Trash2, MoreHorizontal, Eye, EyeOff, GripVertical, Upload, X, FileText } from "@/components/icons";
import { ReactQuill, getLinkTypeLabel, LinkTypeBadgeWithView } from "./menuListShared";

export function useMenuList() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [menus, setMenus] = useState<ClubMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Expanded menus & sub-menu cache
  const [expandedMenuIds, setExpandedMenuIds] = useState<Set<number>>(new Set());
  const [subMenusMap, setSubMenusMap] = useState<Record<number, ClubSubMenu[]>>({});
  const [loadingSubMenus, setLoadingSubMenus] = useState<Set<number>>(new Set());
  // Tracks a menu that was auto-expanded by clicking "Add Sub-Menu" — if the
  // user cancels the dialog without saving, the menu should collapse back
  // (otherwise an empty "No sub-menus" placeholder lingers as a phantom row).
  const [autoExpandedForAdd, setAutoExpandedForAdd] = useState<number | null>(null);

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
  const [formContentHtml, setFormContentHtml] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(1);
  const [formIsActive, setFormIsActive] = useState("1");
  const [uploading, setUploading] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<{ type: "menu" | "submenu"; item: ClubMenu | ClubSubMenu; menuId?: number } | null>(null);

  const canManage = isSuperAdmin || isAdmin;
  // Spec cap: 8 default + max 1 custom = 9 total. Block "Add Menu" once 1 custom exists.
  const customMenuCount = menus.filter((m) => !m.isDefault).length;
  const addMenuDisabled = customMenuCount >= 1;

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
      const data = await getClubMenus(clubId);
      setMenus(data);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load menus.");
    }
  }, [clubId]);

  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const clubData = await getClub(clubId);
        setClubName(clubData.clubName);
        await fetchMenus();
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [clubId, fetchMenus]);

  const fetchSubMenus = useCallback(async (menuId: number) => {
    setLoadingSubMenus((prev) => new Set(prev).add(menuId));
    try {
      const data = await getClubSubMenus(clubId, menuId);
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
  }, [clubId]);

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
    setFormContentHtml("");
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
    setFormContentHtml(menu.contentHtml || "");
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
    setFormContentHtml("");
    const subs = subMenusMap[menuId] || [];
    setFormSortOrder(subs.length + 1);
    setFormIsActive("1");
    // Remember if we are auto-expanding so cancel can collapse back.
    if (!expandedMenuIds.has(menuId)) setAutoExpandedForAdd(menuId);
    setDialogOpen(true);
  };

  // Collapse a menu that was auto-expanded for Add Sub-Menu if the user
  // cancels without saving and the menu still has no real sub-menus. Called
  // from the dialog's onOpenChange (covers Cancel button, Esc, click-outside).
  const handleDialogOpenChange = (open: boolean) => {
    if (!open && autoExpandedForAdd !== null) {
      const id = autoExpandedForAdd;
      const subs = subMenusMap[id] || [];
      if (subs.length === 0) {
        setExpandedMenuIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      setAutoExpandedForAdd(null);
    }
    setDialogOpen(open);
  };

  const openEditSubMenuDialog = (sub: ClubSubMenu) => {
    setDialogMode("submenu");
    setEditingMenu(null);
    setEditingSubMenu(sub);
    setParentMenuId(sub.menuId);
    setFormName(sub.subMenuName);
    setFormLinkType(sub.linkType);
    setFormLinkValue(sub.linkValue);
    setFormContentHtml("");
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
      const result = await uploadMenuDocument(clubId, file);
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
          await updateClubMenu(clubId, editingMenu.id, {
            menuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkType === "html" ? "" : formLinkValue,
            contentHtml: formLinkType === "html" ? formContentHtml : null,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Menu updated successfully.");
        } else {
          await createClubMenu(clubId, {
            menuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkType === "html" ? "" : formLinkValue,
            contentHtml: formLinkType === "html" ? formContentHtml : null,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Menu added successfully.");
        }
        setDialogOpen(false);
        await fetchMenus();
      } else {
        if (editingSubMenu && parentMenuId) {
          await updateClubSubMenu(clubId, parentMenuId, editingSubMenu.id, {
            subMenuName: formName.trim(),
            linkType: formLinkType,
            linkValue: formLinkValue,
            sortOrder: formSortOrder,
            isActive: formIsActive === "1",
          });
          setSuccessMessage("Sub-menu updated successfully.");
        } else if (parentMenuId) {
          await createClubSubMenu(clubId, parentMenuId, {
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
        // Save succeeded — a real sub-menu now exists, so the auto-expand
        // should NOT be reverted. Clear the marker.
        setAutoExpandedForAdd(null);
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
        await deleteClubMenu(clubId, (deleteTarget.item as ClubMenu).id);
        setSuccessMessage("Menu deleted successfully.");
        await fetchMenus();
      } else {
        const sub = deleteTarget.item as ClubSubMenu;
        await deleteClubSubMenu(clubId, sub.menuId, sub.id);
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
      await setClubMenuActive(clubId, menu.id, !menu.isActive);
      setSuccessMessage(menu.isActive ? "Menu deactivated." : "Menu activated.");
      await fetchMenus();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update menu status.");
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
        await reorderMenusBulk(clubId, orderedIds);
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
      await reorderSubMenusBulk(clubId, menuId, reordered.map((s) => s.id));
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
    // For custom menus only — sub-menus don't get the rich-text option (linkType
    // here is forced to page/external/document on sub-menus by the spec).
    if (formLinkType === "html" && dialogMode === "menu") {
      return (
        <div className="space-y-2">
          <Label>Content *</Label>
          <ReactQuill
            theme="snow"
            value={formContentHtml}
            onChange={setFormContentHtml}
            placeholder="Write the page content..."
            modules={{
              toolbar: [
                [{ header: [1, 2, 3, false] }],
                ["bold", "italic", "underline", "strike"],
                [{ list: "ordered" }, { list: "bullet" }],
                ["link", "image"],
                ["clean"],
              ],
            }}
          />
          <p className="text-xs text-muted-foreground">
            This content will render as a standalone page on the public site.
          </p>
        </div>
      );
    }

    if (formLinkType === "document") {
      return (
        <div className="space-y-2">
          <Label>Document *</Label>
          {formLinkValue ? (
            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate flex-1">{formLinkValue.split("/").pop()}</span>
              <Button variant="ghost" size="icon" className="w-6 row-btn-sm" aria-label="Clear file" onClick={() => setFormLinkValue("")}>
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
        <span className="text-muted-foreground mr-2">└</span>
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
              <Button variant="ghost" size="icon" className="row-btn-sm" aria-label="More actions">
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
                <Button variant="ghost" size="icon" className="row-btn-sm" aria-label="More actions">
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
  return { clubId, clubName, menus, loading, successMessage, setSuccessMessage, errorMessage, setErrorMessage, searchQuery, setSearchQuery, expandedMenuIds, subMenusMap, loadingSubMenus, dialogOpen, dialogMode, editingMenu, editingSubMenu, saving, formName, setFormName, formLinkType, setFormLinkType, setFormLinkValue, formSortOrder, setFormSortOrder, formIsActive, setFormIsActive, deleteTarget, setDeleteTarget, canManage, customMenuCount, addMenuDisabled, filteredMenus, toggleExpand, openAddMenuDialog, openEditMenuDialog, openAddSubMenuDialog, handleDialogOpenChange, handleSave, handleDelete, handleToggleMenuActive, isSearching, menuDragProps, renderLinkValueInput, renderSubMenuRow, renderSubMenuCard };
}

export type MenuListCtx = ReturnType<typeof useMenuList>;
