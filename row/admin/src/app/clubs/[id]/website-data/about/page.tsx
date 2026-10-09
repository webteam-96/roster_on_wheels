"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ClubAbout } from "@/types/about";
import {
  getClubAboutByClub, createClubAbout, updateClubAbout, deleteClubAbout,
  uploadAboutImage, getClub,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Eye, EyeOff, Info } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import "react-quill-new/dist/quill.snow.css";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const ABOUT_MAX_CHARS = 5000;

// Strip HTML and count visible (plain-text) characters. Counts what the user sees,
// not the editor's HTML output (so formatting tags don't eat into the budget).
function plainTextLength(html: string): number {
  if (typeof window === "undefined" || !html) return 0;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").length;
}

export default function AboutPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

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
  const canManage = isSuperAdmin || isAdmin;

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
              quill.insertEmbed(range.index, "image", `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${result.path}`);
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

  const openAddDialog = () => { setEditing(false); setFormContent(""); setFormIsActive("1"); setDialogOpen(true); };
  const openEditDialog = () => { if (!about) return; setEditing(true); setFormContent(about.content); setFormIsActive(about.isActive ? "1" : "0"); setDialogOpen(true); };

  const handleSave = async () => {
    if (!formContent.trim() || formContent === "<p><br></p>") { setErrorMessage("Please enter some content."); return; }
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
    try { await deleteClubAbout(clubId, about.id); setShowDeleteConfirm(false); setSuccessMessage("About content deleted."); fetchAbout(); }
    catch { setShowDeleteConfirm(false); setErrorMessage("Failed to delete."); }
  };

  const handleToggleActive = async () => {
    if (!about) return;
    try { await updateClubAbout(clubId, about.id, { content: about.content, isActive: !about.isActive }); setSuccessMessage(about.isActive ? "About deactivated." : "About activated."); fetchAbout(); }
    catch { setErrorMessage("Failed to update status."); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/clubs/${clubId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{clubName ? `${clubName} - About Us` : "About Us"}</h2>
              <p className="text-muted-foreground text-base">Manage club about content</p>
            </div>
          </div>
          {canManage && !about && !loading && (
            <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add About</Button>
          )}
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && !about && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Info className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No about content yet</h3>
            <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add About" to add content.' : "No about content has been added yet."}</p>
          </div>
        )}

        {!loading && about && (
          <Card className="border-primary/20 overflow-hidden">
            <CardContent className="p-6 space-y-4 overflow-hidden">
              <div className="flex items-center justify-between">
                <Badge variant={about.isActive ? "default" : "secondary"}>{about.isActive ? "Active" : "Inactive"}</Badge>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleToggleActive}>
                      {about.isActive ? <><EyeOff className="mr-1 h-4 w-4" />Deactivate</> : <><Eye className="mr-1 h-4 w-4" />Activate</>}
                    </Button>
                    <Button variant="outline" size="sm" onClick={openEditDialog}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
                  </div>
                )}
              </div>
              <div
                className="prose prose-sm max-w-none dark:prose-invert break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_a]:break-all"
                dangerouslySetInnerHTML={{ __html: about.content }}
              />
            </CardContent>
          </Card>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit About Content" : "Add About Content"}</DialogTitle>
              <DialogDescription>{editing ? "Update the about content." : "Enter the about content."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Content * <span className="text-xs text-muted-foreground font-normal">(max {ABOUT_MAX_CHARS} characters)</span></Label>
                <div className="min-h-[300px]" ref={editorContainerRef}>
                  <ReactQuill theme="snow" value={formContent} onChange={setFormContent} modules={quillModules} placeholder="Write your about content here..." style={{ height: "250px", marginBottom: "42px" }} />
                </div>
                {(() => {
                  const used = plainTextLength(formContent);
                  const remaining = ABOUT_MAX_CHARS - used;
                  const over = remaining < 0;
                  return (
                    <p className={`text-xs text-right ${over ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {used}/{ABOUT_MAX_CHARS} characters{over ? ` (${Math.abs(remaining)} over limit)` : ""}
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || plainTextLength(formContent) > ABOUT_MAX_CHARS}>{saving ? "Saving..." : editing ? "Update" : "Add"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal open={showDeleteConfirm} onOpenChange={(o) => !o && setShowDeleteConfirm(false)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete About Content" description="Are you sure? This action cannot be undone." confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setShowDeleteConfirm(false)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
