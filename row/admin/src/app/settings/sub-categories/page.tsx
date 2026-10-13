"use client";

import { useState, useCallback, useEffect } from "react";
import { AreaOfFocus, Category, SubCategory } from "@/types/project";
import {
  getAreasOfFocus,
  getCategories,
  getSubCategories,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
  reorderSubCategories,
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
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, GitBranch, AlertTriangle, Download, GripVertical } from "lucide-react";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function SubCategoriesPage() {
  const { isSuperAdmin } = useAuth();

  const [areasOfFocus, setAreasOfFocus] = useState<AreaOfFocus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedAofId, setSelectedAofId] = useState<number | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [items, setItems] = useState<SubCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SubCategory | null>(null);
  const [formName, setFormName] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SubCategory | null>(null);

  const { dragProps } = useDragSort(items, setItems, async (ids) => {
    if (!selectedCatId) return;
    try { await reorderSubCategories(selectedCatId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchItems(); }
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

  useEffect(() => {
    if (!selectedAofId) { setCategories([]); setSelectedCatId(null); return; }
    async function fetchCats() {
      try {
        const cats = await getCategories(selectedAofId!);
        setCategories(cats.filter(c => c.isActive));
        setSelectedCatId(cats.length > 0 ? cats[0].id : null);
      } catch {
        setCategories([]);
      }
    }
    fetchCats();
  }, [selectedAofId]);

  const fetchItems = useCallback(async () => {
    if (!selectedCatId) { setItems([]); return; }
    setLoadingItems(true);
    try {
      setItems(await getSubCategories(selectedCatId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load sub-categories.");
    } finally {
      setLoadingItems(false);
    }
  }, [selectedCatId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const openAddDialog = () => {
    setEditingItem(null);
    setFormName("");
    setDialogOpen(true);
  };

  const openEditDialog = (item: SubCategory) => {
    setEditingItem(item);
    setFormName(item.name);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !selectedCatId) { setErrorMessage("Please enter a name."); return; }
    setSaving(true);
    try {
      if (editingItem) {
        await updateSubCategory(editingItem.id, { categoryId: selectedCatId, name: formName.trim(), sortOrder: editingItem.sortOrder, isActive: editingItem.isActive });
        setSuccessMessage("Sub-category updated.");
      } else {
        const nextSort = items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 1 : 1;
        await createSubCategory({ categoryId: selectedCatId, name: formName.trim(), sortOrder: nextSort, isActive: true });
        setSuccessMessage("Sub-category added.");
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
      await deleteSubCategory(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Sub-category deleted.");
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

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage sub-categories.</p>
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
              <h2 className="text-2xl font-bold tracking-tight text-primary">Sub Categories</h2>
              <p className="text-muted-foreground text-base">Manage project sub-categories by category</p>
            </div>
          </div>
          <div className="flex gap-2">
            {items.length > 0 && (
              <Button variant="outline" onClick={() => exportToCSV(items, "sub_categories", [
                { key: "name", label: "Sub Category Name" }, { key: "isActive", label: "Active" },
              ])}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            )}
            {selectedCatId && (
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />Add Sub Category
              </Button>
            )}
          </div>
        </div>

        {/* Cascading selectors */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 max-w-sm">
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
          <div className="flex-1 max-w-sm">
            <Label className="mb-2 block">Category</Label>
            <Select
              value={selectedCatId ? String(selectedCatId) : ""}
              onValueChange={(v) => setSelectedCatId(Number(v))}
              disabled={categories.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={categories.length === 0 ? "No categories" : "Select category"} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {(loading || loadingItems) && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && !loadingItems && items.length === 0 && selectedCatId && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No sub-categories</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Sub Category&quot; to create one.</p>
          </div>
        )}

        {!loading && !loadingItems && items.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search sub-categories..."
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
              <DialogTitle>{editingItem ? "Edit Sub Category" : "Add Sub Category"}</DialogTitle>
              <DialogDescription>
                {editingItem ? "Update the sub-category." : "Enter the new sub-category."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Eye Surgery" autoFocus />
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
          title="Delete Sub Category"
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
