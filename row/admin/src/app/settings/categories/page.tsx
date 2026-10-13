"use client";

import { useState, useCallback, useEffect } from "react";
import { AreaOfFocus, Category } from "@/types/project";
import {
  getAreasOfFocus,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Layers, AlertTriangle, Download, GripVertical } from "lucide-react";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function CategoriesPage() {
  const { isSuperAdmin } = useAuth();

  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [selectedAofId, setSelectedAofId] = useState<number | null>(null);
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Category | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const { dragProps } = useDragSort(items, setItems, async (ids) => {
    if (!selectedAofId) return;
    try { await reorderCategories(selectedAofId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchCategories(); }
  });

  useEffect(() => {
    async function fetchAof() {
      try {
        const aof = await getAreasOfFocus();
        setAreasOfFocus(aof.filter(a => a.isActive));
        if (aof.length > 0) setSelectedAofId(aof[0].id);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load areas of focus.");
      } finally {
        setLoading(false);
      }
    }
    fetchAof();
  }, []);

  const fetchCategories = useCallback(async () => {
    if (!selectedAofId) { setItems([]); return; }
    setLoadingCategories(true);
    try {
      setItems(await getCategories(selectedAofId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load categories.");
    } finally {
      setLoadingCategories(false);
    }
  }, [selectedAofId]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const openAddDialog = () => {
    setEditingItem(null);
    setFormName("");
    setDialogOpen(true);
  };

  const openEditDialog = (item: Category) => {
    setEditingItem(item);
    setFormName(item.name);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !selectedAofId) { setErrorMessage("Please enter a name."); return; }
    setSaving(true);
    try {
      if (editingItem) {
        await updateCategory(editingItem.id, { areaOfFocusId: selectedAofId, name: formName.trim(), sortOrder: editingItem.sortOrder, isActive: editingItem.isActive });
        setSuccessMessage("Category updated.");
      } else {
        const nextSort = items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 1 : 1;
        await createCategory({ areaOfFocusId: selectedAofId, name: formName.trim(), sortOrder: nextSort, isActive: true });
        setSuccessMessage("Category added.");
      }
      setDialogOpen(false);
      fetchCategories();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCategory(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Category deleted.");
      fetchCategories();
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

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage categories.</p>
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
              <h2 className="text-2xl font-bold tracking-tight text-primary">Categories</h2>
              <p className="text-muted-foreground text-base">Manage project categories by area of focus</p>
            </div>
          </div>
          <div className="flex gap-2">
            {items.length > 0 && (
              <Button variant="outline" onClick={() => exportToCSV(items, "categories", [
                { key: "name", label: "Category Name" }, { key: "isActive", label: "Active" },
              ])}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            )}
            {selectedAofId && (
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />Add Category
              </Button>
            )}
          </div>
        </div>

        {/* Area of Focus selector */}
        <div className="max-w-sm">
          <Label className="mb-2 block">Area of Focus</Label>
          <Select
            value={selectedAofId ? String(selectedAofId) : ""}
            onValueChange={(v) => setSelectedAofId(Number(v))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select area of focus" />
            </SelectTrigger>
            <SelectContent>
              {areasOfFocus.map((aof) => (
                <SelectItem key={aof.id} value={String(aof.id)}>{aof.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(loading || loadingCategories) && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && !loadingCategories && items.length === 0 && selectedAofId && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Layers className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No categories</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Category&quot; to create one.</p>
          </div>
        )}

        {!loading && !loadingCategories && items.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search categories..."
            />
            {filteredItems.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Name</TableHead>
                  <TableHead className="w-20 text-primary-foreground text-base font-semibold text-center">Status</TableHead>
                  <TableHead className="w-12 text-primary-foreground"></TableHead>
                  <TableHead className="w-20 text-primary-foreground text-base font-semibold text-center">Sorting</TableHead>
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
              <DialogTitle>{editingItem ? "Edit Category" : "Add Category"}</DialogTitle>
              <DialogDescription>
                {editingItem ? "Update the category." : "Enter the new category."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Health Camps" autoFocus />
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
          title="Delete Category"
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
