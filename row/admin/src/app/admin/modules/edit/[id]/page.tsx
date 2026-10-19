"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { UpdateModuleRequest, ModuleCategory } from "@/types/module";
import { getModule, updateModule, getModuleCategories, uploadModuleIcon, getPhotoUrl } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Upload, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function EditModulePage() {
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [categories, setCategories] = useState<ModuleCategory[]>([]);

  // Form fields
  const [moduleName, setModuleName] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [moduleLevel, setModuleLevel] = useState("Both");
  const [iconClass, setIconClass] = useState("");
  const [iconPath, setIconPath] = useState("");
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [description, setDescription] = useState("");
  const [routeUrl, setRouteUrl] = useState("");
  const [isDefaultForDistrict, setIsDefaultForDistrict] = useState(false);
  const [isDefaultForClub, setIsDefaultForClub] = useState(false);
  const [isDefaultForMember, setIsDefaultForMember] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  // On edit this is an ACTION, not a stored value: unchecked by default so a routine edit never
  // re-broadcasts a hand-scoped module. Check it to push this module to all districts/clubs now.
  const [assignToAll, setAssignToAll] = useState(false);

  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [mod, cats] = await Promise.all([getModule(id), getModuleCategories()]);
        setModuleName(mod.moduleName);
        setModuleKey(mod.moduleKey);
        setCategoryId(mod.categoryId ? String(mod.categoryId) : "");
        setModuleLevel(mod.moduleLevel);
        setIconClass(mod.iconClass || "");
        setIconPath(mod.iconPath || "");
        setDescription(mod.description || "");
        setRouteUrl(mod.routeUrl || "");
        setIsDefaultForDistrict(mod.isDefaultForDistrict);
        setIsDefaultForClub(mod.isDefaultForClub);
        setIsDefaultForMember(mod.isDefaultForMember ?? false);
        setSortOrder(mod.sortOrder);
        setIsActive(mod.isActive);
        setCategories(cats);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load module data.");
      } finally {
        setFetching(false);
      }
    }
    fetchData();
  }, [id]);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIcon(true);
    try {
      const result = await uploadModuleIcon(file);
      setIconPath(result.path);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload icon.");
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moduleName.trim()) {
      setErrorMessage("Module name is required.");
      return;
    }
    if (!moduleKey.trim()) {
      setErrorMessage("Module key is required.");
      return;
    }
    if (!categoryId) {
      setErrorMessage("Category is required.");
      return;
    }
    setLoading(true);
    try {
      const data: UpdateModuleRequest = {
        moduleName: moduleName.trim(),
        moduleKey: moduleKey.trim(),
        categoryId: parseInt(categoryId),
        moduleLevel,
        iconClass: iconClass.trim() || undefined,
        iconPath: iconPath || undefined,
        description: description.trim() || undefined,
        routeUrl: routeUrl.trim() || undefined,
        isDefaultForDistrict,
        isDefaultForClub,
        // Valid for Club or Both — pure District modules are admin-only.
        isDefaultForMember,
        sortOrder,
        isActive,
        // Only pushes to all districts/clubs when ticked; otherwise existing assignments stay as-is.
        assignToAll,
      };
      await updateModule(id, data);
      setShowSuccess(true);
    } catch (err) {
      const message = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message || "Failed to update module."
        : "Failed to update module.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can edit modules.</p>
        </div>
      </ProtectedRoute>
    );
  }

  if (fetching) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/admin/modules"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Module</h2>
              <p className="text-muted-foreground text-base">Update module details</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/admin/modules")}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <RotaryLoader size="sm" />}
              Update Module
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Module Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid gap-4 max-w-lg mx-auto">
                <div className="space-y-2">
                  <Label htmlFor="moduleName">Module Name<span className="text-destructive ml-1">*</span></Label>
                  <Input
                    id="moduleName"
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    placeholder="e.g., Member Directory"
                    maxLength={200}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="moduleKey">Module Key<span className="text-destructive ml-1">*</span></Label>
                  <Input
                    id="moduleKey"
                    value={moduleKey}
                    onChange={(e) => setModuleKey(e.target.value)}
                    placeholder="e.g., member_directory"
                    maxLength={200}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="categoryId">Category<span className="text-destructive ml-1">*</span></Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.categoryName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="moduleLevel">Module Level<span className="text-destructive ml-1">*</span></Label>
                  <Select value={moduleLevel} onValueChange={setModuleLevel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="District">District</SelectItem>
                      <SelectItem value="Club">Club</SelectItem>
                      <SelectItem value="Both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="assignToAll"
                      checked={assignToAll}
                      onChange={(e) => setAssignToAll(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="assignToAll" className="font-medium">Assign to all districts / clubs now</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave unchecked for a normal edit: existing per-district/club assignments stay untouched.
                    Check it only if you want to push this module to every district and/or club (per the Module
                    Level above) right now. It never removes existing assignments.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Module Icon</Label>
                  {iconPath ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={getPhotoUrl(iconPath)}
                        alt="Module icon"
                        className="h-12 w-12 rounded border object-contain"
                      />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setIconPath("")}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <Label
                        htmlFor="iconUpload"
                        className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-accent"
                      >
                        <Upload className="h-4 w-4" />
                        {uploadingIcon ? "Uploading..." : "Upload Icon Image"}
                      </Label>
                      <input
                        id="iconUpload"
                        type="file"
                        accept=".jpg,.jpeg,.png,.gif,.webp,.svg"
                        className="hidden"
                        onChange={handleIconUpload}
                        disabled={uploadingIcon}
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Upload a custom icon image (optional). Takes priority over icon class.</p>
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP, SVG</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="iconClass">Icon Class (Fallback)</Label>
                  <Input
                    id="iconClass"
                    value={iconClass}
                    onChange={(e) => setIconClass(e.target.value)}
                    placeholder="e.g., Users (Lucide icon name)"
                    maxLength={100}
                  />
                  <p className="text-xs text-muted-foreground">Lucide icon name, used when no icon image is uploaded</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the module"
                    maxLength={500}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="routeUrl">Route URL</Label>
                  <Input
                    id="routeUrl"
                    value={routeUrl}
                    onChange={(e) => setRouteUrl(e.target.value)}
                    placeholder="e.g., /members"
                    maxLength={200}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefaultForDistrict"
                    checked={isDefaultForDistrict}
                    onChange={(e) => setIsDefaultForDistrict(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isDefaultForDistrict">Default for District</Label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefaultForClub"
                    checked={isDefaultForClub}
                    onChange={(e) => setIsDefaultForClub(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isDefaultForClub">Default for Club</Label>
                </div>

                {/* Default for Member Mobile Login — global SuperAdmin toggle.
                    Applies to any Module Level. Per-role visibility (member
                    sees only modules with this flag; club/district admins see
                    everything) is enforced server-side in the mobile login
                    response, not here. */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefaultForMember"
                    checked={isDefaultForMember}
                    onChange={(e) => setIsDefaultForMember(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isDefaultForMember">Default for Member Mobile Login</Label>
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

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isActive">Active</Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
      <SuccessAlert open={showSuccess} title="Module Updated" description="Module updated successfully." onOk={() => router.push("/admin/modules")} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
