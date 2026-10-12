"use client";

import { useState, useEffect, useRef } from "react";
import { AvailableModule } from "@/types/module";
import { ClubListItem } from "@/types/club";
import { getClubs, getClubAvailableModules, assignClubModules, unassignClubModules } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, AlertCircle, Save, Search } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface CategoryGroup {
  categoryId: number;
  categoryName: string;
  categorySortOrder: number;
  modules: AvailableModule[];
}

export default function ClubModulesPage() {
  const { isSuperAdmin } = useAuth();

  // Club search
  const [clubSearch, setClubSearch] = useState("");
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [searchingClubs, setSearchingClubs] = useState(false);
  const [selectedClub, setSelectedClub] = useState<ClubListItem | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Module state
  const [modules, setModules] = useState<AvailableModule[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Track initial assignment state
  const [initialAssigned, setInitialAssigned] = useState<Set<number>>(new Set());
  const [currentAssigned, setCurrentAssigned] = useState<Set<number>>(new Set());

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Smart search - auto-search as user types (debounced)
  useEffect(() => {
    if (clubSearch.trim().length < 2) {
      setClubs([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingClubs(true);
      try {
        const result = await getClubs(1, 20, clubSearch.trim());
        setClubs(result.items);
        setShowDropdown(result.items.length > 0);
      } catch {
        setClubs([]);
        setShowDropdown(false);
      } finally {
        setSearchingClubs(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [clubSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectClub = async (club: ClubListItem) => {
    setSelectedClub(club);
    setClubs([]);
    setClubSearch("");
    setShowDropdown(false);
    setLoadingModules(true);
    setError(null);
    try {
      const result = await getClubAvailableModules(club.id);
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
    if (!selectedClub) return;

    const toAssign = Array.from(currentAssigned).filter(id => !initialAssigned.has(id));
    const toUnassign = Array.from(initialAssigned).filter(id => !currentAssigned.has(id));

    if (toAssign.length === 0 && toUnassign.length === 0) {
      setSuccessMessage("No changes to save.");
      return;
    }

    setSaving(true);
    try {
      if (toAssign.length > 0) {
        await assignClubModules(selectedClub.id, toAssign);
      }
      if (toUnassign.length > 0) {
        await unassignClubModules(selectedClub.id, toUnassign);
      }
      setSuccessMessage("Module assignments updated successfully.");
      // Refresh
      const result = await getClubAvailableModules(selectedClub.id);
      setModules(result);
      const refreshedIds = result.filter(m => m.isAssigned).map(m => m.moduleId);
      setInitialAssigned(new Set(refreshedIds));
      setCurrentAssigned(new Set(refreshedIds));
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
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage club modules.</p>
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
              <h2 className="text-2xl font-bold tracking-tight text-primary">Club Module Assignment</h2>
              <p className="text-muted-foreground text-base">Assign modules to clubs</p>
            </div>
          </div>
          {selectedClub && modules.length > 0 && (
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? <RotaryLoader size="sm" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>Search Club</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4 max-w-md">
              <div className="space-y-2">
                <div className="relative" ref={dropdownRef}>
                  <div className="relative">
                    <Input
                      id="clubSearch"
                      value={clubSearch}
                      onChange={(e) => setClubSearch(e.target.value)}
                      onFocus={() => { if (clubs.length > 0) setShowDropdown(true); }}
                      placeholder="Start typing club name..."
                      className="pr-10"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      {searchingClubs ? <RotaryLoader size="sm" /> : <Search className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {showDropdown && clubs.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 border rounded-md bg-background shadow-lg max-h-60 overflow-y-auto">
                      {clubs.map((club) => (
                        <button
                          key={club.id}
                          type="button"
                          onClick={() => selectClub(club)}
                          className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0"
                        >
                          <p className="text-sm font-medium">{club.clubName}</p>
                          <p className="text-xs text-muted-foreground">District: {club.districtNumber}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {clubSearch.trim().length > 0 && clubSearch.trim().length < 2 && (
                  <p className="text-xs text-muted-foreground">Type at least 2 characters to search...</p>
                )}
              </div>

              {selectedClub && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <p className="text-sm"><span className="font-medium">Selected:</span> {selectedClub.clubName}</p>
                  <p className="text-xs text-muted-foreground">District: {selectedClub.districtNumber}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {loadingModules && (
          <div className="flex items-center justify-center py-12">
            <RotaryLoader size="lg" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
          </div>
        )}

        {!loadingModules && !error && selectedClub && groupedModules.length > 0 && (
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

        {!loadingModules && !error && selectedClub && modules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No modules available for this club.</p>
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
