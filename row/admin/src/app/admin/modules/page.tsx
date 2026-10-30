"use client";

import { useState, useCallback, useEffect } from "react";
import { Module, ModuleUsageCount, ModuleComingSoonInfo } from "@/types/module";
import { getModules, deleteModule, getModuleUsageCount, getModulesComingSoon, updateModuleComingSoon } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Pencil, Trash2, AlertCircle, ArrowLeft, Package, Download, Clock, Loader2 } from "@/components/icons";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function ModulesPage() {
  const { isSuperAdmin } = useAuth();
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Module | null>(null);
  const [usageCount, setUsageCount] = useState<ModuleUsageCount | null>(null);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Alerts
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Coming Soon state
  const [comingSoonMap, setComingSoonMap] = useState<Record<number, ModuleComingSoonInfo>>({});
  const [csTarget, setCsTarget] = useState<Module | null>(null);
  const [csIsComingSoon, setCsIsComingSoon] = useState(false);
  const [csDate, setCsDate] = useState<string>(""); // datetime-local value (YYYY-MM-DDTHH:mm)
  const [csSaving, setCsSaving] = useState(false);

  const fetchModules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mods, csList] = await Promise.all([getModules(), getModulesComingSoon()]);
      setModules(mods);
      const m: Record<number, ModuleComingSoonInfo> = {};
      csList.forEach((c) => { m[c.moduleId] = c; });
      setComingSoonMap(m);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch modules";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  const openCsDialog = (mod: Module) => {
    const cs = comingSoonMap[mod.id];
    setCsTarget(mod);
    setCsIsComingSoon(cs?.isComingSoon ?? false);
    if (cs?.comingSoonDate) {
      // Convert "2026-05-15T10:00:00" → "2026-05-15T10:00" for datetime-local input
      const d = new Date(cs.comingSoonDate);
      const pad = (n: number) => n.toString().padStart(2, "0");
      setCsDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setCsDate("");
    }
  };

  const closeCsDialog = () => {
    if (csSaving) return;
    setCsTarget(null);
    setCsIsComingSoon(false);
    setCsDate("");
  };

  const saveComingSoon = async () => {
    if (!csTarget) return;
    if (csIsComingSoon && !csDate) {
      setErrorMessage("Please pick the available date and time when Coming Soon is enabled.");
      return;
    }
    setCsSaving(true);
    try {
      await updateModuleComingSoon(csTarget.id, {
        isComingSoon: csIsComingSoon,
        comingSoonDate: csIsComingSoon ? new Date(csDate).toISOString() : null,
      });
      setSuccessMessage(`${csTarget.moduleName}: Coming Soon ${csIsComingSoon ? "enabled" : "disabled"}.`);
      closeCsDialog();
      await fetchModules();
    } catch {
      setErrorMessage("Failed to update Coming Soon.");
    } finally {
      setCsSaving(false);
    }
  };

  const formatCsDate = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const handleDeleteClick = async (mod: Module) => {
    setDeleteTarget(mod);
    setLoadingUsage(true);
    setUsageDialogOpen(true);
    try {
      const usage = await getModuleUsageCount(mod.id);
      setUsageCount(usage);
    } catch {
      setUsageCount(null);
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.moduleName;
    setUsageDialogOpen(false);
    try {
      await deleteModule(deleteTarget.id);
      setDeleteTarget(null);
      setUsageCount(null);
      setSuccessMessage(`${name} has been deleted successfully.`);
      fetchModules();
    } catch {
      setDeleteTarget(null);
      setUsageCount(null);
      setErrorMessage("Failed to delete module.");
    }
  };

  const handleDeleteCancel = () => {
    setUsageDialogOpen(false);
    setDeleteTarget(null);
    setUsageCount(null);
  };

  const filteredModules = modules.filter((mod) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      mod.moduleName.toLowerCase().includes(q) ||
      mod.moduleKey.toLowerCase().includes(q) ||
      (mod.categoryName || "").toLowerCase().includes(q) ||
      mod.moduleLevel.toLowerCase().includes(q) ||
      (mod.isActive ? "active" : "inactive").includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage modules.</p>
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
              <Link href="/settings/module-master"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Modules</h2>
              <p className="text-muted-foreground text-base">Manage system modules</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportToCSV(modules, "modules", [
              { key: "moduleName", label: "Module Name" }, { key: "moduleKey", label: "Key" },
              { key: "categoryName", label: "Category" }, { key: "moduleLevel", label: "Level" },
              { key: "sortOrder", label: "Sort Order" }, { key: "isActive", label: "Active" },
            ])}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            <Button asChild>
              <Link href="/admin/modules/new"><Plus className="mr-2 h-4 w-4" />Add Module</Link>
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => fetchModules()}>Try Again</Button>
          </div>
        )}

        {!loading && !error && modules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No modules found</h3>
            <p className="text-muted-foreground mt-2">Create your first module.</p>
          </div>
        )}

        {!loading && !error && modules.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search modules..."
            />
            {filteredModules.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Module Name</TableHead>
                  <TableHead>Module Key</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead className="w-28">Default Dist</TableHead>
                  <TableHead className="w-28">Default Club</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-56">Coming Soon</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModules.map((mod, index) => {
                  const cs = comingSoonMap[mod.id];
                  return (
                  <TableRow key={mod.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-medium">{mod.moduleName}</TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{mod.moduleKey}</TableCell>
                    <TableCell>{mod.categoryName || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{mod.moduleLevel}</Badge>
                    </TableCell>
                    <TableCell>
                      {mod.isDefaultForDistrict ? (
                        <Badge variant="default">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {mod.isDefaultForClub ? (
                        <Badge variant="default">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={mod.isActive ? "default" : "secondary"}>
                        {mod.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {cs?.isComingSoon ? (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">
                            {formatCsDate(cs.comingSoonDate) || "Coming Soon"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">, </span>
                        )}
                        <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => openCsDialog(mod)} title="Edit Coming Soon">
                          <Clock className="h-3 w-3 mr-1" />Edit
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" asChild title="Edit">
                          <Link href={`/admin/modules/edit/${mod.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(mod)} title="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
            )}
          </>
        )}

        {/* Usage Count + Delete Confirmation Dialog */}
        <Dialog open={usageDialogOpen} onOpenChange={(open) => { if (!open) handleDeleteCancel(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Module</DialogTitle>
              <DialogDescription>
                {deleteTarget ? `Are you sure you want to delete "${deleteTarget.moduleName}"?` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {loadingUsage ? (
                <div className="flex items-center justify-center py-4">
                  <RotaryLoader size="md" />
                </div>
              ) : usageCount ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">This module is currently assigned to:</p>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    <li><span className="font-semibold">{usageCount.districtCount}</span> district(s)</li>
                    <li><span className="font-semibold">{usageCount.clubCount}</span> club(s)</li>
                  </ul>
                  {(usageCount.districtCount > 0 || usageCount.clubCount > 0) && (
                    <p className="text-sm text-destructive mt-2">
                      Deleting this module will remove it from all assigned districts and clubs.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleDeleteCancel}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteConfirm} disabled={loadingUsage}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Coming Soon edit dialog */}
        <Dialog open={!!csTarget} onOpenChange={(o) => { if (!o) closeCsDialog(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Coming Soon: {csTarget?.moduleName}</DialogTitle>
              <DialogDescription>
                When enabled, non-SuperAdmin users will see this module&apos;s card greyed out with the date below; SuperAdmin sees the module as normal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between rounded border p-3">
                <div>
                  <Label className="font-semibold">Coming Soon enabled</Label>
                  <p className="text-xs text-muted-foreground">If OFF, this module is fully accessible to all roles.</p>
                </div>
                <Switch checked={csIsComingSoon} onCheckedChange={setCsIsComingSoon} />
              </div>
              <div>
                <Label>Available on (date &amp; time) {csIsComingSoon && <span className="text-destructive">*</span>}</Label>
                <Input
                  type="datetime-local"
                  value={csDate}
                  onChange={(e) => setCsDate(e.target.value)}
                  disabled={!csIsComingSoon}
                />
                <p className="text-xs text-muted-foreground mt-1">Shown on the dashboard card alongside &quot;Coming Soon&quot;.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeCsDialog} disabled={csSaving}>Cancel</Button>
              <Button onClick={saveComingSoon} disabled={csSaving}>
                {csSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {csSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
