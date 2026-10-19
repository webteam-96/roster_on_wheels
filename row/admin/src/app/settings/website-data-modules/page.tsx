"use client";

import { useState, useCallback, useEffect } from "react";
import { WebsiteDataModule } from "@/types/websiteDataModule";
import {
  getWebsiteDataModules,
  createWebsiteDataModule,
  updateWebsiteDataModule,
  deleteWebsiteDataModule,
  reorderWebsiteDataModules,
} from "@/services/api";
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
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Globe, AlertTriangle, ChevronUp, ChevronDown } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function WebsiteDataModulesPage() {
  const { isSuperAdmin } = useAuth();

  const [modules, setModules] = useState<WebsiteDataModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<WebsiteDataModule | null>(null);
  const [modName, setModName] = useState("");
  const [modKey, setModKey] = useState("");
  const [modIcon, setModIcon] = useState("Globe");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<WebsiteDataModule | null>(null);

  const fetchModules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWebsiteDataModules();
      setModules(data);
    } catch (err: unknown) {
      console.error("Website data modules fetch error:", err);
      setErrorMessage("Failed to load website data modules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchModules(); }, [fetchModules]);

  const openAddDialog = () => {
    setEditingModule(null);
    setModName("");
    setModKey("");
    setModIcon("Globe");
    setDialogOpen(true);
  };

  const openEditDialog = (mod: WebsiteDataModule) => {
    setEditingModule(mod);
    setModName(mod.moduleName);
    setModKey(mod.moduleKey);
    setModIcon(mod.iconClass);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!modName.trim() || !modKey.trim()) { setErrorMessage("Please fill in Module Name and Module Key."); return; }
    setSaving(true);
    try {
      if (editingModule) {
        await updateWebsiteDataModule(editingModule.id, { moduleName: modName.trim(), moduleKey: modKey.trim(), iconClass: modIcon.trim() || "Globe" });
        setSuccessMessage("Module updated successfully.");
      } else {
        await createWebsiteDataModule({ moduleName: modName.trim(), moduleKey: modKey.trim(), iconClass: modIcon.trim() || "Globe" });
        setSuccessMessage("Module added successfully.");
      }
      setDialogOpen(false);
      fetchModules();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save module.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteWebsiteDataModule(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Module deleted.");
      fetchModules();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete module.");
    }
  };

  const handleReorder = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= modules.length) return;
    setReordering(true);
    try {
      await reorderWebsiteDataModules(modules[index].id, modules[targetIndex].id);
      await fetchModules();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to reorder.");
    } finally {
      setReordering(false);
    }
  };

  const filteredModules = modules.filter((mod) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      mod.moduleName.toLowerCase().includes(q) ||
      mod.moduleKey.toLowerCase().includes(q) ||
      mod.iconClass.toLowerCase().includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage website data modules.</p>
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
              <h2 className="text-2xl font-bold tracking-tight text-primary">Website Data Modules</h2>
              <p className="text-muted-foreground text-base">Manage website sub-module master list</p>
            </div>
          </div>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />Add Module
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && modules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No website data modules found</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Module&quot; to create your first one.</p>
          </div>
        )}

        {!loading && modules.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search website data modules..."
            />
            {filteredModules.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-2">
              {filteredModules.map((mod, i) => (
                <div key={mod.id} className="flex items-center gap-2 border rounded-md p-3">
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      disabled={i === 0 || reordering}
                      onClick={() => handleReorder(i, "up")}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      disabled={i === modules.length - 1 || reordering}
                      onClick={() => handleReorder(i, "down")}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{mod.moduleName}</p>
                    <p className="text-xs text-muted-foreground">{mod.moduleKey}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(mod)}>
                        <Pencil className="mr-2 h-4 w-4" />Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(mod)}>
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
                    <TableHead className="text-primary-foreground text-base font-semibold">Module Name</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Key</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Icon</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold text-center">Order</TableHead>
                    <TableHead className="w-12 text-primary-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredModules.map((mod, i) => (
                    <TableRow key={mod.id} className="hover:bg-primary/5 transition-colors">
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{mod.moduleName}</TableCell>
                      <TableCell className="text-muted-foreground">{mod.moduleKey}</TableCell>
                      <TableCell className="text-muted-foreground">{mod.iconClass}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            disabled={i === 0 || reordering}
                            onClick={() => handleReorder(i, "up")}
                            title="Move up"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            disabled={i === modules.length - 1 || reordering}
                            onClick={() => handleReorder(i, "down")}
                            title="Move down"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(mod)}>
                              <Pencil className="mr-2 h-4 w-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(mod)}>
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
            )}
          </>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingModule ? "Edit Module" : "Add Module"}</DialogTitle>
              <DialogDescription>
                {editingModule ? "Update the website data module details." : "Enter the new website data module details."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Module Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={modName} onChange={(e) => setModName(e.target.value)} placeholder="e.g. Banners" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Module Key<span className="text-destructive ml-1">*</span></Label>
                <Input value={modKey} onChange={(e) => setModKey(e.target.value)} placeholder="e.g. banners" />
              </div>
              <div className="space-y-2">
                <Label>Icon Class</Label>
                <Input value={modIcon} onChange={(e) => setModIcon(e.target.value)} placeholder="e.g. Globe" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !modName.trim() || !modKey.trim()}>
                {saving ? "Saving..." : editingModule ? "Update" : "Add"}
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
          title="Delete Module"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.moduleName}</span>?</>}
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
