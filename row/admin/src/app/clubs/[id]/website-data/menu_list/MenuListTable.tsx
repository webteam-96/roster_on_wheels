import { Fragment } from "react";
import { isHomeMenu } from "@/types/menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pencil, Trash2, MoreHorizontal, Eye, EyeOff, ChevronDown, ChevronRight, GripVertical, PlusCircle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import SearchBox from "@/components/SearchBox";
import { LinkButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";
import { LinkTypeBadgeWithView } from "./menuListShared";
import type { MenuListCtx } from "./useMenuList";

export default function MenuListTable({ v }: { v: MenuListCtx }) {
  const { loading, menus, searchQuery, setSearchQuery, filteredMenus, expandedMenuIds, subMenusMap, loadingSubMenus, canManage, isSearching, menuDragProps, toggleExpand, openEditMenuDialog, openAddSubMenuDialog, handleToggleMenuActive, setDeleteTarget, renderSubMenuCard, renderSubMenuRow } = v;
  return (
    <>
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
                    <Card {...dragHandlers}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <IconButton onClick={() => toggleExpand(menu.id)} type="button" aria-label={isExpanded ? "Collapse" : "Expand"}>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </IconButton>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{menu.menuName}</p>
                            <div className="flex gap-1 mt-1 flex-wrap items-center">
                              <LinkTypeBadgeWithView linkType={menu.linkType} linkValue={menu.linkValue} className="text-xs" />
                              <Badge variant={menu.isActive ? "default" : "secondary"} className="text-xs">
                                {menu.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {menu.isDefault && (
                                <Badge variant="outline">Default</Badge>
                              )}
                              {menu.subMenuCount > 0 && (
                                <Badge variant="outline">
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
                                <Button variant="ghost" size="icon" className="row-btn-sm" aria-label="More actions">
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
                        {!isLoadingSubs && subs.filter(s => (s.subMenuName ?? "").trim() !== "").map((sub, si, arr) => renderSubMenuCard(sub, si, arr.length))}
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
                        <TableRow className="hover:bg-primary/5 transition-colors" {...dragHandlers}>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <LinkButton onClick={() => toggleExpand(menu.id)}>
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {menu.menuName}
                              </LinkButton>
                              {menu.isDefault && (
                                <Badge variant="outline">Default</Badge>
                              )}
                            </div>
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
                                  <Button variant="ghost" size="icon" className="row-btn-sm" aria-label="More actions">
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
                        {isExpanded && !isLoadingSubs && subs.filter(s => (s.subMenuName ?? "").trim() !== "").map((sub, si, arr) => renderSubMenuRow(sub, si, arr.length))}
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
    </>
  );
}
