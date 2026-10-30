"use client";

import { useState, useEffect, useCallback } from "react";
import { AvailableModule } from "@/types/module";
import { DistrictListItem } from "@/types/district";
import { getDistricts, getDistrictAvailableModules, assignDistrictModules, unassignDistrictModules } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, AlertCircle, Save } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

interface CategoryGroup {
  categoryId: number;
  categoryName: string;
  categorySortOrder: number;
  modules: AvailableModule[];
}

export default function DistrictModulesPage() {
  const { isSuperAdmin } = useAuth();
  const [districts, setDistricts] = useState<DistrictListItem[]>([]);
  const [loadingDistricts, setLoadingDistricts] = useState(true);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>("");
  const [modules, setModules] = useState<AvailableModule[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Track initial assignment state for comparison
  const [initialAssigned, setInitialAssigned] = useState<Set<number>>(new Set());
  const [currentAssigned, setCurrentAssigned] = useState<Set<number>>(new Set());

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDistricts() {
      try {
        const result = await getDistricts(1, 200);
        setDistricts([...result.items].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load districts.");
      } finally {
        setLoadingDistricts(false);
      }
    }
    fetchDistricts();
  }, []);

  const fetchModules = useCallback(async (districtId: number) => {
    setLoadingModules(true);
    setError(null);
    try {
      const result = await getDistrictAvailableModules(districtId);
      setModules(result);
      const assignedIds = result.filter(m => m.isAssigned).map(m => m.moduleId);
      setInitialAssigned(new Set(assignedIds));
      setCurrentAssigned(new Set(assignedIds));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch modules";
      setError(message);
    } finally {
      setLoadingModules(false);
    }
  }, []);

  const handleDistrictChange = (value: string) => {
    setSelectedDistrictId(value);
    if (value) {
      fetchModules(parseInt(value));
    } else {
      setModules([]);
      setInitialAssigned(new Set());
      setCurrentAssigned(new Set());
    }
  };

  const toggleModule = (moduleId: number) => {
    setCurrentAssigned(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedDistrictId) return;
    const districtId = parseInt(selectedDistrictId);

    // Determine newly assigned and unassigned
    const toAssign = Array.from(currentAssigned).filter(id => !initialAssigned.has(id));
    const toUnassign = Array.from(initialAssigned).filter(id => !currentAssigned.has(id));

    if (toAssign.length === 0 && toUnassign.length === 0) {
      setSuccessMessage("No changes to save.");
      return;
    }

    setSaving(true);
    try {
      if (toAssign.length > 0) {
        await assignDistrictModules(districtId, toAssign);
      }
      if (toUnassign.length > 0) {
        await unassignDistrictModules(districtId, toUnassign);
      }
      setSuccessMessage("Module assignments updated successfully.");
      // Refresh
      fetchModules(districtId);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update module assignments.");
    } finally {
      setSaving(false);
    }
  };

  // Group modules by category
  const groupedModules: CategoryGroup[] = [];
  const categoryMap = new Map<number, CategoryGroup>();
  for (const mod of modules) {
    const catId = mod.categoryId;
    if (!categoryMap.has(catId)) {
      const group: CategoryGroup = {
        categoryId: catId,
        categoryName: mod.categoryName,
        categorySortOrder: mod.categorySortOrder,
        modules: [],
      };
      categoryMap.set(catId, group);
      groupedModules.push(group);
    }
    categoryMap.get(catId)!.modules.push(mod);
  }
  groupedModules.sort((a, b) => a.categorySortOrder - b.categorySortOrder);
  for (const group of groupedModules) {
    group.modules.sort((a, b) => a.moduleSortOrder - b.moduleSortOrder);
  }

  const hasChanges = (() => {
    if (currentAssigned.size !== initialAssigned.size) return true;
    const currentArr = Array.from(currentAssigned);
    for (let i = 0; i < currentArr.length; i++) {
      if (!initialAssigned.has(currentArr[i])) return true;
    }
    return false;
  })();

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage district modules.</p>
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
              <h2 className="text-2xl font-bold tracking-tight text-primary">District Module Assignment</h2>
              <p className="text-muted-foreground text-base">Assign modules to districts</p>
            </div>
          </div>
          {selectedDistrictId && modules.length > 0 && (
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? <RotaryLoader size="sm" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>Search District</CardTitle></CardHeader>
          <CardContent>
            <div className="max-w-md">
              {loadingDistricts ? (
                <div className="flex items-center justify-center py-4">
                  <RotaryLoader size="md" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Select value={selectedDistrictId} onValueChange={handleDistrictChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a district" />
                    </SelectTrigger>
                    <SelectContent>
                      {districts.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.districtNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {loadingModules && (
          <div className="flex items-center justify-center py-12">
            <ListPageSkeleton />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
          </div>
        )}

        {!loadingModules && !error && selectedDistrictId && groupedModules.length > 0 && (
          <div className="space-y-4">
            {groupedModules.map((group) => (
              <Card key={group.categoryId}>
                <CardHeader>
                  <CardTitle className="text-lg">{group.categoryName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.modules.map((mod) => (
                      <label
                        key={mod.moduleId}
                        className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={currentAssigned.has(mod.moduleId)}
                          onChange={() => toggleModule(mod.moduleId)}
                          className="h-4 w-4"
                        />
                        <div>
                          <p className="text-sm font-medium">{mod.moduleName}</p>
                          <p className="text-xs text-muted-foreground">{mod.moduleKey}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loadingModules && !error && selectedDistrictId && modules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No modules available for this district.</p>
          </div>
        )}

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
