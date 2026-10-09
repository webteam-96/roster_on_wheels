"use client";

import { useState, useCallback, useEffect } from "react";
import { Designation } from "@/types/boardDirector";
import {
  getDesignations,
  createDesignation,
  updateDesignation,
  deleteDesignation,
  reorderDesignationsAll,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Settings, AlertTriangle, GripVertical, Download } from "lucide-react";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function DesignationsPage() {
  const { isSuperAdmin } = useAuth();

  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDesignation, setEditingDesignation] = useState<Designation | null>(null);
  const [desName, setDesName] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Designation | null>(null);

  const fetchDesignations = useCallback(async () => {
    setLoading(true);
    try {
      const des = await getDesignations();
      setDesignations(des);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load designations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDesignations(); }, [fetchDesignations]);

  const openAddDialog = () => {
    setEditingDesignation(null);
    setDesName("");
    setDialogOpen(true);
  };

  const openEditDialog = (des: Designation) => {
    setEditingDesignation(des);
    setDesName(des.designationName);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!desName.trim()) { setErrorMessage("Please enter a designation name."); return; }
    setSaving(true);
    try {
      if (editingDesignation) {
        await updateDesignation(editingDesignation.id, { designationName: desName.trim(), sortOrder: editingDesignation.sortOrder });
        setSuccessMessage("Designation updated successfully.");
      } else {
        const maxSort = designations.length > 0 ? Math.max(...designations.map(d => d.sortOrder)) : 0;
        await createDesignation({ designationName: desName.trim(), sortOrder: maxSort + 1 });
        setSuccessMessage("Designation added successfully.");
      }
      setDialogOpen(false);
      fetchDesignations();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save designation.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDesignation(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Designation deleted.");
      fetchDesignations();
    } catch (err: any) {
      setDeleteTarget(null);
      setErrorMessage(err?.response?.data?.message || "Failed to delete designation.");
    }
  };

  // Drag-and-drop sort (same pattern as District Committee). Disabled while searching
  // (a filtered subset would reorder incorrectly).
  const { dragProps } = useDragSort(designations, setDesignations, async (ids) => {
    try {
      await reorderDesignationsAll(ids);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to reorder.");
      fetchDesignations();
    }
  });

  const filteredDesignations = designations.filter((des) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return des.designationName.toLowerCase().includes(q);
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage designations.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Designations</h2>
              <p className="text-muted-foreground text-base">Manage board of directors designations</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => exportToCSV(
              designations.map((d, i) => ({ ...d, srNo: i + 1 })),
              "designations",
              [
                { key: "srNo", label: "Sr No" },
                { key: "designationName", label: "Designation Name" },
              ]
            )}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            <Button onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />Add Designation
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && designations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Settings className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No designations found</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Designation&quot; to create your first one.</p>
          </div>
        )}

        {!loading && designations.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search designations..."
            />
            {filteredDesignations.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-2">
              {filteredDesignations.map((des, i) => (
                <div key={des.id} className="flex items-center gap-2 border rounded-md p-3">
                  <span
                    {...(!searchQuery.trim() ? dragProps(i) : {})}
                    className="flex items-center text-muted-foreground"
                    title={searchQuery.trim() ? "Clear search to reorder" : "Drag to reorder"}
                  >
                    <GripVertical className={`h-5 w-5 ${searchQuery.trim() ? "opacity-40" : "cursor-grab"}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{des.designationName}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(des)}>
                        <Pencil className="mr-2 h-4 w-4" />Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(des)}>
                        <Trash2 className="mr-2 h-4 w-4" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12 text-primary-foreground">#</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Designation Name</TableHead>
                    <TableHead className="w-32 text-primary-foreground text-base font-semibold text-center">BOD Members</TableHead>
                    <TableHead className="w-20 text-primary-foreground text-base font-semibold text-center">Sorting</TableHead>
                    <TableHead className="w-12 text-primary-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDesignations.map((des, i) => {
                    const bodCount = des.bodCount ?? 0;
                    const inUse = bodCount > 0;
                    return (
                      <TableRow key={des.id} className="hover:bg-primary/5 transition-colors">
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{des.designationName}</TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${inUse ? "bg-blue-100 text-blue-800" : "bg-muted text-muted-foreground"}`}>
                            {bodCount}
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-center"
                          {...(!searchQuery.trim() ? dragProps(i) : {})}
                          title={searchQuery.trim() ? "Clear search to reorder" : "Drag to reorder"}
                        >
                          <GripVertical className={`h-4 w-4 inline-block ${searchQuery.trim() ? "text-muted-foreground/40" : "text-muted-foreground cursor-grab"}`} />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(des)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                disabled={inUse}
                                onClick={() => { if (!inUse) setDeleteTarget(des); }}
                                title={inUse ? `Cannot delete — ${bodCount} BOD member${bodCount === 1 ? "" : "s"} assigned` : undefined}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
            )}
          </>
        )}

        {/* Add/Edit Dialog — only designation name, no sort order */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingDesignation ? "Edit Designation" : "Add Designation"}</DialogTitle>
              <DialogDescription>
                {editingDesignation ? "Update the designation name." : "Enter the new designation name."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Designation Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={desName} onChange={(e) => setDesName(e.target.value)} placeholder="e.g. Club President" autoFocus />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !desName.trim()}>
                {saving ? "Saving..." : editingDesignation ? "Update" : "Add"}
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
          title="Delete Designation"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.designationName}</span>?</>}
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
