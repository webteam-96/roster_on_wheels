"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ClubSocialLink } from "@/types/socialLink";
import { SOCIAL_PLATFORMS } from "@/types/socialLink";
import {
  getClubSocialLinks,
  createClubSocialLink,
  updateClubSocialLink,
  deleteClubSocialLink,
  reorderClubSocialLinksAll,
  getClub,
} from "@/services/api";
import { useDragSort } from "@/hooks/useDragSort";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

function getPlatformLabel(value: string): string {
  return SOCIAL_PLATFORMS.find((p) => p.value === value)?.label || value;
}

function getPlatformIcon(platform: string) {
  // Return a colored circle/badge with initial for visual distinction
  const colors: Record<string, string> = {
    facebook: "bg-blue-600",
    instagram: "bg-[#A9C6EA]",
    twitter: "bg-black",
    linkedin: "bg-blue-700",
    youtube: "bg-red-600",
    telegram: "bg-sky-500",
    pinterest: "bg-red-700",
    threads: "bg-black",
    googleplus: "bg-red-500",
    website: "bg-gray-600",
  };
  const bg = colors[platform] || "bg-primary";
  const initial = getPlatformLabel(platform).charAt(0).toUpperCase();
  return (
    <div className={`h-8 w-8 rounded-full ${bg} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initial}
    </div>
  );
}

export default function SocialLinksPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [links, setLinks] = useState<ClubSocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<ClubSocialLink | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formPlatform, setFormPlatform] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<ClubSocialLink | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  const filteredLinks = links.filter((link) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      getPlatformLabel(link.platform).toLowerCase().includes(q) ||
      link.linkUrl.toLowerCase().includes(q) ||
      (link.isActive ? "active" : "inactive").includes(q)
    );
  });
  const isSearching = searchQuery.trim() !== "";

  // Fetch links
  const fetchLinks = useCallback(async () => {
    setLoadingLinks(true);
    try {
      const data = await getClubSocialLinks(clubId);
      setLinks(data);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load social links.");
    } finally {
      setLoadingLinks(false);
    }
  }, [clubId]);

  // Initial load
  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const clubData = await getClub(clubId);
        setClubName(clubData.clubName);
        await fetchLinks();
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [clubId, fetchLinks]);

  const { dragProps } = useDragSort(links, setLinks, async (ids) => {
    try { await reorderClubSocialLinksAll(clubId, ids); }
    catch { setErrorMessage("Failed to save order."); fetchLinks(); }
  });

  const openAddDialog = () => {
    setEditingLink(null);
    setFormPlatform("");
    setFormLinkUrl("");
    setFormIsActive("1");
    setDialogOpen(true);
  };

  const openEditDialog = (link: ClubSocialLink) => {
    setEditingLink(link);
    setFormPlatform(link.platform);
    setFormLinkUrl(link.linkUrl);
    setFormIsActive(link.isActive ? "1" : "0");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formPlatform) { setErrorMessage("Please select a social media platform."); return; }
    if (!formLinkUrl.trim()) { setErrorMessage("Please enter the link URL."); return; }

    setSaving(true);
    try {
      if (editingLink) {
        await updateClubSocialLink(clubId, editingLink.id, {
          platform: formPlatform,
          linkUrl: formLinkUrl.trim(),
          sortOrder: editingLink.sortOrder,
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Social link updated successfully.");
      } else {
        const nextSort = links.length > 0 ? Math.max(...links.map((l) => l.sortOrder)) + 1 : 1;
        await createClubSocialLink(clubId, {
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
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save social link.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteClubSocialLink(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Social link deleted successfully.");
      fetchLinks();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete social link.");
    }
  };

  const handleToggleActive = async (link: ClubSocialLink) => {
    try {
      await updateClubSocialLink(clubId, link.id, {
        platform: link.platform,
        linkUrl: link.linkUrl,
        sortOrder: link.sortOrder,
        isActive: !link.isActive,
      });
      setSuccessMessage(link.isActive ? "Social link deactivated." : "Social link activated.");
      fetchLinks();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update social link status.");
    }
  };

  const handleOpenLink = (url: string) => {
    let finalUrl = url;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = "https://" + finalUrl;
    }
    window.open(finalUrl, "_blank");
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Social Media Links` : "Social Media Links"}
              </h2>
              <p className="text-muted-foreground text-base">Manage club social media links</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog}>
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
            <Badge variant="secondary">
              {links.length} Link{links.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        )}

        {loadingLinks && (
          <div className="flex items-center justify-center py-12">
            <ListPageSkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && !loadingLinks && links.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Share2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No social media links yet</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Link" to add your first social media link.' : "No social media links have been added yet."}
            </p>
          </div>
        )}

        {/* Links list */}
        {!loading && !loadingLinks && links.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search social links..."
            />
            {filteredLinks.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-3">
              {filteredLinks.map((link, idx) => (
                <Card key={link.id} className="border-primary/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      {canManage && !isSearching && (
                        <div {...dragProps(idx)} className="text-muted-foreground shrink-0" title="Drag to reorder">
                          <GripVertical className="h-4 w-4 cursor-grab" />
                        </div>
                      )}
                      {getPlatformIcon(link.platform)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{getPlatformLabel(link.platform)}</p>
                        <p className="text-xs text-muted-foreground truncate">{link.linkUrl}</p>
                        <Badge variant={link.isActive ? "default" : "secondary"} className="mt-1">
                          {link.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
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
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(link)}>
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12 text-primary-foreground"></TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Platform</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Link URL</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Status</TableHead>
                    {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                    {canManage && <TableHead className="w-20 text-primary-foreground text-base font-semibold text-center">Sorting</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLinks.map((link, idx) => (
                    <TableRow key={link.id} className="hover:bg-primary/5 transition-colors">
                      <TableCell>{getPlatformIcon(link.platform)}</TableCell>
                      <TableCell className="font-medium">{getPlatformLabel(link.platform)}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => handleOpenLink(link.linkUrl)}
                          className="text-primary hover:underline text-sm truncate block max-w-xs text-left"
                        >
                          {link.linkUrl}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={link.isActive ? "default" : "secondary"}>
                          {link.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
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
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(link)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                      {canManage && (
                        <TableCell className="w-20">
                          {!isSearching ? (
                            <div {...dragProps(idx)} className="flex items-center justify-center text-muted-foreground" title="Drag to reorder">
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

        {/* Add/Edit Social Link Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingLink ? "Edit Social Link" : "Add Social Link"}</DialogTitle>
              <DialogDescription>
                {editingLink ? "Update the social media link details." : "Select a platform and enter the link URL."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Platform */}
              <div className="space-y-2">
                <Label>Social Media Platform *</Label>
                <Select value={formPlatform} onValueChange={setFormPlatform}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a platform" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOCIAL_PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Link URL */}
              <div className="space-y-2">
                <Label>Link URL *</Label>
                <Input
                  placeholder="https://..."
                  value={formLinkUrl}
                  onChange={(e) => setFormLinkUrl(e.target.value)}
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger>
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
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !formPlatform || !formLinkUrl.trim()}>
                {saving ? "Saving..." : editingLink ? "Update" : "Add"}
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
          title="Delete Social Link"
          description={
            <>
              Are you sure you want to delete the <span className="font-semibold text-foreground">{deleteTarget ? getPlatformLabel(deleteTarget.platform) : ""}</span> link? This action cannot be undone.
            </>
          }
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
