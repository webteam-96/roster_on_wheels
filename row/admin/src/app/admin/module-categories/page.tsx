"use client";

import { Card } from "@/components/ui/card";
import { useState, useCallback, useEffect, useRef } from "react";
import { ModuleCategory, CreateModuleCategoryRequest, UpdateModuleCategoryRequest } from "@/types/module";
import { getModuleCategories, createModuleCategory, updateModuleCategory, deleteModuleCategory } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import DeleteDialog from "@/components/DeleteDialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Pencil, Trash2, AlertCircle, FolderOpen } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function ModuleCategoriesPage() {
  const { isSuperAdmin } = useAuth();
  const [categories, setCategories] = useState<ModuleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  // The dialog is opened from plain buttons (no DialogTrigger), so Radix has no trigger to send focus back to on close.
  const openerRef = useRef<HTMLElement | null>(null);
  const [editingCategory, setEditingCategory] = useState<ModuleCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<ModuleCategory | null>(null);

  const [searchQuery, setSearchQuery] = useState("");

  // Alerts
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getModuleCategories();
      setCategories(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch categories";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const openAddDialog = () => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setEditingCategory(null);
    setCategoryName("");
    setSortOrder(categories.length > 0 ? Math.max(...categories.map(c => c.sortOrder)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (category: ModuleCategory) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setEditingCategory(category);
    setCategoryName(category.categoryName);
    setSortOrder(category.sortOrder);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!categoryName.trim()) {
      setErrorMessage("Category name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editingCategory) {
        const data: UpdateModuleCategoryRequest = {
          categoryName: categoryName.trim(),
          sortOrder,
          isActive: editingCategory.isActive,
        };
        await updateModuleCategory(editingCategory.id, data);
        setSuccessMessage("Category updated successfully.");
      } else {
        const data: CreateModuleCategoryRequest = {
          categoryName: categoryName.trim(),
          sortOrder,
        };
        await createModuleCategory(data);
        setSuccessMessage("Category created successfully.");
      }
      setDialogOpen(false);
      fetchCategories();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save category.";
      setErrorMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.categoryName;
    try {
      await deleteModuleCategory(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage(`${name} has been deleted successfully.`);
      fetchCategories();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete category.");
    }
  };

  const filteredCategories = categories.filter((cat) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      cat.categoryName.toLowerCase().includes(q) ||
      String(cat.sortOrder).includes(q) ||
      (cat.isActive ? "active" : "inactive").includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="row-h2">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage module categories.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="Module Categories"
          description="Manage module categories"
          back="/settings/module-master"
          actions={
            <>
<Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />Add Category
          </Button>
            </>
          }
        />

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="row-h2">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => fetchCategories()}>Try Again</Button>
          </div>
        )}

        {!loading && !error && categories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No categories found</h3>
            <p className="text-muted-foreground mt-2">Create your first module category.</p>
          </div>
        )}

        {!loading && !error && categories.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search categories..."
            />
            {filteredCategories.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Category Name</TableHead>
                  <TableHead className="w-28">Sort Order</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories.map((category, index) => (
                  <TableRow key={category.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-medium">{category.categoryName}</TableCell>
                    <TableCell>{category.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={category.isActive ? "default" : "secondary"}>
                        {category.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(category)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(category)} title="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
            )}
          </>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent onCloseAutoFocus={(e) => { if (openerRef.current?.isConnected) { e.preventDefault(); openerRef.current.focus(); } }}>
            <DialogHeader>
              <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
              <DialogDescription>
                {editingCategory ? "Update the category details below." : "Fill in the details to create a new category."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="categoryName">Category Name<span className="text-destructive ml-1">*</span></Label>
                <Input
                  id="categoryName"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder="e.g., Communication"
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Sort Order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                  min={0}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <RotaryLoader size="sm" />}
                {editingCategory ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DeleteDialog
          open={!!deleteTarget}
          memberName={deleteTarget ? deleteTarget.categoryName : ""}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
