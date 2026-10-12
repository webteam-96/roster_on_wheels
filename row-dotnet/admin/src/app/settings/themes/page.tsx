"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Theme } from "@/types/theme";
import {
  getThemes,
  createTheme,
  updateTheme,
  deleteTheme,
  uploadThemeImage,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, Palette, AlertTriangle, Upload, X } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ThemesPage() {
  const { isSuperAdmin } = useAuth();

  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [themeName, setThemeName] = useState("");
  const [themeDescription, setThemeDescription] = useState("");
  const [themeImagePath, setThemeImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Theme | null>(null);

  const fetchThemes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getThemes();
      setThemes(data);
    } catch (err: unknown) {
      console.error("Themes fetch error:", err);
      setErrorMessage("Failed to load themes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThemes(); }, [fetchThemes]);

  const openAddDialog = () => {
    setEditingTheme(null);
    setThemeName("");
    setThemeDescription("");
    setThemeImagePath(null);
    setDialogOpen(true);
  };

  const openEditDialog = (theme: Theme) => {
    setEditingTheme(theme);
    setThemeName(theme.themeName);
    setThemeDescription(theme.description ?? "");
    setThemeImagePath(theme.themeImagePath || null);
    setDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadThemeImage(file);
      setThemeImagePath(result.path);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload image.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!themeName.trim()) { setErrorMessage("Please enter a theme name."); return; }
    setSaving(true);
    try {
      const description = themeDescription.trim() || null;
      if (editingTheme) {
        await updateTheme(editingTheme.id, { themeName: themeName.trim(), themeImagePath: themeImagePath || undefined, description });
        setSuccessMessage("Theme updated successfully.");
      } else {
        await createTheme({ themeName: themeName.trim(), themeImagePath: themeImagePath || undefined, description });
        setSuccessMessage("Theme added successfully.");
      }
      setDialogOpen(false);
      fetchThemes();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save theme.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTheme(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Theme deleted.");
      fetchThemes();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete theme.");
    }
  };

  const filteredThemes = themes.filter((theme) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      theme.themeName.toLowerCase().includes(q) ||
      (theme.description ?? "").toLowerCase().includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage themes.</p>
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
              <h2 className="text-2xl font-bold tracking-tight text-primary">Themes</h2>
              <p className="text-muted-foreground text-base">Manage website themes and images</p>
            </div>
          </div>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />Add Theme
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && themes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Palette className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No themes found</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Theme&quot; to create your first one.</p>
          </div>
        )}

        {!loading && themes.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search themes..."
            />
            {filteredThemes.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-2">
              {filteredThemes.map((theme) => (
                <div key={theme.id} className="flex items-center gap-3 border rounded-md p-3">
                  {theme.themeImagePath ? (
                    <img
                      src={`${API_BASE_URL}${theme.themeImagePath}`}
                      alt={theme.themeName}
                      className="h-12 w-12 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                      <Palette className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{theme.themeName}</p>
                    {theme.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{theme.description}</p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(theme)}>
                        <Pencil className="mr-2 h-4 w-4" />Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(theme)}>
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
                    <TableHead className="text-primary-foreground text-base font-semibold">Theme Name</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Description</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Image</TableHead>
                    <TableHead className="w-12 text-primary-foreground"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredThemes.map((theme, i) => (
                    <TableRow key={theme.id} className="hover:bg-primary/5 transition-colors">
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{theme.themeName}</TableCell>
                      <TableCell className="max-w-[360px]">
                        {theme.description ? (
                          <span className="line-clamp-2 text-sm text-muted-foreground" title={theme.description}>{theme.description}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {theme.themeImagePath ? (
                          <img
                            src={`${API_BASE_URL}${theme.themeImagePath}`}
                            alt={theme.themeName}
                            className="h-10 w-10 rounded object-cover"
                          />
                        ) : (
                          <span className="text-muted-foreground text-sm">No image</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(theme)}>
                              <Pencil className="mr-2 h-4 w-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(theme)}>
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
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingTheme ? "Edit Theme" : "Add Theme"}</DialogTitle>
              <DialogDescription>
                {editingTheme ? "Update the theme details." : "Enter the new theme details."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Theme Name<span className="text-destructive ml-1">*</span></Label>
                <Input value={themeName} onChange={(e) => setThemeName(e.target.value)} placeholder="e.g. Peace & Conflict Resolution" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={themeDescription}
                  onChange={(e) => setThemeDescription(e.target.value)}
                  placeholder="Short note about this theme (optional)"
                  rows={3}
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground">Optional. Helps SuperAdmins remember what this theme is for. ({themeDescription.length}/1000)</p>
              </div>
              <div className="space-y-2">
                <Label>Theme Image</Label>
                {themeImagePath ? (
                  <div className="relative inline-block">
                    <img
                      src={`${API_BASE_URL}${themeImagePath}`}
                      alt="Theme preview"
                      className="h-24 w-auto rounded border object-cover"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                      onClick={() => setThemeImagePath(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {uploading ? "Uploading..." : "Upload Image"}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !themeName.trim() || uploading}>
                {saving ? "Saving..." : editingTheme ? "Update" : "Add"}
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
          title="Delete Theme"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.themeName}</span>?</>}
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
