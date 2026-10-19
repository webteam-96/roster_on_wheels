"use client";

/**
 * District Admin Dashboard — My District Website · Contact Details (V2)
 * ---------------------------------------------------------------------
 * V2 rewrite of /districts/[id]/website-data/contact_details for the DA
 * dashboard shell. districtId comes from useAuth().selectedDistrictId
 * (no /districts/[id] URL param), Back/Save/Cancel honour ?returnTo=
 * (falls back to the My District Website landing) and forward ?yearId=
 * so the top-bar year filter stays in sync across sub-pages.
 *
 * Design palette matches sibling DA dashboard pages:
 *   navy #17458f (headings + primary buttons)
 *   gold #F7A81B (underline accents)
 *   slate 800/600/500 for text
 *   rounded-2xl border border-slate-200 shadow-sm bg-white for cards
 *   inputs border-slate-200 bg-white focus:border-azure
 *
 * Every V1 behaviour is preserved: fetch available years + rotary years,
 * year picker, single-contact per-year card, add/edit dialog, activate /
 * deactivate toggle, delete confirmation, success / error alerts.
 */

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getDistrictContactDetails, createDistrictContactDetail, updateDistrictContactDetail,
  deleteDistrictContactDetail, getDistrictContactDetailAvailableYears, getRotaryYears, getDistrict,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Eye, EyeOff, Phone, Mail } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function DistrictAdminContactDetailsPage() {
  const { isSuperAdmin, isAdmin, selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;

  const searchParams = useSearchParams();
  const router = useRouter();
  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");

  const goBack = () => {
    const dest = returnTo || "/district-admin-dashboard/my-district-website";
    if (!currentYearId) { router.push(dest); return; }
    const sep = dest.includes("?") ? "&" : "?";
    router.push(`${dest}${sep}yearId=${encodeURIComponent(currentYearId)}`);
  };

  const [districtName, setDistrictName] = useState("");
  const [contact, setContact] = useState<any>(null);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  // Kept for parity with V1 — the full rotary-year catalogue is fetched
  // even though it's only used to backfill the "current" year when the
  // district has no contact-detail rows yet.
  const [, setAllRotaryYears] = useState<RotaryYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingContact, setLoadingContact] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    if (!districtId) return;
    async function fetchInitial() {
      setLoading(true);
      try {
        // Only fetch what the form needs — no more available-years filter
        // (the top-bar ?yearId= drives the listing).
        const [d, allYrs] = await Promise.all([
          getDistrict(districtId),
          getRotaryYears(),
        ]);
        setDistrictName(`District ${d.districtNumber}`);
        setAllRotaryYears(allYrs);
        setAllYears(allYrs);
        // Trust the top-bar year verbatim. If not present, fall back to
        // current RY.
        if (currentYearId) {
          setSelectedYearId(currentYearId);
        } else {
          const cy = allYrs.find((y: any) => y.isCurrent);
          if (cy) setSelectedYearId(String(cy.id));
        }
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId]);

  // React to top-bar year changes verbatim.
  useEffect(() => {
    if (!currentYearId) return;
    if (currentYearId !== selectedYearId) setSelectedYearId(currentYearId);
  }, [currentYearId, selectedYearId]);

  const fetchContact = useCallback(async (yearId: number) => {
    setLoadingContact(true);
    try {
      const data = await getDistrictContactDetails(districtId, yearId);
      setContact(Array.isArray(data) && data.length > 0 ? data[0] : null);
    } catch { setErrorMessage("Failed to load contact details."); }
    finally { setLoadingContact(false); }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) fetchContact(Number(selectedYearId));
    else setContact(null);
  }, [selectedYearId, fetchContact]);

  const openAddDialog = () => {
    setEditing(false);
    setFormEmail("");
    setFormPhone("");
    setFormIsActive("1");
    setDialogOpen(true);
  };
  const openEditDialog = () => {
    if (!contact) return;
    setEditing(true);
    setFormEmail(contact.email);
    setFormPhone(contact.phone);
    setFormIsActive(contact.isActive ? "1" : "0");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formEmail.trim()) { setErrorMessage("Please enter an email."); return; }
    if (!formPhone.trim()) { setErrorMessage("Please enter a phone number."); return; }
    setSaving(true);
    try {
      if (editing && contact) {
        await updateDistrictContactDetail(districtId, contact.id, {
          email: formEmail.trim(),
          phone: formPhone.trim(),
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Contact detail updated.");
      } else {
        await createDistrictContactDetail(districtId, {
          yearId: Number(selectedYearId),
          email: formEmail.trim(),
          phone: formPhone.trim(),
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Contact detail added.");
      }
      setDialogOpen(false);
      fetchContact(Number(selectedYearId));
      try {
        const av = await getDistrictContactDetailAvailableYears(districtId);
        if (av.length > 0) setAllYears(av);
      } catch { /* non-fatal */ }
    } catch { setErrorMessage("Failed to save."); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!contact) return;
    try {
      await deleteDistrictContactDetail(districtId, contact.id);
      setShowDeleteConfirm(false);
      setSuccessMessage("Contact detail deleted.");
      fetchContact(Number(selectedYearId));
    } catch {
      setShowDeleteConfirm(false);
      setErrorMessage("Failed to delete.");
    }
  };

  const handleToggleActive = async () => {
    if (!contact) return;
    try {
      await updateDistrictContactDetail(districtId, contact.id, {
        email: contact.email,
        phone: contact.phone,
        isActive: !contact.isActive,
      });
      setSuccessMessage(contact.isActive ? "Deactivated." : "Activated.");
      fetchContact(Number(selectedYearId));
    } catch { setErrorMessage("Failed to update status."); }
  };

  if (!districtId) return null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-ink">
                {districtName ? `${districtName} · Contact Details` : "Contact Details"}
              </h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Manage district contact details by year
              </p>
            </div>
          </div>
          {canManage && !contact && !loading && !loadingContact && selectedYearId && (
            <Button
              onClick={openAddDialog}
              className="bg-azure hover:bg-mint-ink text-white"
            >
              <Plus className="mr-2 h-4 w-4" />Add Contact
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Year picker removed — top-bar ?yearId= drives the filter. */}

        {loadingContact && (
          <div className="flex items-center justify-center py-12">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && !loadingContact && selectedYearId && !contact && (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="h-14 w-14 rounded-full bg-violet-50 flex items-center justify-center mb-4">
              <Phone className="h-7 w-7 text-violet-700" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">No contact details yet</h3>
            <p className="text-slate-500 mt-2 max-w-md">
              {canManage ? 'Click "Add Contact" to add contact details.' : "No contact details added yet."}
            </p>
          </div>
        )}

        {!loading && !loadingContact && contact && (
          <div className="max-w-lg rounded-2xl border border-slate-200 shadow-sm bg-white overflow-hidden">
            {/* Gold accent strip */}
            <div className="h-1 bg-marigold" />
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <Badge
                  variant="outline"
                  className={
                    contact.isActive
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 font-medium"
                      : "border-slate-200 bg-slate-50 text-slate-600 font-medium"
                  }
                >
                  {contact.isActive ? "Active" : "Inactive"}
                </Badge>
                {canManage && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleActive}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      {contact.isActive
                        ? <><EyeOff className="mr-1 h-4 w-4" />Deactivate</>
                        : <><Eye className="mr-1 h-4 w-4" />Activate</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openEditDialog}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="mr-1 h-4 w-4" />Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />Delete
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-azure/10 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-4 w-4 text-ink" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Email</p>
                    <p className="font-medium text-slate-800 break-all">{contact.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-azure/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-4 w-4 text-ink" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Phone</p>
                    <p className="font-medium text-slate-800">{contact.phone}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add / Edit dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-ink">
                {editing ? "Edit Contact Detail" : "Add Contact Detail"}
              </DialogTitle>
              <DialogDescription>
                {editing ? "Update the contact detail." : "Enter email and phone."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone *</Label>
                <Input
                  placeholder="+1 555 123 4567"
                  value={formPhone}
                  onChange={e => setFormPhone(e.target.value)}
                  className="border-slate-200 bg-white focus:border-azure focus:ring-azure/20"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
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
                disabled={saving || !formEmail.trim() || !formPhone.trim()}
                className="bg-azure hover:bg-mint-ink text-white"
              >
                {saving ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal
          open={showDeleteConfirm}
          onOpenChange={(o) => !o && setShowDeleteConfirm(false)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Contact Detail"
          description="Are you sure? This action cannot be undone."
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setShowDeleteConfirm(false)}
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
