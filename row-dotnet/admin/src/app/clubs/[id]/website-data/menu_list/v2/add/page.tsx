"use client";

/**
 * Menu List v2 — Add Custom Menu.
 *
 * Extracted from the v1 inline Add Menu dialog in
 * `app/clubs/[id]/website-data/menu_list/page.tsx`. Every field, every API
 * call, every validation rule is preserved verbatim. Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section headers,
 * sticky save bar).
 *
 * Add page is for top-level CUSTOM menus only — sub-menus are managed
 * from the parent menu's Edit page. The 8 default menus are seeded by
 * the API and cannot be added here.
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";
import { FileText, Hash, Link2, Settings, Upload, X } from "lucide-react";
import {
  createClubMenu,
  getClub,
  getClubMenus,
  uploadMenuDocument,
} from "@/services/api";
import { LINK_TYPES } from "@/types/menu";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
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
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 mb-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function MenuListV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/menu_list/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form fields — same names as v1 dialog.
  const [formName, setFormName] = useState("");
  const [formLinkType, setFormLinkType] = useState<string>("page");
  const [formLinkValue, setFormLinkValue] = useState("");
  const [formContentHtml, setFormContentHtml] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(1);
  const [formIsActive, setFormIsActive] = useState("1");

  const [customMenuExists, setCustomMenuExists] = useState(false);
  // Existing website pages a "Page" menu can point at (the club's seeded default pages).
  const [pageOptions, setPageOptions] = useState<{ value: string; label: string }[]>([]);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, menus] = await Promise.all([
          getClub(clubId),
          getClubMenus(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        const custom = menus.filter((m) => !m.isDefault).length;
        setCustomMenuExists(custom >= 1);
        // "Page" link type can only point at an EXISTING website page — offer the club's
        // seeded default pages (value = link_value, label = menu name).
        setPageOptions(
          menus.filter((m) => m.isDefault && m.linkValue)
               .map((m) => ({ value: m.linkValue, label: m.menuName })),
        );
        // Default sort order = end of list
        setFormSortOrder(menus.length + 1);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleSave = async () => {
    if (!formName.trim()) { setErrorMessage("Please enter a menu name."); return; }
    if (formLinkType !== "html" && !formLinkValue.trim()) {
      setErrorMessage(
        formLinkType === "document" ? "Please upload a document."
        : formLinkType === "external" ? "Please enter a URL."
        : "Please select a page.");
      return;
    }
    // External links must be a real http(s) URL — don't accept arbitrary text.
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
      await createClubMenu(clubId, {
        menuName: formName.trim(),
        linkType: formLinkType,
        linkValue: formLinkType === "html" ? "" : formLinkValue,
        contentHtml: formLinkType === "html" ? formContentHtml : null,
        sortOrder: formSortOrder,
        isActive: formIsActive === "1",
      });
      setSuccessMessage("Menu added successfully.");
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

  const quillModules = useMemo(() => ({
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ["bold", "italic", "underline", "strike"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link", "image"],
      ["clean"],
    ],
  }), []);

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Add Menu Item"
          pageSubtitle="Add a custom menu entry"
          activeNavHref="/club-admin-dashboard/my-club-website"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Add Menu Item"
        pageSubtitle="Add a custom menu entry"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title="Add Custom Menu"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/website-data/menu_list/v2`}
        saving={saving}
        saveLabel="Save Menu"
        onSave={handleSave}
        banner={
          customMenuExists ? (
            <span>
              <strong className="font-semibold text-rose-700">Notice:</strong>{" "}
              A custom menu already exists for this club. Only 1 custom menu is allowed
              (in addition to the 8 default menus). Saving will fail — edit or delete the
              existing custom menu first.
            </span>
          ) : (
            <span>
              You can add <strong>1 custom menu</strong> in addition to the 8 default menus that
              are auto-seeded. Sub-menus can be created later from this menu&apos;s Edit page.
            </span>
          )
        }
      >
        {/* 1. Identity */}
        <SectionCard number={1} icon={FileText} title="Menu Identity" dot="bg-blue-600">
          <FieldLabel dot="bg-blue-500" required>Menu Name</FieldLabel>
          <input
            type="text"
            placeholder="e.g. Our Initiatives"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        </SectionCard>

        {/* 2. Link target */}
        <SectionCard number={2} icon={Link2} title="Link Target" dot="bg-violet-600">
          <FieldLabel dot="bg-violet-500" required>Link Type</FieldLabel>
          <select
            value={formLinkType}
            onChange={(e) => { setFormLinkType(e.target.value); setFormLinkValue(""); setFormContentHtml(""); }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white mb-4"
          >
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {formLinkType === "html" && (
            <div>
              <FieldLabel dot="bg-emerald-500" required>Content</FieldLabel>
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
            </div>
          )}

          {formLinkType === "document" && (
            <div>
              <FieldLabel dot="bg-amber-500" required>Document</FieldLabel>
              {formLinkValue ? (
                <div className="flex items-center gap-2 p-2 border border-slate-200 rounded-md bg-slate-50">
                  <FileText className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  <span className="text-sm truncate flex-1 text-slate-700">{formLinkValue.split("/").pop()}</span>
                  <button
                    type="button"
                    onClick={() => setFormLinkValue("")}
                    className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50"
                    aria-label="Remove document"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                      onChange={handleFileUpload}
                      disabled={uploading}
                    />
                    <div className="flex items-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-md hover:border-blue-300 transition-colors">
                      <Upload className="h-4 w-4 text-slate-400" />
                      <span className="text-sm text-slate-500">
                        {uploading ? "Uploading…" : "Click to upload document"}
                      </span>
                    </div>
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX (max 10 MB)
                  </p>
                </div>
              )}
            </div>
          )}

          {formLinkType === "page" && (
            <div>
              <FieldLabel dot="bg-blue-500" required>Page</FieldLabel>
              <select
                value={formLinkValue}
                onChange={(e) => setFormLinkValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select an existing page…</option>
                {pageOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Links this menu to one of your website&apos;s existing pages.
              </p>
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
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                Must be a full URL starting with <code>http://</code> or <code>https://</code>.
              </p>
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
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500">Status</FieldLabel>
              <select
                value={formIsActive}
                onChange={(e) => setFormIsActive(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
        </SectionCard>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Menu added successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
