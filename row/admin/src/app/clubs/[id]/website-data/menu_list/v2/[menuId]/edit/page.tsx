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
} from "@/services/api";
import { ClubMenu, ClubSubMenu, LINK_TYPES } from "@/types/menu";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

function FieldLabel({
  children, hint, dot, required = false,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children, action,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 mb-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800 flex-1">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function getLinkTypeLabel(value: string): string {
  return LINK_TYPES.find((t) => t.value === value)?.label || value;
}

function linkTypeChipStyle(value: string): string {
  switch (value) {
    case "page": return "bg-blue-50 text-blue-700 border-blue-200";
    case "external": return "bg-violet-50 text-violet-700 border-violet-200";
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
        <h4 className="text-sm font-semibold text-slate-800">
          {editingSub ? "Edit Sub-Menu" : "New Sub-Menu"}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
          aria-label="Close sub-menu editor"
        >
          <X size={12} />
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <FieldLabel dot="bg-blue-500" required>Sub-Menu Name</FieldLabel>
          <input
            type="text"
            placeholder="Enter sub-menu name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            autoFocus
          />
        </div>
        <div>
          <FieldLabel dot="bg-violet-500" required>Link Type</FieldLabel>
          <select
            value={linkType}
            onChange={(e) => { setLinkType(e.target.value); setLinkValue(""); }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {/* Sub-menus exclude `html` (rich-text) — only top-level menus get that option in v1. */}
            {LINK_TYPES.filter((t) => t.value !== "html").map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        {linkType === "document" ? (
          <div>
            <FieldLabel dot="bg-amber-500" required>Document</FieldLabel>
            {linkValue ? (
              <div className="flex items-center gap-2 p-2 border border-slate-200 rounded-md bg-white">
                <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
                <span className="text-sm truncate flex-1 text-slate-700">{linkValue.split("/").pop()}</span>
                <button
                  type="button"
                  onClick={() => setLinkValue("")}
                  className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                  aria-label="Remove document"
                >
                  <X size={12} />
                </button>
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
                <div className="flex items-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-md hover:border-blue-300 transition-colors bg-white">
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
            <FieldLabel dot="bg-blue-500" required>Page</FieldLabel>
            <select
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Select an existing page…</option>
              {pageOptions.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">Links this sub-menu to an existing website page.</p>
          </div>
        ) : (
          <div>
            <FieldLabel dot="bg-blue-500" required>URL</FieldLabel>
            <input
              type="url"
              inputMode="url"
              placeholder="https://example.com/page"
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">Must be a full URL starting with <code>http://</code> or <code>https://</code>.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel dot="bg-emerald-500">Sort Order</FieldLabel>
            <input
              type="number"
              min={1}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <div>
            <FieldLabel dot="bg-emerald-500">Status</FieldLabel>
            <select
              value={isActive}
              onChange={(e) => setIsActive(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : editingSub ? "Update Sub-Menu" : "Add Sub-Menu"}
          </button>
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
        const [club, m, subs, allMenus] = await Promise.all([
          getClub(clubId),
          getClubMenu(clubId, menuId),
          getClubSubMenus(clubId, menuId),
          getClubMenus(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setMenu(m);
        setSubMenus(subs);
        setPageOptions(
          allMenus.filter((x) => x.isDefault && x.linkValue)
                  .map((x) => ({ value: x.linkValue, label: x.menuName })),
        );

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
            <RotaryLoader size="lg" />
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
          <SectionCard number={1} icon={FileText} title="Menu" dot="bg-blue-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{menu.menuName}</span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${linkTypeChipStyle(menu.linkType)}`}>
                {getLinkTypeLabel(menu.linkType)}
              </span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${menu.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
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
        <SectionCard number={1} icon={FileText} title="Menu Identity" dot="bg-blue-600">
          <FieldLabel dot="bg-blue-500" required>Menu Name</FieldLabel>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            disabled={isDefault}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
          />
        </SectionCard>

        {/* 2. Link target */}
        <SectionCard number={2} icon={Link2} title="Link Target" dot="bg-violet-600">
          <FieldLabel dot="bg-violet-500" required>Link Type</FieldLabel>
          <select
            value={formLinkType}
            onChange={(e) => { setFormLinkType(e.target.value); setFormLinkValue(""); setFormContentHtml(""); }}
            disabled={isDefault}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white mb-4 disabled:bg-slate-50 disabled:text-slate-500"
          >
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {formLinkType === "html" && (
            <div>
              <FieldLabel dot="bg-emerald-500" required>Content</FieldLabel>
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
              <FieldLabel dot="bg-amber-500" required>Document</FieldLabel>
              {formLinkValue ? (
                <div className="flex items-center gap-2 p-2 border border-slate-200 rounded-md bg-slate-50">
                  <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  <span className="text-sm truncate flex-1 text-slate-700">{formLinkValue.split("/").pop()}</span>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => setFormLinkValue("")}
                      className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                      aria-label="Remove document"
                    >
                      <X size={12} />
                    </button>
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
              <FieldLabel dot="bg-blue-500" required>Page</FieldLabel>
              <select
                value={formLinkValue}
                onChange={(e) => setFormLinkValue(e.target.value)}
                disabled={isDefault}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">Select an existing page…</option>
                {pageOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">Links this menu to one of your website&apos;s existing pages.</p>
            </div>
          )}

          {formLinkType === "external" && (
            <div>
              <FieldLabel dot="bg-blue-500" required>URL</FieldLabel>
              <input
                type="url"
                inputMode="url"
                placeholder="https://example.com/page"
                value={formLinkValue}
                onChange={(e) => setFormLinkValue(e.target.value)}
                disabled={isDefault}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">Must be a full URL starting with <code>http://</code> or <code>https://</code>.</p>
            </div>
          )}
        </SectionCard>

        {/* 3. Display */}
        <SectionCard number={3} icon={Settings} title="Display" dot="bg-emerald-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-emerald-500"><Hash className="h-3 w-3 inline-block mr-0.5 -mt-0.5" />Sort Order</FieldLabel>
              <input
                type="number"
                min={1}
                value={formSortOrder}
                onChange={(e) => setFormSortOrder(Number(e.target.value))}
                disabled={isDefault}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Status</FieldLabel>
              <select
                value={formIsActive}
                onChange={(e) => setFormIsActive(e.target.value)}
                disabled={isDefault}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
        </SectionCard>

        </>
        )}

        {/* Sub-menus — a FOCUSED editor while adding/editing (parent fields hidden above),
            otherwise the sub-menu list with a clear Add button. */}
        {subEditorOpen ? (
          <SectionCard number={1} icon={Layers} title={editingSub ? "Edit Sub-Menu" : "Add Sub-Menu"} dot="bg-amber-600">
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
            dot="bg-amber-600"
            action={
              <button
                type="button"
                onClick={() => { setEditingSub(null); setSubEditorOpen(true); }}
                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus size={12} /> Add Sub-Menu
              </button>
            }
          >
          {subMenus.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No sub-menus under this menu yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left w-8">Sr</th>
                    <th className="px-3 py-2 text-left">Sub-Menu Name</th>
                    <th className="px-3 py-2 text-left w-32">Link Type</th>
                    <th className="px-3 py-2 text-left w-24">Status</th>
                    <th className="px-3 py-2 text-right w-16">Edit</th>
                    <th className="px-3 py-2 text-right w-16">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subMenus.map((sub, idx) => (
                    <tr key={sub.id} className="hover:bg-blue-50/30">
                      <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {sub.subMenuName}
                        {sub.isSystemManaged && (
                          <span className="ml-2 inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                            System
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${linkTypeChipStyle(sub.linkType)}`}>
                          {getLinkTypeLabel(sub.linkType)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${
                          sub.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"
                        }`}>
                          {sub.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!sub.isSystemManaged ? (
                          <button
                            type="button"
                            onClick={() => { setEditingSub(sub); setSubEditorOpen(true); }}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                            aria-label="Edit sub-menu"
                            title="Edit"
                          >
                            <Pencil size={13} />
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">, </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!sub.isSystemManaged ? (
                          <button
                            type="button"
                            onClick={() => setDeleteSubTarget(sub)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                            aria-label="Delete sub-menu"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">, </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
