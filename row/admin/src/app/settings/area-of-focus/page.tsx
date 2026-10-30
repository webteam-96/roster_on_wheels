"use client";

import { useState, useCallback, useEffect } from "react";
import { AreaOfFocus } from "@/types/project";
import { Module } from "@/types/module";
import {
  getAreasOfFocus,
  createAreaOfFocus,
  updateAreaOfFocus,
  deleteAreaOfFocus,
  getModules,
  reorderAreasOfFocus,
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Target, AlertTriangle, Download, GripVertical } from "@/components/icons";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

// Only these modules have Area of Focus (not club_service)
const SERVICE_MODULE_KEYS = [
  "community_service",
  "vocational_service",
  "international_service",
  "new_generation_service",
  "public_image_initiative",
];

export default function AreaOfFocusPage() {
  const { isSuperAdmin } = useAuth();

  const [modules, setModules] = useState<Module[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [items, setItems] = useState<AreaOfFocus[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AreaOfFocus | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AreaOfFocus | null>(null);

  const { dragProps } = useDragSort(items, setItems, async (ids) => {
    if (!selectedModuleId) return;
    try { await reorderAreasOfFocus(selectedModuleId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchItems(); }
  });

  // Load modules on init
  useEffect(() => {
    async function init() {
      try {
        const allModules = await getModules();
        const serviceModules = allModules.filter(m => SERVICE_MODULE_KEYS.includes(m.moduleKey));
        setModules(serviceModules);
        if (serviceModules.length > 0) {
          setSelectedModuleId(serviceModules[0].id);
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load modules.");
        setLoading(false);
      }
    }
    init();
  }, []);

  const fetchItems = useCallback(async () => {
    if (!selectedModuleId) return;
    setLoading(true);
    try {
      setItems(await getAreasOfFocus(selectedModuleId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load areas of focus.");
    } finally {
      setLoading(false);
    }
  }, [selectedModuleId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const openAddDialog = () => {
    if (!selectedModuleId) { setErrorMessage("Please select a module first."); return; }
    setEditingItem(null);
    setFormName("");
    setDialogOpen(true);
  };

  const openEditDialog = (item: AreaOfFocus) => {
    setEditingItem(item);
    setFormName(item.name);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setErrorMessage("Please enter a name."); return; }
    if (!selectedModuleId) { setErrorMessage("Please select a module."); return; }
    setSaving(true);
    try {
      if (editingItem) {
        await updateAreaOfFocus(editingItem.id, { moduleId: selectedModuleId, name: formName.trim(), sortOrder: editingItem.sortOrder, isActive: editingItem.isActive });
        setSuccessMessage("Area of focus updated.");
      } else {
        const nextSort = items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 1 : 1;
        await createAreaOfFocus({ moduleId: selectedModuleId, name: formName.trim(), sortOrder: nextSort, isActive: true });
        setSuccessMessage("Area of focus added.");
      }
      setDialogOpen(false);
      fetchItems();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAreaOfFocus(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Area of focus deleted.");
      fetchItems();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  const filteredItems = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      (item.isActive ? "active" : "inactive").includes(q)
    );
  });
  const isSearching = searchQuery.trim() !== "";

  const selectedModuleName = modules.find(m => m.id === selectedModuleId)?.moduleName || "";

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage areas of focus.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings/project-categorization"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Area of Focus</h2>
              <p className="text-muted-foreground text-base">Manage areas of focus by service module</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportToCSV(items, "area_of_focus", [
              { key: "name", label: "Name" }, { key: "moduleName", label: "Module" },
              { key: "isActive", label: "Active" },
            ])} disabled={items.length === 0}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            <Button onClick={openAddDialog} disabled={!selectedModuleId}>
              <Plus className="mr-2 h-4 w-4" />Add Area of Focus
            </Button>
          </div>
        </div>

        {/* Module selector */}
        <div className="w-full sm:w-72">
          <Label className="text-sm font-medium mb-1.5 block">Service Module</Label>
          <Select
            value={selectedModuleId ? String(selectedModuleId) : ""}
            onValueChange={(v) => setSelectedModuleId(Number(v))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select module" />
            </SelectTrigger>
            <SelectContent>
              {modules.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>{m.moduleName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No areas of focus</h3>
            <p className="text-muted-foreground mt-2">
              {selectedModuleName ? `No areas of focus for ${selectedModuleName}. Click "Add Area of Focus" to create one.` : 'Select a module to get started.'}
            </p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search areas of focus..."
            />
            {filteredItems.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="text-base font-semibold">Name</TableHead>
                  <TableHead className="w-20 text-base font-semibold text-center">Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="w-20 text-base font-semibold text-center">Sorting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item, i) => (
                  <TableRow key={item.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={item.isActive ? "default" : "secondary"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(item)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(item)}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                    <TableCell className="w-20">
                      {!isSearching ? (
                        <div {...dragProps(i)} className="flex items-center justify-center text-muted-foreground" title="Drag to reorder">
                          <GripVertical className="h-4 w-4 cursor-grab" />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
            )}
          </>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit Area of Focus" : "Add Area of Focus"}</DialogTitle>
              <DialogDescription>
                {editingItem ? `Update area of focus for ${selectedModuleName}.` : `Add new area of focus for ${selectedModuleName}.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Disease Prevention" autoFocus />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formName.trim()}>
                {saving ? "Saving..." : editingItem ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Area of Focus"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?</>}
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
