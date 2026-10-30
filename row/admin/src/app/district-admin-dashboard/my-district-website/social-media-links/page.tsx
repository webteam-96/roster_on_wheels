"use client";

/**
 * V2 — Social Media Links page under the District Admin dashboard shell.
 * ---------------------------------------------------------------------------
 * Ported verbatim from V1
 *   (src/app/districts/[id]/website-data/social_media_links/page.tsx)
 * with only these V2 conventions applied:
 *   - districtId from useAuth().selectedDistrictId (no /districts/[id] URL
 *     param).
 *   - Back / Save success / Cancel honour ?returnTo=; fallback goes to the
 *     my-district-website landing.
 *   - ?yearId= is forwarded through Back navigation so the top bar year
 *     picker stays in sync (social-media-links themselves are NOT year-wise —
 *     memory rule: one set per district, fk_year_id filled with current year
 *     on create but never filtered on read; no year filter UI here).
 *   - Visual chrome refreshed to the dashboard palette:
 *       Navy  #17458f  (headings, primary buttons, table header)
 *       Gold  #F7A81B  (underline accent on table header)
 *       Slate 200/500/800 (borders / muted text / body)
 *       rounded-2xl border border-slate-200 shadow-sm bg-white cards
 *       inputs border-slate-200 bg-white focus:border-azure
 *              focus:ring-azure/20
 *
 * All state hooks, dialogs, dropdowns, service calls, validations, table
 * columns, delete confirmation, drag-sort, active-toggle and search
 * behaviour are preserved 1:1 with V1.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SOCIAL_PLATFORMS } from "@/types/socialLink";
import {
  getDistrictSocialLinks,
  createDistrictSocialLink,
  updateDistrictSocialLink,
  deleteDistrictSocialLink,
  reorderDistrictSocialLinksAll,
  getDistrict,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal,
  AlertTriangle, Eye, EyeOff, ExternalLink, Share2, GripVertical,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

function getPlatformLabel(value: string): string {
  return SOCIAL_PLATFORMS.find((p) => p.value === value)?.label || value;
}

function getPlatformIcon(platform: string) {
  const colors: Record<string, string> = {
    facebook: "bg-blue-600", instagram: "bg-[#A9C6EA]",
    twitter: "bg-black", linkedin: "bg-blue-700", youtube: "bg-red-600",
    threads: "bg-black", googleplus: "bg-red-500", website: "bg-gray-600",
  };
  const bg = colors[platform] || "bg-azure";
  const initial = getPlatformLabel(platform).charAt(0).toUpperCase();
  return (
    <div className={`h-8 w-8 rounded-full ${bg} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initial}
    </div>
  );
}

interface SocialLinkItem {
  id: number;
  platform: string;
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
}

export default function DistrictAdminSocialLinksPage() {
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");

  const goBack = () => {
    const dest = returnTo || "/district-admin-dashboard/my-district-website";
    if (!currentYearId) { router.push(dest); return; }
    const sep = dest.includes("?") ? "&" : "?";
    router.push(`${dest}${sep}yearId=${encodeURIComponent(currentYearId)}`);
  };

  const [districtNumber, setDistrictNumber] = useState("");
  const [links, setLinks] = useState<SocialLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<SocialLinkItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [formPlatform, setFormPlatform] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");

  const [deleteTarget, setDeleteTarget] = useState<SocialLinkItem | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  const filteredLinks = links.filter((link) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return getPlatformLabel(link.platform).toLowerCase().includes(q)
      || link.linkUrl.toLowerCase().includes(q)
      || (link.isActive ? "active" : "inactive").includes(q);
  });
  const isSearching = searchQuery.trim() !== "";

  const fetchLinks = useCallback(async () => {
    if (!districtId) return;
    setLoadingLinks(true);
    try {
      const data = await getDistrictSocialLinks(districtId);
      setLinks(data);
    } catch { setErrorMessage("Failed to load social links."); }
    finally { setLoadingLinks(false); }
  }, [districtId]);

  useEffect(() => {
    if (!districtId) { setLoading(false); return; }
    async function fetchInitial() {
      setLoading(true);
      try {
        const districtData = await getDistrict(districtId);
        setDistrictNumber(districtData.districtNumber);
        await fetchLinks();
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId, fetchLinks]);

  const { dragProps } = useDragSort(links, setLinks, async (ids) => {
    try { await reorderDistrictSocialLinksAll(districtId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchLinks(); }
  });

  const openAddDialog = () => {
    setEditingLink(null);
    setFormPlatform("");
    setFormLinkUrl("");
    setFormIsActive("1");
    setDialogOpen(true);
  };

  const openEditDialog = (link: SocialLinkItem) => {
    setEditingLink(link);
    setFormPlatform(link.platform);
    setFormLinkUrl(link.linkUrl);
    setFormIsActive(link.isActive ? "1" : "0");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formPlatform) { setErrorMessage("Please select a social media platform."); return; }
    if (!formLinkUrl.trim()) { setErrorMessage("Please enter the link URL."); return; }
    // Platform must be UNIQUE per district — reject a save if another
    // row already uses this platform. On edit, allow the same row (id
    // === editingLink.id) to keep its own platform. Case-insensitive
    // compare so "facebook" and "Facebook" don't slip through.
    const dupe = links.find(
      (l) =>
        l.platform.toLowerCase() === formPlatform.toLowerCase() &&
        (!editingLink || l.id !== editingLink.id),
    );
    if (dupe) {
      setErrorMessage(
        `${getPlatformLabel(formPlatform)} is already added. Edit the existing entry instead of creating a duplicate.`,
      );
      return;
    }
    setSaving(true);
    try {
      if (editingLink) {
        await updateDistrictSocialLink(districtId, editingLink.id, {
          platform: formPlatform,
          linkUrl: formLinkUrl.trim(),
          sortOrder: editingLink.sortOrder,
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Social link updated successfully.");
      } else {
        const nextSort = links.length > 0
          ? Math.max(...links.map((l) => l.sortOrder)) + 1
          : 1;
        await createDistrictSocialLink(districtId, {
          platform: formPlatform,
          linkUrl: formLinkUrl.trim(),
          sortOrder: nextSort,
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Social link added successfully.");
      }
      setDialogOpen(false);
      fetchLinks();
    } catch (err: any) {
      // Surface the backend's uniqueness message (400) instead of a
      // generic failure. Falls back to the generic text on network errors.
      const backend = err?.response?.data?.message || err?.response?.data;
      setErrorMessage(typeof backend === "string" && backend ? backend : "Failed to save social link.");
    }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictSocialLink(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Social link deleted successfully.");
      fetchLinks();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete social link.");
    }
  };

  const handleToggleActive = async (link: SocialLinkItem) => {
    try {
      await updateDistrictSocialLink(districtId, link.id, {
        platform: link.platform,
        linkUrl: link.linkUrl,
        sortOrder: link.sortOrder,
        isActive: !link.isActive,
      });
      setSuccessMessage(link.isActive ? "Social link deactivated." : "Social link activated.");
      fetchLinks();
    } catch { setErrorMessage("Failed to update social link status."); }
  };

  const handleOpenLink = (url: string) => {
    let finalUrl = url;
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = "https://" + finalUrl;
    window.open(finalUrl, "_blank");
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-ink">
                {districtNumber ? `District ${districtNumber} - Social Media Links` : "Social Media Links"}
              </h2>
              <p className="text-slate-500 text-sm mt-0.5">Manage district social media links</p>
            </div>
          </div>
          {canManage && (
            <Button
              onClick={openAddDialog}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />Add Link
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && !loadingLinks && links.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <Badge
              variant="outline"
              className="border-slate-200 bg-slate-50 text-slate-700 font-medium"
            >
              {links.length} Link{links.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        )}

        {loadingLinks && (
          <div className="flex items-center justify-center py-12">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && !loadingLinks && links.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <Share2 className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No social media links yet</h3>
            <p className="text-slate-500 mt-2 text-sm">
              {canManage
                ? 'Click "Add Link" to add your first social media link.'
                : "No social media links have been added yet."}
            </p>
          </div>
        )}

        {!loading && !loadingLinks && links.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search social links..."
            />
            {filteredLinks.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-slate-500 text-sm py-8 text-center">
                No results found for &quot;{searchQuery}&quot;
              </p>
            ) : (
              <>
                {/* ── Mobile card list ─────────────────────────────────── */}
                <div className="block sm:hidden space-y-3">
                  {filteredLinks.map((link, idx) => (
                    <div
                      key={link.id}
                      className="rounded-2xl border border-slate-200 shadow-sm bg-white"
                    >
                      <div className="p-4">
                        <div className="flex items-center gap-3">
                          {canManage && !isSearching && (
                            <div
                              {...dragProps(idx)}
                              className="text-slate-400 shrink-0"
                              title="Drag to reorder"
                            >
                              <GripVertical className="h-4 w-4 cursor-grab" />
                            </div>
                          )}
                          {getPlatformIcon(link.platform)}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-slate-800">{getPlatformLabel(link.platform)}</p>
                            <p className="text-xs text-slate-500 truncate">{link.linkUrl}</p>
                            <Badge
                              variant="outline"
                              className={
                                link.isActive
                                  ? "mt-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "mt-1 border-slate-200 bg-slate-50 text-slate-600"
                              }
                            >
                              {link.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDialog(link)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenLink(link.linkUrl)}>
                                  <ExternalLink className="mr-2 h-4 w-4" />Open Link
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleToggleActive(link)}>
                                  {link.isActive ? (
                                    <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                                  ) : (
                                    <><Eye className="mr-2 h-4 w-4" />Activate</>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onClick={() => setDeleteTarget(link)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Desktop table ────────────────────────────────────── */}
                <div className="hidden sm:block rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow
                        className="hover:opacity-100 border-b-2 border-marigold"
                        style={{ backgroundColor: "#17458f" }}
                      >
                        <TableHead className="w-12/90"></TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wide">Platform</TableHead>
                        <TableHead className="text-xs font-semibold uppercase tracking-wide">Link URL</TableHead>
                        <TableHead className="w-24 text-xs font-semibold uppercase tracking-wide">Status</TableHead>
                        {canManage && <TableHead className="w-12/90"></TableHead>}
                        {canManage && (
                          <TableHead className="w-20 text-xs font-semibold uppercase tracking-wide text-center">
                            Sorting
                          </TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLinks.map((link, idx) => (
                        <TableRow
                          key={link.id}
                          className="hover:bg-slate-50/70 transition-colors border-slate-100"
                        >
                          <TableCell>{getPlatformIcon(link.platform)}</TableCell>
                          <TableCell className="font-semibold text-slate-800">
                            {getPlatformLabel(link.platform)}
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => handleOpenLink(link.linkUrl)}
                              className="text-ink hover:underline text-sm truncate block max-w-xs text-left"
                            >
                              {link.linkUrl}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                link.isActive
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                              }
                            >
                              {link.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          {canManage && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openEditDialog(link)}>
                                    <Pencil className="mr-2 h-4 w-4" />Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleOpenLink(link.linkUrl)}>
                                    <ExternalLink className="mr-2 h-4 w-4" />Open Link
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleToggleActive(link)}>
                                    {link.isActive ? (
                                      <><EyeOff className="mr-2 h-4 w-4" />Deactivate</>
                                    ) : (
                                      <><Eye className="mr-2 h-4 w-4" />Activate</>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-700"
                                    onClick={() => setDeleteTarget(link)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                          {canManage && (
                            <TableCell className="w-20">
                              {!isSearching ? (
                                <div
                                  {...dragProps(idx)}
                                  className="flex items-center justify-center text-slate-400"
                                  title="Drag to reorder"
                                >
                                  <GripVertical className="h-4 w-4 cursor-grab" />
                                </div>
                              ) : null}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </>
        )}

        {/* Add / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-ink">
                {editingLink ? "Edit Social Link" : "Add Social Link"}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                {editingLink
                  ? "Update the social media link details."
                  : "Select a platform and enter the link URL."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Social Media Platform *</Label>
                <Select value={formPlatform} onValueChange={setFormPlatform}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20">
                    <SelectValue placeholder="Select a platform" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Link URL *</Label>
                <Input
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                  placeholder="https://..."
                  value={formLinkUrl}
                  onChange={(e) => setFormLinkUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-medium">Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formPlatform || !formLinkUrl.trim()}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editingLink ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-red-500"
          title="Delete Social Link"
          description={
            <>
              Are you sure you want to delete the{" "}
              <span className="font-semibold text-slate-800">
                {deleteTarget ? getPlatformLabel(deleteTarget.platform) : ""}
              </span>{" "}
              link? This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
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
