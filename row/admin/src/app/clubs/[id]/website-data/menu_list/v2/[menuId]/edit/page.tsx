"use client";

/**
 * Menu List v2 — Edit Menu (and manage its Sub-Menus).
 *
 * Extracted from the v1 inline Edit Menu / Add+Edit Sub-Menu dialogs in
 * `app/clubs/[id]/website-data/menu_list/page.tsx`. Every field, every API
 * call, every validation rule is preserved verbatim. Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section headers,
 * sticky save bar).
 *
 * Default menus are read-only at the menu-name/link-type level (the v1
 * UI hides the Edit option for `isDefault`). Sub-menus under default
 * menus CAN still be managed — that mirrors v1 behaviour (Add Sub-Menu
 * was offered on every menu, default or not).
 *
 * URL query support:
 *   ?addSub=1            — auto-open the "Add Sub-Menu" form
 *   ?editSub=<subMenuId> — auto-open the "Edit Sub-Menu" form
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";
import {
  AlertTriangle, FileText, Hash, Layers, Link2, Pencil, Plus, Settings,
  Trash2, Upload, X,
} from "@/components/icons";
import {
  createClubSubMenu,
  deleteClubSubMenu,
  getClub,
  getClubMenu,
  getClubMenus,
  getClubSubMenus,
  updateClubMenu,
  updateClubSubMenu,
  uploadMenuDocument,
  getWebsitePages,
} from "@/services/api";
import { customPageMenuOptions } from "@/lib/websiteBuilder";
import { ClubMenu, ClubSubMenu, LINK_TYPES } from "@/types/menu";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { ListPageSkeleton } from "@/components/row/AppKit";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

function getLinkTypeLabel(value: string): string {
  return LINK_TYPES.find((t) => t.value === value)?.label || value;
}

function linkTypeChipStyle(value: string): string {
  switch (value) {
    case "page": return "bg-blue-50 text-blue-700 border-blue-200";
    case "external": return "bg-slate-50 text-slate-700 border-slate-200";
    case "document": return "bg-amber-50 text-amber-700 border-amber-200";
    case "html": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default: return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

// ───────────────────────────────────────────────────────────────
// Sub-menu inline editor (Add OR Edit).
// ───────────────────────────────────────────────────────────────

interface SubMenuEditorProps {
  clubId: number;
  parentMenuId: number;
  editingSub: ClubSubMenu | null;
  defaultSortOrder: number;
  uploading: boolean;
  pageOptions: { value: string; label: string }[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>, setLinkValue: (v: string) => void) => Promise<void>;
  onSaved: (msg: string) => Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}

function SubMenuEditor({
  clubId, parentMenuId, editingSub, defaultSortOrder, uploading, pageOptions, onUpload, onSaved, onCancel, onError,
}: SubMenuEditorProps) {
  const [name, setName] = useState(editingSub?.subMenuName ?? "");
  const [linkType, setLinkType] = useState<string>(editingSub?.linkType ?? "page");
  const [linkValue, setLinkValue] = useState(editingSub?.linkValue ?? "");
  const [sortOrder, setSortOrder] = useState(editingSub?.sortOrder ?? defaultSortOrder);
  const [isActive, setIsActive] = useState(editingSub ? (editingSub.isActive ? "1" : "0") : "1");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { onError("Please enter a sub-menu name."); return; }
    if (!linkValue.trim()) {
      onError(
        linkType === "document" ? "Please upload a document."
        : linkType === "external" ? "Please enter a URL."
        : "Please select a page.");
      return;
    }
    if (linkType === "external") {
      const url = linkValue.trim();
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
      if (!ok) { onError("Please enter a valid URL starting with http:// or https:// (e.g. https://example.com)."); return; }
    }
    setSaving(true);
    try {
      if (editingSub) {
        await updateClubSubMenu(clubId, parentMenuId, editingSub.id, {
          subMenuName: name.trim(),
          linkType,
          linkValue,
          sortOrder,
          isActive: isActive === "1",
        });
        await onSaved("Sub-menu updated successfully.");
      } else {
        await createClubSubMenu(clubId, parentMenuId, {
          subMenuName: name.trim(),
          linkType,
          linkValue,
          sortOrder,
          isActive: isActive === "1",
        });
        await onSaved("Sub-menu added successfully.");
      }
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { message?: string } | string }; message?: string };
      const msg =
        (typeof ae.response?.data === "object" && ae.response?.data?.message) ||
        (typeof ae.response?.data === "string" ? ae.response.data : undefined) ||
        ae.message ||
        "Failed to save sub-menu.";
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-4 mb-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="row-h3">
          {editingSub ? "Edit Sub-Menu" : "New Sub-Menu"}
        </h4>
        <IconButton
          type="button"
          onClick={onCancel}
           aria-label="Close sub-menu editor">
          <X size={12} />
        </IconButton>
      </div>
      <div className="space-y-3">
        <div>
          <FieldLabel required>Sub-Menu Name</FieldLabel>
          <Input
            type="text"
            placeholder="Enter sub-menu name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            
            autoFocus
          />
        </div>
        <div>
          <FieldLabel required>Link Type</FieldLabel>
          <NativeSelect
            value={linkType}
            onChange={(e) => { setLinkType(e.target.value); setLinkValue(""); }}
            
          >
            {/* Sub-menus exclude `html` (rich-text) — only top-level menus get that option in v1. */}
            {LINK_TYPES.filter((t) => t.value !== "html").map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </NativeSelect>
        </div>
        {linkType === "document" ? (
          <div>
            <FieldLabel required>Document</FieldLabel>
            {linkValue ? (
              <div className="flex items-center gap-2 p-2 border border-slate-200 rounded-md bg-card">
                <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
                <span className="text-sm truncate flex-1 text-slate-700">{linkValue.split("/").pop()}</span>
                <IconButton
                  type="button"
                  onClick={() => setLinkValue("")}
                   aria-label="Remove document">
                  <X size={12} />
                </IconButton>
              </div>
            ) : (
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={(e) => onUpload(e, setLinkValue)}
                  disabled={uploading}
                />
                <div className="flex items-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-md hover:border-blue-300 transition-colors bg-card">
                  <Upload className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-500">
                    {uploading ? "Uploading…" : "Click to upload document"}
                  </span>
                </div>
              </label>
            )}
            <p className="text-[11px] text-slate-500 mt-1.5">
              Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX (max 10 MB)
            </p>
          </div>
        ) : linkType === "page" ? (
          <div>
            <FieldLabel required>Page</FieldLabel>
            <NativeSelect
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              
            >
              <option value="">Select an existing page…</option>
              {pageOptions.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </NativeSelect>
            <p className="text-[11px] text-slate-500 mt-1.5">Links this sub-menu to an existing website page.</p>
          </div>
        ) : (
          <div>
            <FieldLabel required>URL</FieldLabel>
            <Input
              type="url"
              inputMode="url"
              placeholder="https://example.com/page"
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              
            />
            <p className="text-[11px] text-slate-500 mt-1.5">Must be a full URL starting with <code>http://</code> or <code>https://</code>.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Sort Order</FieldLabel>
            <Input
              type="number"
              min={1}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              
            />
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <NativeSelect
              value={isActive}
              onChange={(e) => setIsActive(e.target.value)}
              
            >
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            onClick={onCancel}
            disabled={saving}
            variant="outline" size="sm"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            size="sm"
          >
            {saving ? "Saving…" : editingSub ? "Update Sub-Menu" : "Add Sub-Menu"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Main page.
// ───────────────────────────────────────────────────────────────

export default function MenuListV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const menuId = Number(params.menuId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/menu_list/v2`);

  const addSubFromQuery = searchParams.get("addSub") === "1";
  const editSubFromQuery = searchParams.get("editSub");
  const initialEditSubId = editSubFromQuery ? Number(editSubFromQuery) : null;

  const [clubName, setClubName] = useState("");
  const [menu, setMenu] = useState<ClubMenu | null>(null);
  const [subMenus, setSubMenus] = useState<ClubSubMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Menu form fields — same names as v1 dialog.
  const [formName, setFormName] = useState("");
  const [formLinkType, setFormLinkType] = useState<string>("page");
  const [formLinkValue, setFormLinkValue] = useState("");
  const [formContentHtml, setFormContentHtml] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(1);
  const [formIsActive, setFormIsActive] = useState("1");
  // Existing website pages a "Page" link (menu or sub-menu) can point at.
  const [pageOptions, setPageOptions] = useState<{ value: string; label: string }[]>([]);

  // Sub-menu editor state
  const [subEditorOpen, setSubEditorOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<ClubSubMenu | null>(null);

  const [deleteSubTarget, setDeleteSubTarget] = useState<ClubSubMenu | null>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const refreshSubMenus = useCallback(async () => {
    try {
      const data = await getClubSubMenus(clubId, menuId);
      setSubMenus(data);
    } catch {
      // ignore — caller already surfaces errors
    }
  }, [clubId, menuId]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, m, subs, allMenus, sitePages] = await Promise.all([
          getClub(clubId),
          getClubMenu(clubId, menuId),
          getClubSubMenus(clubId, menuId),
          getClubMenus(clubId),
          getWebsitePages("clubs", clubId).catch(() => []),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setMenu(m);
        setSubMenus(subs);
        // Default pages plus published custom pages from Pages and Layout (website builder).
        setPageOptions([
          ...allMenus.filter((x) => x.isDefault && x.linkValue)
                  .map((x) => ({ value: x.linkValue, label: x.menuName })),
          ...customPageMenuOptions(sitePages),
        ]);

        setFormName(m.menuName);
        setFormLinkType(m.linkType);
        setFormLinkValue(m.linkValue);
        setFormContentHtml(m.contentHtml || "");
        setFormSortOrder(m.sortOrder);
        setFormIsActive(m.isActive ? "1" : "0");

        // Auto-open sub-menu editor from URL params.
        if (addSubFromQuery) {
          setEditingSub(null);
          setSubEditorOpen(true);
        } else if (initialEditSubId) {
          const found = subs.find((s) => s.id === initialEditSubId);
          if (found) {
            setEditingSub(found);
            setSubEditorOpen(true);
          }
        }
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to load menu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, menuId, addSubFromQuery, initialEditSubId]);

  const handleMenuFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadMenuDocument(clubId, file);
      setFormLinkValue(result.path);
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { message?: string } | string } };
      const msg = (typeof ae.response?.data === "object" && ae.response?.data?.message)
        || (typeof ae.response?.data === "string" ? ae.response.data : undefined)
        || "Failed to upload document.";
      setErrorMessage(msg);
    } finally {
      setUploading(false);
    }
    e.target.value = "";
  };

  const handleSubFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, setLinkValue: (v: string) => void) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const result = await uploadMenuDocument(clubId, file);
        setLinkValue(result.path);
      } catch (err: unknown) {
        const ae = err as { response?: { data?: { message?: string } | string } };
        const msg = (typeof ae.response?.data === "object" && ae.response?.data?.message)
          || (typeof ae.response?.data === "string" ? ae.response.data : undefined)
          || "Failed to upload document.";
        setErrorMessage(msg);
      } finally {
        setUploading(false);
      }
      e.target.value = "";
    },
    [clubId]
  );

  const handleSaveMenu = async () => {
    if (!menu) return;
    if (menu.isDefault) {
      // For default menus, only sub-menu management is allowed — the main
      // menu fields are read-only. Skip and just navigate away.
      navigateAfterSave();
      return;
    }
    if (!formName.trim()) { setErrorMessage("Please enter a menu name."); return; }
    if (formLinkType !== "html" && !formLinkValue.trim()) {
      setErrorMessage(
        formLinkType === "document" ? "Please upload a document."
        : formLinkType === "external" ? "Please enter a URL."
        : "Please select a page.");
      return;
    }
    if (formLinkType === "external") {
      const url = formLinkValue.trim();
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
      if (!ok) { setErrorMessage("Please enter a valid URL starting with http:// or https:// (e.g. https://example.com)."); return; }
    }
    if (formLinkType === "html" && !formContentHtml.trim()) {
      setErrorMessage("Please enter the page content.");
      return;
    }

    setSaving(true);
    try {
      await updateClubMenu(clubId, menu.id, {
        menuName: formName.trim(),
        linkType: formLinkType,
        linkValue: formLinkType === "html" ? "" : formLinkValue,
        contentHtml: formLinkType === "html" ? formContentHtml : null,
        sortOrder: formSortOrder,
        isActive: formIsActive === "1",
      });
      setSuccessMessage("Menu updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { message?: string } | string }; message?: string };
      const msg =
        (typeof ae.response?.data === "object" && ae.response?.data?.message) ||
        (typeof ae.response?.data === "string" ? ae.response.data : undefined) ||
        ae.message ||
        "Failed to save.";
      setErrorMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSub = async () => {
    if (!deleteSubTarget) return;
    try {
      await deleteClubSubMenu(clubId, deleteSubTarget.menuId, deleteSubTarget.id);
      setSuccessMessage("Sub-menu deleted successfully.");
      await refreshSubMenus();
      setDeleteSubTarget(null);
    } catch {
      setDeleteSubTarget(null);
      setErrorMessage("Failed to delete sub-menu.");
    }
  };

  const quillModules = useMemo(() => ({
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ["bold", "italic", "underline", "strike"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link", "image"],
      ["clean"],
    ],
  }), []);

  if (loading || !menu) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Menu Item"
          pageSubtitle="Manage an existing menu entry"
          activeNavHref="/club-admin-dashboard/my-club-website"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  const isDefault = !!menu.isDefault;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Menu Item"
        pageSubtitle="Manage an existing menu entry"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title={subEditorOpen
          ? (editingSub ? "Edit Sub-Menu" : "Add Sub-Menu")
          : (isDefault ? "Manage Default Menu" : "Edit Menu")}
        subtitle={`${menu.menuName} · ${clubName}`}
        defaultBack={`/clubs/${clubId}/website-data/menu_list/v2`}
        saving={saving}
        saveLabel={isDefault ? "Done" : "Save Menu"}
        onSave={handleSaveMenu}
        hideFooter={subEditorOpen}
        banner={
          subEditorOpen ? undefined : isDefault ? (
            <span>
              <strong className="font-semibold text-slate-700">Default menu:</strong>{" "}
              Name and link type are system-managed and cannot be edited. You can still
              add, edit, and remove sub-menus under this menu below.
            </span>
          ) : undefined
        }
      >
        {/* Parent menu — a read-only summary for DEFAULT menus (their fields are system-managed),
            hidden entirely while adding/editing a sub-menu so only the sub-menu form shows. */}
        {!subEditorOpen && isDefault && (
          <SectionCard number={1} icon={FileText} title="Menu">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{menu.menuName}</span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${linkTypeChipStyle(menu.linkType)}`}>
                {getLinkTypeLabel(menu.linkType)}
              </span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${menu.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                {menu.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">System-managed default menu: manage its sub-menus below.</p>
          </SectionCard>
        )}

        {/* Editable parent-menu fields — only for CUSTOM menus, and not while editing a sub-menu. */}
        {!subEditorOpen && !isDefault && (
        <>
        {/* 1. Identity */}
        <SectionCard number={1} icon={FileText} title="Menu Identity">
          <FieldLabel required>Menu Name</FieldLabel>
          <Input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            disabled={isDefault}
            className="disabled:bg-slate-50 disabled:text-slate-500"
          />
        </SectionCard>

        {/* 2. Link target */}
        <SectionCard number={2} icon={Link2} title="Link Target">
          <FieldLabel required>Link Type</FieldLabel>
          <NativeSelect
            value={formLinkType}
            onChange={(e) => { setFormLinkType(e.target.value); setFormLinkValue(""); setFormContentHtml(""); }}
            disabled={isDefault}
            className="mb-4 disabled:bg-slate-50 disabled:text-slate-500"
          >
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </NativeSelect>

          {formLinkType === "html" && (
            <div>
              <FieldLabel required>Content</FieldLabel>
              {isDefault ? (
                <div
                  className="prose prose-sm max-w-none border border-slate-200 rounded-lg p-3 bg-slate-50"
                  dangerouslySetInnerHTML={{ __html: formContentHtml || "<p class='text-slate-400'>(empty)</p>" }}
                />
              ) : (
                <>
                  <ReactQuill
                    theme="snow"
                    value={formContentHtml}
                    onChange={setFormContentHtml}
                    placeholder="Write the page content…"
                    modules={quillModules}
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    This content will render as a standalone page on the public site.
                  </p>
                </>
              )}
            </div>
          )}

          {formLinkType === "document" && (
            <div>
              <FieldLabel required>Document</FieldLabel>
              {formLinkValue ? (
                <div className="flex items-center gap-2 p-2 border border-slate-200 rounded-md bg-slate-50">
                  <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  <span className="text-sm truncate flex-1 text-slate-700">{formLinkValue.split("/").pop()}</span>
                  {!isDefault && (
                    <IconButton
                      type="button"
                      onClick={() => setFormLinkValue("")}
                       aria-label="Remove document">
                      <X size={12} />
                    </IconButton>
                  )}
                </div>
              ) : !isDefault ? (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    onChange={handleMenuFileUpload}
                    disabled={uploading}
                  />
                  <div className="flex items-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-md hover:border-blue-300 transition-colors">
                    <Upload className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-slate-500">
                      {uploading ? "Uploading…" : "Click to upload document"}
                    </span>
                  </div>
                </label>
              ) : (
                <p className="text-sm text-slate-400">No document uploaded.</p>
              )}
              {!isDefault && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX (max 10 MB)
                </p>
              )}
            </div>
          )}

          {formLinkType === "page" && (
            <div>
              <FieldLabel required>Page</FieldLabel>
              <NativeSelect
                value={formLinkValue}
                onChange={(e) => setFormLinkValue(e.target.value)}
                disabled={isDefault}
                className="disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">Select an existing page…</option>
                {pageOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-slate-500 mt-1.5">Links this menu to one of your website&apos;s existing pages.</p>
            </div>
          )}

          {formLinkType === "external" && (
            <div>
              <FieldLabel required>URL</FieldLabel>
              <Input
                type="url"
                inputMode="url"
                placeholder="https://example.com/page"
                value={formLinkValue}
                onChange={(e) => setFormLinkValue(e.target.value)}
                disabled={isDefault}
                className="disabled:bg-slate-50 disabled:text-slate-500"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">Must be a full URL starting with <code>http://</code> or <code>https://</code>.</p>
            </div>
          )}
        </SectionCard>

        {/* 3. Display */}
        <SectionCard number={3} icon={Settings} title="Display">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel><Hash className="h-3 w-3 inline-block mr-0.5 -mt-0.5" />Sort Order</FieldLabel>
              <Input
                type="number"
                min={1}
                value={formSortOrder}
                onChange={(e) => setFormSortOrder(Number(e.target.value))}
                disabled={isDefault}
                className="disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <NativeSelect
                value={formIsActive}
                onChange={(e) => setFormIsActive(e.target.value)}
                disabled={isDefault}
                className="disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </NativeSelect>
            </div>
          </div>
        </SectionCard>

        </>
        )}

        {/* Sub-menus — a FOCUSED editor while adding/editing (parent fields hidden above),
            otherwise the sub-menu list with a clear Add button. */}
        {subEditorOpen ? (
          <SectionCard number={1} icon={Layers} title={editingSub ? "Edit Sub-Menu" : "Add Sub-Menu"}>
            <p className="text-xs text-slate-500 mb-3">
              Under <span className="font-semibold text-slate-700">{menu.menuName}</span>
            </p>
            <SubMenuEditor
              clubId={clubId}
              parentMenuId={menuId}
              editingSub={editingSub}
              defaultSortOrder={subMenus.length + 1}
              uploading={uploading}
              pageOptions={pageOptions}
              onUpload={handleSubFileUpload}
              onSaved={async (msg) => {
                setSuccessMessage(msg);
                await refreshSubMenus();
                setSubEditorOpen(false);
                setEditingSub(null);
              }}
              onCancel={() => { setSubEditorOpen(false); setEditingSub(null); }}
              onError={(msg) => setErrorMessage(msg)}
            />
          </SectionCard>
        ) : (
          <SectionCard
            number={isDefault ? 2 : 4}
            icon={Layers}
            title="Sub-Menus"
            action={
              <Button
                type="button"
                onClick={() => { setEditingSub(null); setSubEditorOpen(true); }}
                size="sm"
              >
                <Plus size={12} /> Add Sub-Menu
              </Button>
            }
          >
          {subMenus.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No sub-menus under this menu yet.
            </p>
          ) : (
            <Card className="overflow-hidden">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-8">Sr</TableHead>
                    <TableHead className="text-left">Sub-Menu Name</TableHead>
                    <TableHead className="text-left w-32">Link Type</TableHead>
                    <TableHead className="text-left w-24">Status</TableHead>
                    <TableHead className="text-right w-16">Edit</TableHead>
                    <TableHead className="text-right w-16">Delete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subMenus.map((sub, idx) => (
                    <TableRow key={sub.id}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell className="font-medium">
                        {sub.subMenuName}
                        {sub.isSystemManaged && (
                          <span className="ml-2 inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-200">
                            System
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${linkTypeChipStyle(sub.linkType)}`}>
                          {getLinkTypeLabel(sub.linkType)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${
                          sub.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"
                        }`}>
                          {sub.isActive ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {!sub.isSystemManaged ? (
                          <IconButton
                            type="button"
                            onClick={() => { setEditingSub(sub); setSubEditorOpen(true); }}
                             aria-label="Edit sub-menu"
                            title="Edit"
                          >
                            <Pencil size={13} />
                          </IconButton>
                        ) : (
                          <span className="text-slate-300 text-xs">–</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!sub.isSystemManaged ? (
                          <IconButton
                            type="button"
                            onClick={() => setDeleteSubTarget(sub)}
                            className="hover:text-red-700"
                            aria-label="Delete sub-menu"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        ) : (
                          <span className="text-slate-300 text-xs">–</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          </SectionCard>
        )}

        <AlertModal
          open={!!deleteSubTarget}
          onOpenChange={(o) => !o && setDeleteSubTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Sub-Menu"
          description={
            <>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">{deleteSubTarget?.subMenuName}</span>?
              {" "}This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDeleteSub}
          cancelLabel="Cancel"
          onCancel={() => setDeleteSubTarget(null)}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Menu updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        {/* Non-blocking success for sub-menu actions (don't navigate away). */}
        <SuccessAlert
          open={!!successMessage && !showSuccessDialog}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
