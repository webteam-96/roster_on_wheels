"use client";

import { Card } from "@/components/ui/card";
import { useState, useCallback, useEffect } from "react";
import { Funding } from "@/types/project";
import {
  getFunding,
  createFunding,
  updateFunding,
  deleteFunding,
} from "@/services/api";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, Pencil, Trash2, MoreHorizontal, Wallet, AlertTriangle, Download } from "@/components/icons";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function FundingPage() {
  const { isSuperAdmin } = useAuth();

  const [items, setItems] = useState<Funding[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Funding | null>(null);
  const [formName, setFormName] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Funding | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getFunding());
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load funding sources.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const openAddDialog = () => {
    setEditingItem(null);
    setFormName("");
    setFormSortOrder(items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 1 : 1);
    setDialogOpen(true);
  };

  const openEditDialog = (item: Funding) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormSortOrder(item.sortOrder);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setErrorMessage("Please enter a name."); return; }
    setSaving(true);
    try {
      if (editingItem) {
        await updateFunding(editingItem.id, { name: formName.trim(), sortOrder: formSortOrder, isActive: editingItem.isActive });
        setSuccessMessage("Funding source updated.");
      } else {
        await createFunding({ name: formName.trim(), sortOrder: formSortOrder, isActive: true });
        setSuccessMessage("Funding source added.");
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
      await deleteFunding(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Funding source deleted.");
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
      String(item.sortOrder).includes(q) ||
      (item.isActive ? "active" : "inactive").includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="row-h2">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage funding sources.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="Funding"
          description="Manage project funding sources"
          back="/settings"
          actions={
            <>
<Button variant="outline" onClick={() => exportToCSV(items, "funding", [
              { key: "name", label: "Funding Name" }, { key: "sortOrder", label: "Sort Order", numeric: true }, { key: "isActive", label: "Active" },
            ])} disabled={items.length === 0}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            <Button onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />Add Funding
            </Button>
            </>
          }
        />

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No funding sources</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Funding&quot; to create one.</p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search funding sources..."
            />
            {filteredItems.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-20 text-center">Order</TableHead>
                  <TableHead className="w-20 text-center">Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item, i) => (
                  <TableRow key={item.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-center">{item.sortOrder}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={item.isActive ? "default" : "secondary"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm"><MoreHorizontal className="h-4 w-4" /></Button>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
            )}
          </>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit Funding" : "Add Funding"}</DialogTitle>
              <DialogDescription>
                {editingItem ? "Update the funding source." : "Enter the new funding source."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Club Funds" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input type="number" value={formSortOrder} onChange={(e) => setFormSortOrder(Number(e.target.value))} />
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
          title="Delete Funding"
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
