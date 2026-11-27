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
 *   - Palette shifted to the V2 DA dashboard tokens (navy #17458f, gold
 *     #F7A81B underline, slate typography, rounded-2xl bg-card cards,
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
import { LinkButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { Fragment } from "react";
import { ClubMenu, ClubSubMenu, LINK_TYPES, isHomeMenu } from "@/types/menu";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  GripVertical,
  List,
  Upload,
  X,
  FileText,
  PlusCircle,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { LinkTypeBadgeWithView } from "./menuListHelpers";
import { useMenuList } from "./useMenuList";


export default function DistrictAdminMenuListPage() {
  const r = useMenuList();
  const { goBack, districtId, districtNumber, menus, loading, successMessage, setSuccessMessage, errorMessage, setErrorMessage, searchQuery, setSearchQuery, expandedMenuIds, subMenusMap, loadingSubMenus, dialogOpen, setDialogOpen, dialogMode, editingMenu, editingSubMenu, saving, formName, setFormName, formLinkType, setFormLinkType, formLinkValue, setFormLinkValue, formSortOrder, setFormSortOrder, formIsActive, setFormIsActive, uploading, deleteTarget, setDeleteTarget, canManage, ywarCurrentYearLabel, filteredMenus, toggleExpand, openAddMenuDialog, openEditMenuDialog, openAddSubMenuDialog, openEditSubMenuDialog, handleFileUpload, handleSave, handleDelete, handleToggleMenuActive, handleToggleSubMenuActive, isSearching, menuDragProps, subDragProps } = r;
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
                className="w-6 row-btn-sm"
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
                <div className="flex items-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-md hover:border-azure/40 hover:bg-slate-50 transition-colors">
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
              <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm">
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
                <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm">
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
      {!canManage && (
        <ViewOnlyBadge currentYearOnly={ywarCurrentYearLabel} className="mb-4" />
      )}

      <div className="space-y-6">
        {/* ── Header card ────────────────────────────────────────────── */}
        <PageHeader
          title={districtNumber ? `District ${districtNumber} - Menu List` : "Menu List"}
          description="Manage website navigation menus"
          back={() => goBack()}
          actions={canManage && (
              <Button
                onClick={openAddMenuDialog}
                disabled={menus.length >= 9}
                className="disabled:text-slate-500"
              >
                <Plus className="mr-2 h-4 w-4" />Add Menu
              </Button>
            )}
        />

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
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
                    : "border-slate-200 bg-card text-slate-700 font-medium"
              }
            >
              {menus.length}/9 Menus
              {menus.length > 9 && " · Over limit. Please delete extras"}
            </Badge>
          </div>
        )}

        {/* Empty state */}
        {!loading && menus.length === 0 && (
          <Card>
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <List className="h-12 w-12 text-slate-400 mb-4" />
              <h3 className="row-h2">No menus yet</h3>
              <p className="text-sm text-slate-500 mt-2">
                {canManage ? 'Click "Add Menu" to create your first navigation menu.' : "No menus have been added yet."}
              </p>
            </div>
          </Card>
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
              <Card>
                <p className="text-slate-500 text-sm py-8 text-center">
                  No results found for &quot;{searchQuery}&quot;
                </p>
              </Card>
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
                    <Card {...dragHandlers}>
                      <div className="p-4">
                        <div className="flex items-center gap-3">
                          <IconButton type="button" onClick={() => toggleExpand(menu.id)} aria-label={isExpanded ? "Collapse" : "Expand"} aria-expanded={isExpanded} className="flex-shrink-0">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </IconButton>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-slate-800">{menu.menuName}</p>
                            <div className="flex gap-1 mt-1 flex-wrap items-center">
                              <LinkTypeBadgeWithView linkType={menu.linkType} linkValue={menu.linkValue} className="text-xs" />
                              <Badge variant={menu.isActive ? "default" : "secondary"} className="text-xs">
                                {menu.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {menu.subMenuCount > 0 && (
                                <Badge variant="outline" className="border-slate-200 bg-card text-slate-700">
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
                                <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm">
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
            <Card className="hidden sm:block overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Menu Name</TableHead>
                    <TableHead className="w-32">Link Type</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-24">Sub-Menus</TableHead>
                    {canManage && <TableHead className="w-16 text-center">Sort</TableHead>}
                    {canManage && <TableHead className="w-12"></TableHead>}
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
                            <LinkButton onClick={() => toggleExpand(menu.id)} aria-expanded={isExpanded}>
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {menu.menuName}
                            </LinkButton>
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
                              <Badge variant="outline" className="border-slate-200 bg-card text-slate-700">
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
                                  <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm">
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
            </Card>
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
                 
                  placeholder={dialogMode === "menu" ? "Enter menu name" : "Enter sub-menu name"}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* Link Type */}
              <div className="space-y-2">
                <Label className="text-slate-600 text-sm">Link Type *</Label>
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
                <Label className="text-slate-600 text-sm">Sort Order</Label>
                <Input
                 
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
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
               
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="disabled:text-slate-500"
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

