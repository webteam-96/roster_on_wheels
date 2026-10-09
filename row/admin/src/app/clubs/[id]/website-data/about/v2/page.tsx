"use client";

/**
 * About Us — v2 single-record page.
 *
 * The about module is effectively a single-record "what does this club say
 * about itself on the public website" editor. There is no separate add/edit
 * subroute — this page IS the destination. v2 changes visuals only; all v1
 * behavior is preserved 1:1:
 *
 *   - ReactQuill rich-text editor with full toolbar (bold/italic/underline,
 *     headers, size, color, bg, lists, align, link, image, clean).
 *   - Custom image upload handler → uploadAboutImage → insert as <img> at
 *     caret position, prefixed with NEXT_PUBLIC_API_URL.
 *   - 5,000 plain-text character limit (HTML tags don't count).
 *   - isActive toggle (Activate / Deactivate).
 *   - SuperAdmin / Admin only for create/update/delete/toggle; everyone else
 *     sees the rendered content read-only.
 *   - Add / Edit / Delete go through the same dialog + AlertModal flow as v1.
 *
 * Design language: matches FoundationGoalsCard — slate borders, rounded-2xl
 * cards, blue/white gradient header strip, compact KPI tiles at the top.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, FileText, Plus, Pencil, Trash2, AlertTriangle,
  Eye, EyeOff, Info, Loader2, CheckCircle2, Lock, Hash, Activity, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ClubAbout } from "@/types/about";
import {
  getClubAboutByClub, createClubAbout, updateClubAbout, deleteClubAbout,
  uploadAboutImage, getClub,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import "react-quill-new/dist/quill.snow.css";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const ABOUT_MAX_CHARS = 5000;

// Strip HTML and count visible (plain-text) characters. Mirrors v1 logic so the
// user-visible character budget stays consistent.
function plainTextLength(html: string): number {
  if (typeof window === "undefined" || !html) return 0;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").length;
}

export default function AboutV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  // Back arrow honors ?returnTo= so the user lands back on the upstream tab
  // (e.g. /club-admin-dashboard/my-club-website) instead of the legacy hub.
  const returnTo = searchParams.get("returnTo") || "";
  const defaultBack = returnTo || `/clubs/${clubId}/website-data`;

  const [clubName, setClubName] = useState("");
  const [about, setAbout] = useState<ClubAbout | null>(null);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formContent, setFormContent] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const handlerAttachedRef = useRef(false);

  const quillModules = useRef({
    toolbar: {
      container: [
        ["bold", "italic", "underline"],
        [{ header: [1, 2, 3, false] }],
        [{ size: [] }],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ align: [] }],
        ["link", "image"],
        ["clean"],
      ],
    },
  }).current;

  const getQuillInstance = useCallback(() => {
    const container = editorContainerRef.current;
    if (!container) return null;
    const qlContainer = container.querySelector(".ql-container");
    if (!qlContainer) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const QuillClass = require("quill").default || require("quill");
      return QuillClass.find(qlContainer);
    } catch { return null; }
  }, []);

  // Wire up the custom image upload handler whenever the dialog opens.
  // Identical to v1.
  useEffect(() => {
    if (!dialogOpen) { handlerAttachedRef.current = false; return; }
    const timer = setTimeout(() => {
      if (handlerAttachedRef.current) return;
      const quill = getQuillInstance();
      if (!quill) return;
      handlerAttachedRef.current = true;
      const toolbar = quill.getModule("toolbar");
      if (toolbar) {
        toolbar.addHandler("image", () => {
          const input = document.createElement("input");
          input.setAttribute("type", "file");
          input.setAttribute("accept", "image/*");
          input.click();
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const result = await uploadAboutImage(clubId, file);
              const range = quill.getSelection(true);
              quill.insertEmbed(
                range.index,
                "image",
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${result.path}`
              );
              quill.setSelection(range.index + 1);
            } catch { setErrorMessage("Failed to upload image."); }
          };
        });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [dialogOpen, clubId, getQuillInstance]);

  const fetchAbout = useCallback(async () => {
    try {
      const data = await getClubAboutByClub(clubId);
      setAbout(data.length > 0 ? data[0] : null);
    } catch { setErrorMessage("Failed to load about content."); }
  }, [clubId]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
        await fetchAbout();
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    init();
  }, [clubId, fetchAbout]);

  const openAddDialog = () => {
    setEditing(false);
    setFormContent("");
    setFormIsActive("1");
    setDialogOpen(true);
  };
  const openEditDialog = () => {
    if (!about) return;
    setEditing(true);
    setFormContent(about.content);
    setFormIsActive(about.isActive ? "1" : "0");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formContent.trim() || formContent === "<p><br></p>") {
      setErrorMessage("Please enter some content.");
      return;
    }
    if (plainTextLength(formContent) > ABOUT_MAX_CHARS) {
      setErrorMessage(`Content exceeds the ${ABOUT_MAX_CHARS} character limit. Please shorten it.`);
      return;
    }
    setSaving(true);
    try {
      if (editing && about) {
        await updateClubAbout(clubId, about.id, { content: formContent, isActive: formIsActive === "1" });
        setSuccessMessage("About content updated.");
      } else {
        await createClubAbout(clubId, { content: formContent, isActive: formIsActive === "1" });
        setSuccessMessage("About content added.");
      }
      setDialogOpen(false);
      fetchAbout();
    } catch { setErrorMessage("Failed to save about content."); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!about) return;
    try {
      await deleteClubAbout(clubId, about.id);
      setShowDeleteConfirm(false);
      setSuccessMessage("About content deleted.");
      fetchAbout();
    } catch {
      setShowDeleteConfirm(false);
      setErrorMessage("Failed to delete.");
    }
  };

  const handleToggleActive = async () => {
    if (!about) return;
    try {
      await updateClubAbout(clubId, about.id, { content: about.content, isActive: !about.isActive });
      setSuccessMessage(about.isActive ? "About deactivated." : "About activated.");
      fetchAbout();
    } catch { setErrorMessage("Failed to update status."); }
  };

  const charCount = about ? plainTextLength(about.content) : 0;
  const formCharCount = plainTextLength(formContent);
  const formCharRemaining = ABOUT_MAX_CHARS - formCharCount;
  const formCharOver = formCharRemaining < 0;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="About Us"
        pageSubtitle="Your club story on the public website"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <div className="space-y-5">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={defaultBack}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">
                {clubName ? `${clubName} — About Us` : "About Us"}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                The story that appears on your public website. One record per club.
              </p>
            </div>
          </div>
          {!loading && about && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${
                about.isActive
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
            >
              {about.isActive ? <CheckCircle2 size={12} /> : <EyeOff size={12} />}
              {about.isActive ? "Active" : "Inactive"}
            </span>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 flex items-center justify-center text-slate-500">
            <Loader2 className="animate-spin mr-2" size={16} /> Loading about content…
          </div>
        )}

        {/* Read-only banner for non-managers */}
        {!loading && !canManage && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> Read only — only SuperAdmin or Admin can edit the About content.
            </span>
          </div>
        )}

        {/* Empty state — no record yet */}
        {!loading && !about && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-gradient-to-r from-blue-50 to-white">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Tell visitors who you are</h3>
                <p className="text-xs text-slate-500">No about content yet · single record per club</p>
              </div>
            </div>
            <div className="p-10 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                <Info size={26} />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">No about content yet</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                {canManage
                  ? "Add a paragraph or two introducing the club, its history, or its mission. Up to 5,000 characters with rich formatting and inline images."
                  : "An Admin or SuperAdmin will add this soon."}
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={openAddDialog}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={14} /> Add About
                </button>
              )}
            </div>
          </div>
        )}

        {/* Existing record — KPI tiles + preview card */}
        {!loading && about && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiTile
                label="Status"
                value={about.isActive ? "Active" : "Inactive"}
                icon={Activity}
                color={about.isActive ? "emerald" : "slate"}
                sublabel={about.isActive ? "Visible on public site" : "Hidden from visitors"}
              />
              <KpiTile
                label="Content length"
                value={`${charCount.toLocaleString()} chars`}
                icon={Hash}
                color="blue"
                sublabel={`Limit ${ABOUT_MAX_CHARS.toLocaleString()} · ${Math.max(0, ABOUT_MAX_CHARS - charCount).toLocaleString()} free`}
              />
              <KpiTile
                label="Record"
                value="1 of 1"
                icon={FileText}
                color="purple"
                sublabel="Single record per club"
              />
            </div>

            {/* Preview card */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gradient-to-r from-blue-50 to-white">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">About preview</h3>
                    <p className="text-xs text-slate-500">Rendered exactly as it appears on the public site</p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleActive}
                      className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      {about.isActive ? <><EyeOff size={13} /> Deactivate</> : <><Eye size={13} /> Activate</>}
                    </button>
                    <button
                      type="button"
                      onClick={openEditDialog}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </div>

              <div className="p-5">
                <div
                  className="prose prose-sm max-w-none dark:prose-invert break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_a]:break-all"
                  dangerouslySetInnerHTML={{ __html: about.content }}
                />
              </div>
            </div>
          </>
        )}

        {/* Add / Edit dialog — identical behavior to v1 */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit About Content" : "Add About Content"}</DialogTitle>
              <DialogDescription>
                {editing ? "Update the about content." : "Enter the about content."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Content *{" "}
                  <span className="text-[10px] text-slate-400 font-normal">
                    (max {ABOUT_MAX_CHARS.toLocaleString()} characters)
                  </span>
                </label>
                <div className="min-h-[300px]" ref={editorContainerRef}>
                  <ReactQuill
                    theme="snow"
                    value={formContent}
                    onChange={setFormContent}
                    modules={quillModules}
                    placeholder="Write your about content here..."
                    style={{ height: "250px", marginBottom: "42px" }}
                  />
                </div>
                <p
                  className={`text-xs text-right ${
                    formCharOver ? "text-rose-700 font-medium" : "text-slate-500"
                  }`}
                >
                  {formCharCount.toLocaleString()}/{ABOUT_MAX_CHARS.toLocaleString()} characters
                  {formCharOver ? ` (${Math.abs(formCharRemaining).toLocaleString()} over limit)` : ""}
                </p>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">Status</label>
                <select
                  value={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.value)}
                  className="w-40 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || formCharOver}
                className="inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : null}
                {saving ? "Saving…" : editing ? "Update" : "Add"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal
          open={showDeleteConfirm}
          onOpenChange={(o) => !o && setShowDeleteConfirm(false)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete About Content"
          description="Are you sure? This action cannot be undone."
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setShowDeleteConfirm(false)}
        />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

function KpiTile({
  label, value, sublabel, icon: Icon, color,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: LucideIcon;
  color: "blue" | "emerald" | "purple" | "slate";
}) {
  const palette = {
    blue:    { bg: "bg-blue-100",    fg: "text-blue-700" },
    emerald: { bg: "bg-emerald-100", fg: "text-emerald-700" },
    purple:  { bg: "bg-purple-100",  fg: "text-purple-700" },
    slate:   { bg: "bg-slate-100",   fg: "text-slate-600" },
  }[color];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${palette.bg} ${palette.fg} flex items-center justify-center flex-shrink-0`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
        <p className="text-sm font-semibold text-slate-800 truncate">{value}</p>
        {sublabel && <p className="text-[11px] text-slate-400 truncate">{sublabel}</p>}
      </div>
    </div>
  );
}
