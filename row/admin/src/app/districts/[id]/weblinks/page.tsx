"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Weblink } from "@/types/weblink";
import { getDistrict, getDistrictWeblinks, createDistrictWeblink, updateDistrictWeblink, deleteDistrictWeblink, toggleDistrictWeblinkActive } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { isValidWebUrl, INVALID_URL_MESSAGE } from "@/lib/urlValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import SearchBox from "@/components/SearchBox";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle, ChevronRight, FolderTree, Loader2, Image as ImageIcon } from "@/components/icons";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
import "react-quill-new/dist/quill.snow.css";
import { ListPageSkeleton } from "@/components/row/AppKit";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const quillModules = { toolbar: [["bold", "italic", "underline"], [{ list: "ordered" }, { list: "bullet" }], ["link"], ["clean"]] };

interface BreadcrumbItem { id: number | null; title: string; }

function LinkTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = { None: "bg-gray-100 text-gray-700", Page: "bg-blue-100 text-blue-700", URL: "bg-green-100 text-green-700", PDF: "bg-red-100 text-red-700" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[type] || "bg-gray-100 text-gray-700"}`}>{type}</span>;
}

export default function DistrictWeblinksPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
  const [weblinks, setWeblinks] = useState<Weblink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: null, title: "Root" }]);
  const currentLevel = currentParentId === null ? 1 : breadcrumb.length;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Weblink | null>(null);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formWriteup, setFormWriteup] = useState("");
  const [formLinkType, setFormLinkType] = useState("None");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formYoutubeUrl, setFormYoutubeUrl] = useState("");
  const [formButtonText, setFormButtonText] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formLogo, setFormLogo] = useState<File | null>(null);
  const [formBanner, setFormBanner] = useState<File | null>(null);
  const [formPdf, setFormPdf] = useState<File | null>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Weblink | null>(null);
  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() { try { const d = await getDistrict(districtId); setDistrictName(`District ${d.districtNumber}`); } catch { setErrorMessage("Failed to load district info."); } }
    init();
  }, [districtId]);

  const fetchWeblinks = useCallback(async () => {
    setLoading(true);
    try { const result = await getDistrictWeblinks(districtId, currentParentId ?? undefined); setWeblinks(result); }
    catch { setWeblinks([]); setErrorMessage("Failed to load weblinks."); } finally { setLoading(false); }
  }, [districtId, currentParentId]);

  useEffect(() => { fetchWeblinks(); }, [fetchWeblinks]);

  const navigateInto = (weblink: Weblink) => { setBreadcrumb((prev) => [...prev, { id: weblink.id, title: weblink.title }]); setCurrentParentId(weblink.id); setSearchQuery(""); };
  const navigateTo = (index: number) => { const nb = breadcrumb.slice(0, index + 1); setBreadcrumb(nb); setCurrentParentId(nb[nb.length - 1].id); setSearchQuery(""); };

  // Resolve what clicking a weblink should do (priority: children > URL > PDF > YouTube).
  const handleRowClick = (w: Weblink) => {
    if (w.childCount > 0) { navigateInto(w); return; }
    if (w.linkType === "URL" && w.linkUrl) { window.open(w.linkUrl, "_blank", "noopener,noreferrer"); return; }
    if (w.linkType === "PDF" && w.pdfPath) { window.open(`${API_BASE_URL}${w.pdfPath}`, "_blank", "noopener,noreferrer"); return; }
    if (w.youtubeUrl) { window.open(w.youtubeUrl, "_blank", "noopener,noreferrer"); return; }
  };
  const isRowClickable = (w: Weblink) =>
    w.childCount > 0 ||
    (w.linkType === "URL" && !!w.linkUrl) ||
    (w.linkType === "PDF" && !!w.pdfPath) ||
    !!w.youtubeUrl;

  const resetForm = () => { setFormTitle(""); setFormWriteup(""); setFormLinkType("None"); setFormLinkUrl(""); setFormYoutubeUrl(""); setFormButtonText(""); setFormSortOrder(0); setFormLogo(null); setFormBanner(null); setFormPdf(null); };
  const openAddDialog = () => { resetForm(); setEditing(null); setDialogOpen(true); };
  const openEditDialog = (w: Weblink) => { setEditing(w); setFormTitle(w.title); setFormWriteup(w.writeup || ""); setFormLinkType(w.linkType || "None"); setFormLinkUrl(w.linkUrl || ""); setFormYoutubeUrl(w.youtubeUrl || ""); setFormButtonText(w.buttonText || ""); setFormSortOrder(w.sortOrder); setFormLogo(null); setFormBanner(null); setFormPdf(null); setDialogOpen(true); };

  const handleSave = async () => {
    if (!formTitle.trim()) { setErrorMessage("Title is required."); return; }
    if (formLinkType === "URL" && !formLinkUrl.trim()) { setErrorMessage("Link URL is required."); return; }
    if (formLinkUrl.trim() && !isValidWebUrl(formLinkUrl)) { setErrorMessage(INVALID_URL_MESSAGE); return; }
    if (formYoutubeUrl.trim() && !isValidWebUrl(formYoutubeUrl)) { setErrorMessage(INVALID_URL_MESSAGE); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      if (!editing && currentParentId !== null) fd.append("parentId", String(currentParentId));
      fd.append("title", formTitle.trim()); fd.append("writeup", formWriteup); fd.append("linkType", formLinkType);
      fd.append("linkUrl", formLinkUrl); fd.append("youtubeUrl", formYoutubeUrl); fd.append("buttonText", formButtonText);
      fd.append("sortOrder", String(formSortOrder));
      if (editing) fd.append("isActive", String(editing.isActive));
      if (formLogo) fd.append("logo", formLogo);
      if (formBanner) fd.append("banner", formBanner);
      if (formPdf) fd.append("pdf", formPdf);
      if (editing) { await updateDistrictWeblink(districtId, editing.id, fd); setSuccessMessage("Weblink updated successfully."); }
      else { await createDistrictWeblink(districtId, fd); setSuccessMessage("Weblink created successfully."); }
      setDialogOpen(false); resetForm(); setEditing(null); fetchWeblinks();
    } catch (err: unknown) { const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to save weblink."; setErrorMessage(msg); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { if (!deleteTarget) return; try { await deleteDistrictWeblink(districtId, deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Weblink deleted successfully."); fetchWeblinks(); } catch { setDeleteTarget(null); setErrorMessage("Failed to delete weblink."); } };
  const handleToggleActive = async (w: Weblink) => { try { await toggleDistrictWeblinkActive(districtId, w.id); fetchWeblinks(); } catch { setErrorMessage("Failed to toggle active status."); } };

  const filteredWeblinks = weblinks.filter((w) => { if (!searchQuery) return true; const q = searchQuery.toLowerCase(); return w.title?.toLowerCase().includes(q) || w.linkType?.toLowerCase().includes(q); });

  const getLinkTypeOptions = () => { if (currentLevel === 1) return ["None", "Page", "URL", "PDF"]; if (currentLevel === 2) return ["URL", "PDF"]; return []; };
  const formLevel = editing ? editing.level : currentLevel;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtName ? `${districtName} - Weblinks` : "Weblinks"}</h2>
              <p className="text-muted-foreground text-base">Manage weblinks and navigation</p>
            </div>
          </div>
          {canManage && <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Weblink</Button>}
        </div>

        {breadcrumb.length > 1 && (
          <div className="flex items-center gap-1 text-sm flex-wrap">
            {breadcrumb.map((item, index) => (
              <span key={index} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <button onClick={() => navigateTo(index)} className={`hover:underline ${index === breadcrumb.length - 1 ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>{item.title}</button>
              </span>
            ))}
          </div>
        )}

        {!loading && weblinks.length > 0 && <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Quick filter by title, type..." className="max-w-md" />}
        {loading && <div className="flex items-center justify-center py-20"><ListPageSkeleton /></div>}
        {!loading && weblinks.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold">No weblinks found</h3><p className="text-muted-foreground mt-2">{canManage ? 'Click "Add Weblink" to create one.' : "No weblinks available."}</p></div>}

        {!loading && filteredWeblinks.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground text-base font-semibold">S.No.</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Logo</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold">Title</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Type</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Children</TableHead>
                  <TableHead className="text-primary-foreground text-base font-semibold text-center">Active</TableHead>
                  {canManage && <TableHead className="w-12 text-primary-foreground"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWeblinks.map((w, index) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>{w.logoPath ? <img src={`${API_BASE_URL}${w.logoPath}`} alt="" className="h-10 w-10 rounded object-cover" /> : <div className="h-10 w-10 rounded bg-muted flex items-center justify-center"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>}</TableCell>
                    <TableCell>{isRowClickable(w) ? (
                      <button type="button" onClick={() => handleRowClick(w)}
                        className="font-medium text-primary hover:underline text-left"
                        title={w.childCount > 0 ? "View children" : w.linkType === "URL" ? "Open URL" : w.linkType === "PDF" ? "Open PDF" : w.youtubeUrl ? "Open YouTube" : ""}>
                        {w.title}
                      </button>
                    ) : <p className="font-medium">{w.title}</p>}</TableCell>
                    <TableCell className="text-center"><LinkTypeBadge type={w.linkType} /></TableCell>
                    <TableCell className="text-center">{w.childCount > 0 ? <Badge variant="secondary">{w.childCount}</Badge> : <span className="text-muted-foreground">0</span>}</TableCell>
                    <TableCell className="text-center"><Switch checked={w.isActive} onCheckedChange={() => handleToggleActive(w)} disabled={!canManage} /></TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {w.level < 3 && <DropdownMenuItem onClick={() => navigateInto(w)}><FolderTree className="mr-2 h-4 w-4" />View Children</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => openEditDialog(w)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(w)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}

        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setEditing(null); resetForm(); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Weblink" : "Add Weblink"}{formLevel > 1 && <span className="text-muted-foreground text-sm ml-2">(Level {formLevel})</span>}</DialogTitle>
              <DialogDescription>{editing ? "Update the weblink details below." : `Create a new level ${formLevel} weblink.`}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label htmlFor="wl-title">Title <span className="text-destructive">*</span></Label><Input id="wl-title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Weblink title" /></div>
              <div className="space-y-2"><Label>{formLevel === 1 ? "Writeup / About" : "About Weblink"}</Label><div className="min-h-[150px]"><ReactQuill theme="snow" value={formWriteup} onChange={setFormWriteup} modules={quillModules} placeholder="Enter content..." /></div></div>
              <div className="space-y-2"><Label htmlFor="wl-logo">{formLevel === 1 ? "Module Logo" : "Logo"}</Label>{editing?.logoPath && !formLogo && <div className="mb-2"><img src={`${API_BASE_URL}${editing.logoPath}`} alt="Current logo" className="h-16 w-16 rounded object-cover border" /></div>}<Input id="wl-logo" type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={(e) => setFormLogo(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>
              {formLevel === 1 && <div className="space-y-2"><Label htmlFor="wl-banner">Banner</Label>{editing?.bannerPath && !formBanner && <div className="mb-2"><img src={`${API_BASE_URL}${editing.bannerPath}`} alt="Current banner" className="h-20 w-full max-w-xs rounded object-cover border" /></div>}<Input id="wl-banner" type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={(e) => setFormBanner(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p></div>}
              {formLevel <= 2 && <div className="space-y-2"><Label>Link Type</Label><Select value={formLinkType} onValueChange={setFormLinkType}><SelectTrigger><SelectValue placeholder="Select link type" /></SelectTrigger><SelectContent>{getLinkTypeOptions().map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select></div>}
              {(formLinkType === "URL" || formLevel === 3) && <div className="space-y-2"><Label htmlFor="wl-url">URL</Label><Input id="wl-url" value={formLinkUrl} onChange={(e) => setFormLinkUrl(e.target.value)} placeholder="https://example.com" /></div>}
              {formLinkType === "PDF" && formLevel <= 2 && <div className="space-y-2"><Label htmlFor="wl-pdf">PDF File</Label><Input id="wl-pdf" type="file" accept=".pdf" onChange={(e) => setFormPdf(e.target.files?.[0] || null)} /><p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF only</p></div>}
              {formLevel === 1 && <div className="space-y-2"><Label htmlFor="wl-youtube">YouTube Video Link</Label><Input id="wl-youtube" value={formYoutubeUrl} onChange={(e) => setFormYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." /></div>}
              {formLevel >= 2 && <div className="space-y-2"><Label htmlFor="wl-button-text">Button Text</Label><Input id="wl-button-text" value={formButtonText} onChange={(e) => setFormButtonText(e.target.value)} placeholder="e.g. Read More" /></div>}
              <div className="space-y-2"><Label htmlFor="wl-sort">Sort Order</Label><Input id="wl-sort" type="number" value={formSortOrder} onChange={(e) => setFormSortOrder(Number(e.target.value))} min={0} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDialogOpen(false); setEditing(null); resetForm(); }} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Update" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Weblink"
          description={<>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This will also delete all child weblinks.</>}
          confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
