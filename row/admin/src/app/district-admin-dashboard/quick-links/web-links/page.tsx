"use client";

/**
 * V2 — Web Links listing under the District Admin dashboard shell.
 * ---------------------------------------------------------------------------
 * Additive port of V1 (src/app/districts/[id]/weblinks/page.tsx) with the DA
 * shell conventions:
 *   - districtId from useAuth().selectedDistrictId (no /districts/[id] param).
 *   - Folder-tree navigation is URL-driven via ?parentId= (V1 kept it in local
 *     state). Root level = no parentId. Breadcrumb is built from the tree
 *     endpoint so a deep-linked ?parentId still shows the full path.
 *   - Add / Edit navigate to dedicated pages (V1 used inline dialogs), passing
 *     returnTo=<current full listing URL> + parentId + yearId.
 *   - Back honours ?returnTo=; from inside a folder it first pops one level up
 *     the tree, else falls back to the Quick Links landing.
 *   - Web Links are NOT year-wise (same as V1) — yearId is only forwarded so
 *     the shell top-bar year picker stays in sync; never filtered on.
 *   - Palette: navy #1e3a5f / gold #F7A81B / slate tokens; rounded-2xl cards.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Weblink, WeblinkTree } from "@/types/weblink";
import {
  getDistrictWeblinks,
  getDistrictWeblinkTree,
  deleteDistrictWeblink,
  toggleDistrictWeblinkActive,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import SearchBox from "@/components/SearchBox";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen,
  AlertTriangle, ChevronRight, ChevronDown, Link2, Folder, ExternalLink,
} from "lucide-react";

const WEB_LINKS_BASE = "/district-admin-dashboard/quick-links/web-links";

function withSearch(base: string, extra: Record<string, string | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

// Walk the weblink tree to the node with `id`, returning the ordered path
// (root → node). Empty when not found.
function buildPath(nodes: WeblinkTree[], id: number): WeblinkTree[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const sub = buildPath(n.children || [], id);
    if (sub.length) return [n, ...sub];
  }
  return [];
}

function TypeBadge({ w }: { w: Weblink }) {
  const isFolder = w.childCount > 0;
  const type = isFolder ? "Folder" : w.linkType;
  const colors: Record<string, string> = {
    Folder: "border-amber-200 bg-amber-50 text-amber-700",
    None: "border-slate-200 bg-slate-50 text-slate-600",
    Page: "border-blue-200 bg-blue-50 text-blue-700",
    URL: "border-emerald-200 bg-emerald-50 text-emerald-700",
    PDF: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[type] || colors.None}`}>
      {type}
    </span>
  );
}

function targetText(w: Weblink): string {
  if (w.childCount > 0) return "-";
  if (w.linkType === "URL" && w.linkUrl) return w.linkUrl;
  if (w.linkType === "PDF" && w.pdfPath) return w.pdfPath.split("/").pop() || w.pdfPath;
  if (w.youtubeUrl) return w.youtubeUrl;
  return "-";
}

export default function DistrictAdminWebLinksPage() {
  const { selectedDistrictId, isSuperAdmin, isAdmin } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnTo = searchParams.get("returnTo");
  const yearId = searchParams.get("yearId");
  const parentIdParam = searchParams.get("parentId");
  const parentId = parentIdParam ? Number(parentIdParam) : null;

  const canManage = isSuperAdmin || isAdmin;

  const [weblinks, setWeblinks] = useState<Weblink[]>([]);
  const [tree, setTree] = useState<WeblinkTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Weblink | null>(null);

  // The current full listing URL — handed to add/edit as returnTo so the whole
  // escape chain (returnTo, parentId, yearId) is preserved.
  const currentListingUrl = withSearch(WEB_LINKS_BASE, {
    parentId: parentIdParam,
    returnTo,
    yearId,
  });

  const breadcrumb = parentId ? buildPath(tree, parentId) : [];

  const fetchWeblinks = useCallback(async () => {
    if (!districtId) return;
    setLoading(true);
    try {
      const result = await getDistrictWeblinks(districtId, parentId ?? undefined);
      setWeblinks(result);
    } catch {
      setWeblinks([]);
      setErrorMessage("Failed to load web links.");
    } finally {
      setLoading(false);
    }
  }, [districtId, parentId]);

  const fetchTree = useCallback(async () => {
    if (!districtId) return;
    try { setTree(await getDistrictWeblinkTree(districtId)); }
    catch { setTree([]); }
  }, [districtId]);

  useEffect(() => { fetchWeblinks(); }, [fetchWeblinks]);
  useEffect(() => { fetchTree(); }, [fetchTree]);
  useEffect(() => { setSearchQuery(""); }, [parentIdParam]);

  const navTo = (pid: number | null) =>
    router.push(withSearch(WEB_LINKS_BASE, { parentId: pid ? String(pid) : undefined, returnTo, yearId }));

  const goBack = () => {
    if (parentId) {
      const path = buildPath(tree, parentId);
      const parentNode = path.length >= 2 ? path[path.length - 2] : null;
      navTo(parentNode ? parentNode.id : null);
      return;
    }
    router.push(returnTo || withSearch("/district-admin-dashboard/quick-links", { yearId }));
  };

  const goAdd = () =>
    router.push(withSearch(`${WEB_LINKS_BASE}/add`, {
      parentId: parentIdParam,
      returnTo: currentListingUrl,
      yearId,
    }));

  const goEdit = (w: Weblink) =>
    router.push(withSearch(`${WEB_LINKS_BASE}/${w.id}/edit`, {
      parentId: parentIdParam,
      returnTo: currentListingUrl,
      yearId,
    }));

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDistrictWeblink(districtId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Web link deleted successfully.");
      fetchWeblinks();
      fetchTree();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete web link.");
    }
  };

  const handleToggleActive = async (w: Weblink) => {
    try {
      await toggleDistrictWeblinkActive(districtId, w.id);
      fetchWeblinks();
    } catch { setErrorMessage("Failed to toggle active status."); }
  };

  const filtered = weblinks.filter((w) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return w.title?.toLowerCase().includes(q) || w.linkType?.toLowerCase().includes(q);
  });
  const isSearching = searchQuery.trim() !== "";

  const openTarget = (w: Weblink) => {
    if (w.linkType === "URL" && w.linkUrl) { window.open(w.linkUrl, "_blank", "noopener,noreferrer"); return; }
    if (w.youtubeUrl) { window.open(w.youtubeUrl, "_blank", "noopener,noreferrer"); return; }
  };

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f]">
                <Link2 size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-800 leading-tight">Web Links</h1>
                {breadcrumb.length > 0 ? (
                  <div className="mt-1 flex items-center gap-1 flex-wrap text-xs">
                    <button onClick={() => navTo(null)} className="text-slate-500 hover:text-[#1e3a5f] hover:underline">Home</button>
                    {breadcrumb.map((item, index) => (
                      <span key={item.id} className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3 text-slate-400" />
                        <button
                          onClick={() => navTo(item.id)}
                          className={index === breadcrumb.length - 1
                            ? "font-semibold text-[#1e3a5f]"
                            : "text-slate-500 hover:text-[#1e3a5f] hover:underline"}
                        >
                          {item.title}
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">Manage web links and folder navigation</p>
                )}
              </div>
            </div>
          </div>
          {canManage && (
            <Button onClick={goAdd} className="bg-[#1e3a5f] hover:bg-[#152a44] text-white shrink-0">
              <Plus className="mr-2 h-4 w-4" />Add Link
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && weblinks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <FolderOpen className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No web links here</h3>
            <p className="text-slate-500 mt-2 text-sm">
              {canManage ? 'Click "Add Link" to create one.' : "No web links available."}
            </p>
          </div>
        )}

        {!loading && weblinks.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Quick filter by title, type..."
              className="max-w-md"
            />

            {filtered.length === 0 && isSearching ? (
              <p className="text-slate-500 text-sm py-8 text-center">
                No results found for &quot;{searchQuery}&quot;
              </p>
            ) : (
              <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:opacity-100 border-b-2 border-[#F7A81B]" style={{ backgroundColor: "#1e3a5f" }}>
                      <TableHead className="w-12 text-white text-xs font-semibold uppercase tracking-wide">#</TableHead>
                      <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Title</TableHead>
                      <TableHead className="w-28 text-white text-xs font-semibold uppercase tracking-wide">Type</TableHead>
                      <TableHead className="text-white text-xs font-semibold uppercase tracking-wide">Target</TableHead>
                      <TableHead className="w-24 text-white text-xs font-semibold uppercase tracking-wide text-center">Status</TableHead>
                      {canManage && <TableHead className="w-12 text-white/90"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((w, index) => {
                      const isFolder = w.childCount > 0;
                      const isUrl = (w.linkType === "URL" && !!w.linkUrl) || !!w.youtubeUrl;
                      return (
                        <TableRow key={w.id} className="hover:bg-slate-50/70 transition-colors border-slate-100">
                          <TableCell className="font-medium text-slate-500">{index + 1}</TableCell>
                          <TableCell className="font-semibold text-slate-800">
                            {isFolder ? (
                              <button
                                type="button"
                                onClick={() => navTo(w.id)}
                                className="inline-flex items-center gap-2 text-[#1e3a5f] hover:underline text-left"
                                title="Open folder"
                              >
                                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                                {w.title}
                                <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-slate-400" />
                              </button>
                            ) : isUrl ? (
                              <button
                                type="button"
                                onClick={() => openTarget(w)}
                                className="inline-flex items-center gap-2 text-[#1e3a5f] hover:underline text-left"
                                title="Open link"
                              >
                                {w.title}
                                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                              </button>
                            ) : (
                              <span>{w.title}</span>
                            )}
                          </TableCell>
                          <TableCell><TypeBadge w={w} /></TableCell>
                          <TableCell className="max-w-xs">
                            <span className="text-sm text-slate-600 truncate block" title={targetText(w)}>
                              {targetText(w)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={w.isActive}
                              onCheckedChange={() => handleToggleActive(w)}
                              disabled={!canManage}
                            />
                          </TableCell>
                          {canManage && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {isFolder && (
                                    <DropdownMenuItem onClick={() => navTo(w.id)}>
                                      <FolderOpen className="mr-2 h-4 w-4" />Open Folder
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => goEdit(w)}>
                                    <Pencil className="mr-2 h-4 w-4" />Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={() => setDeleteTarget(w)}>
                                    <Trash2 className="mr-2 h-4 w-4" />Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-red-500"
          title="Delete Web Link"
          description={
            <>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-slate-800">{deleteTarget?.title}</span>?
              This will also delete all child links.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
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
