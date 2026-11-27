"use client";

/**
 * Contact Details v2 — frontend overhaul module (single-record-per-year).
 *
 * The v1 page (../page.tsx) shows ONE contact (email + phone + active flag)
 * per Rotary year. There is no list, no /add subroute, no /[id]/edit subroute
 * — the listing filter and the edit dialog operate on the SAME single record.
 *
 * v2 collapses that into one inline edit surface (FoundationGoalsCard-style):
 *   - Year picker (data-only years that already have a contact)
 *   - Inline form (email / phone / status)
 *   - Save (insert when no record, update when one exists)
 *   - Delete (removes the year's contact)
 *
 * Visuals match the v2 dashboard language (slate-200 borders, rounded-2xl
 * cards, KPI tiles, gradient header, dot-accented field labels). Every API
 * method, every validation rule, every state transition is preserved
 * verbatim from v1.
 *
 * v2 reads ONLY `?returnTo=` — back arrow honors it for cross-tab returns.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Phone, Mail, Calendar, CheckCircle2, ShieldCheck, Save, Trash2, Plus, Loader2, Eye, EyeOff, AlertTriangle } from "@/components/icons";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import {
  getClub,
  getRotaryYears,
  getClubContactDetails,
  getClubContactAvailableYears,
  createClubContactDetail,
  updateClubContactDetail,
  deleteClubContactDetail,
} from "@/services/api";
import { ClubContactDetail } from "@/types/contactDetail";
import { RotaryYear } from "@/types/rotaryYear";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYear, heldYearLabels } from "@/lib/adminYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";


export default function ContactDetailsV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const search = useSearchParams();
  const clubId = Number(params.id);
  const returnTo = search.get("returnTo") || "";
  const backHref = returnTo || `/clubs/${clubId}/website-data`;

  const { isSuperAdmin, isAdmin, user } = useAuth();

  const [clubName, setClubName] = useState("");
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  // Listing year filter is data-only (years that actually have a contact);
  // the "add" year picker uses allYears.
  const [dataYears, setDataYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");

  // ⚠️ Club website content IS year-scoped: each Rotary year has its own banners,
  // adverts and contact details. So a member may only change the year they
  // administer — including the year the LIVE public site is showing.
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const canManageYear = (isSuperAdmin || isAdmin) && canEditYear(yearRights, Number(selectedYearId) || undefined, isSuperAdmin);
  const canManage = canManageYear;
  const editableYears = heldYearLabels(yearRights, dataYears.map((y) => ({ id: y.id, label: y.yearLabel })));


  const [contact, setContact] = useState<ClubContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContact, setLoadingContact] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields (live-bound to the displayed record OR a fresh add).
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");
  // Only used when there is NO record for the selected year and we need to pick a year for insertion.
  const [formYearId, setFormYearId] = useState<string>("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ===== Initial load =====
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, yrs, dyrs] = await Promise.all([
          getClub(clubId),
          getRotaryYears(),
          getClubContactAvailableYears(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setAllYears(yrs);
        setDataYears(dyrs);
        const cy = dyrs.find((y) => y.isCurrent) || dyrs[0];
        if (cy) {
          setSelectedYearId(String(cy.id));
        } else {
          // No data years yet — default the add-form year to the current rotary year
          const cur = yrs.find((y) => y.isCurrent) || yrs[0];
          if (cur) setFormYearId(String(cur.id));
        }
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

  // ===== Fetch contact when year changes =====
  const fetchContact = useCallback(async (yearId: number) => {
    setLoadingContact(true);
    try {
      const data = await getClubContactDetails(clubId, yearId);
      const rec = data.length > 0 ? data[0] : null;
      setContact(rec);
      if (rec) {
        setFormEmail(rec.email);
        setFormPhone(rec.phone);
        setFormIsActive(rec.isActive ? "1" : "0");
      } else {
        // No existing record for this year — clear the form for add mode.
        setFormEmail("");
        setFormPhone("");
        setFormIsActive("1");
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to load contact details.");
    } finally {
      setLoadingContact(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (selectedYearId) {
      fetchContact(Number(selectedYearId));
    } else {
      setContact(null);
    }
  }, [selectedYearId, fetchContact]);

  // After add/delete, refresh the data-only year list.
  const reconcileDataYears = useCallback(async (preferYearId?: number) => {
    let dy: { id: number; yearLabel: string; isCurrent: boolean }[] = [];
    try { dy = await getClubContactAvailableYears(clubId); } catch { return; }
    setDataYears(dy);
    if (preferYearId && dy.find((y) => y.id === preferYearId)) {
      if (String(preferYearId) === selectedYearId) fetchContact(preferYearId);
      else setSelectedYearId(String(preferYearId));
      return;
    }
    if (dy.find((y) => String(y.id) === selectedYearId)) {
      fetchContact(Number(selectedYearId));
      return;
    }
    const cy = dy.find((y) => y.isCurrent) || dy[0];
    if (cy) setSelectedYearId(String(cy.id));
    else {
      setSelectedYearId("");
      setContact(null);
      setFormEmail("");
      setFormPhone("");
      setFormIsActive("1");
    }
  }, [clubId, selectedYearId, fetchContact]);

  // ===== Save (insert if no record, update otherwise) =====
  const handleSave = async () => {
    if (!formEmail.trim()) { setErrorMessage("Please enter an email address."); return; }
    if (!formPhone.trim()) { setErrorMessage("Please enter a phone number."); return; }

    if (contact) {
      // Update existing
      setSaving(true);
      try {
        await updateClubContactDetail(clubId, contact.id, {
          email: formEmail.trim(),
          phone: formPhone.trim(),
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Contact detail updated successfully.");
        fetchContact(Number(selectedYearId));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } | string } };
        const msg =
          (typeof e.response?.data === "object" && e.response?.data?.message) ||
          (typeof e.response?.data === "string" ? e.response.data : undefined) ||
          "Failed to save contact detail.";
        setErrorMessage(msg);
      } finally {
        setSaving(false);
      }
    } else {
      // Insert — must have a year picked
      const yearForInsert = selectedYearId || formYearId;
      if (!yearForInsert) { setErrorMessage("Please select a rotary year."); return; }
      setSaving(true);
      try {
        await createClubContactDetail(clubId, {
          yearId: Number(yearForInsert),
          email: formEmail.trim(),
          phone: formPhone.trim(),
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Contact detail added successfully.");
        await reconcileDataYears(Number(yearForInsert));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } | string } };
        const msg =
          (typeof e.response?.data === "object" && e.response?.data?.message) ||
          (typeof e.response?.data === "string" ? e.response.data : undefined) ||
          "Failed to save contact detail.";
        setErrorMessage(msg);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!contact) return;
    try {
      await deleteClubContactDetail(clubId, contact.id);
      setShowDeleteConfirm(false);
      setSuccessMessage("Contact detail deleted successfully.");
      await reconcileDataYears();
    } catch {
      setShowDeleteConfirm(false);
      setErrorMessage("Failed to delete contact detail.");
    }
  };

  const handleToggleActive = async () => {
    if (!contact) return;
    try {
      await updateClubContactDetail(clubId, contact.id, {
        email: contact.email,
        phone: contact.phone,
        isActive: !contact.isActive,
      });
      setSuccessMessage(contact.isActive ? "Contact detail deactivated." : "Contact detail activated.");
      fetchContact(Number(selectedYearId));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update contact detail status.");
    }
  };

  // ===== KPIs =====
  const yearLabel = useMemo(() => {
    if (!selectedYearId) return "–";
    const fromData = dataYears.find((y) => String(y.id) === selectedYearId);
    if (fromData) return fromData.yearLabel;
    const fromAll = allYears.find((y) => String(y.id) === selectedYearId);
    return fromAll?.yearLabel ?? "–";
  }, [selectedYearId, dataYears, allYears]);

  const totalYearsCovered = dataYears.length;
  const isActiveNow = contact?.isActive ? 1 : 0;
  const hasContact = contact ? 1 : 0;

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Contact Details"
          pageSubtitle="Public contact information"
          activeNavHref="/club-admin-dashboard/my-club-website"
        >
          <SkeletonRows />
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  // True when there is no data year and no record — first-time add experience.
  const isFreshAdd = !contact && !selectedYearId;

  return (
    <ProtectedRoute>
      {!canManage && selectedYearId && (
        <ViewOnlyBadge editableYears={editableYears} className="mb-4" />
      )}

      <ClubAdminShell
        pageTitle="Contact Details"
        pageSubtitle="Public contact information"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <div className="space-y-5">
        {/* Header */}
        <PageHeader title="Contact Details" description={<>RY {yearLabel} · {clubName || "–"}</>} back={backHref} />

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Years Covered"  value={fmtInt(totalYearsCovered)} subtitle="With contact details" icon={Calendar}     color="blue" />
          <KpiCard title="Selected Year"  value={yearLabel}                 subtitle={hasContact ? "Has contact" : "No contact yet"} icon={CheckCircle2} color="green" />
          <KpiCard title="Active Now"     value={fmtInt(isActiveNow)}       subtitle={contact?.isActive ? "Showing on site" : "Hidden"} icon={ShieldCheck}  color="gold" />
          <KpiCard title="Total Records"  value={fmtInt(hasContact)}        subtitle="For this year"    icon={Phone}        color="purple" />
        </div>

        {/* Form / record card */}
        <Card className="overflow-hidden">
          {/* Header bar */}
          <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-blue-50">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <Phone size={18} />
              </div>
              <div>
                <h3 className="row-h3">Public Contact Details</h3>
                <p className="text-xs text-slate-500">One contact per Rotary year · {clubName || "–"}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {dataYears.length > 0 && (
                <NativeSelect
                  value={selectedYearId}
                  onChange={(e) => setSelectedYearId(e.target.value)}
                  className="w-auto"
                >
                  {dataYears.map((y) => (
                    <option key={y.id} value={String(y.id)}>
                      {y.yearLabel}{y.isCurrent ? " · current" : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {contact ? (
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border ${contact.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                  {contact.isActive ? <Eye size={11} /> : <EyeOff size={11} />}
                  {contact.isActive ? "Active" : "Inactive"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-amber-50 text-amber-700 border-amber-200">
                  <Plus size={11} /> No record · Add new
                </span>
              )}
            </div>
          </div>

          {/* Form body */}
          {loadingContact ? (
            <SkeletonRows />
          ) : (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Email */}
              <div>
                <FieldLabel required>Email</FieldLabel>
                <div className="relative">
                  <Mail size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={formEmail}
                    disabled={!canManage || saving}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="pl-7 pr-3 disabled:bg-slate-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <FieldLabel required>Phone</FieldLabel>
                <div className="relative">
                  <Phone size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="+1 555 123 4567"
                    value={formPhone}
                    disabled={!canManage || saving}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="pl-7 pr-3 disabled:bg-slate-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Status */}
              <div>
                <FieldLabel>Status</FieldLabel>
                <NativeSelect
                  value={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.value)}
                  disabled={!canManage || saving}
                  className="disabled:bg-slate-50 disabled:cursor-not-allowed"
                >
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </NativeSelect>
              </div>

              {/* Rotary Year — only when no record yet AND nothing is selected (first add). */}
              {!contact && !selectedYearId && (
                <div>
                  <FieldLabel required>Rotary Year</FieldLabel>
                  <NativeSelect
                    value={formYearId}
                    onChange={(e) => setFormYearId(e.target.value)}
                    disabled={!canManage || saving}
                    className="disabled:bg-slate-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select a year</option>
                    {allYears.map((y) => (
                      <option key={y.id} value={String(y.id)}>
                        {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          {canManage && (
            <div className="px-5 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50">
              <div className="text-xs text-slate-500">
                {contact
                  ? <>Editing existing contact for <span className="font-medium text-slate-700">RY {yearLabel}</span></>
                  : selectedYearId
                    ? <>Adding new contact for <span className="font-medium text-slate-700">RY {yearLabel}</span></>
                    : isFreshAdd
                      ? "Pick a Rotary year above to create the first contact"
                      : "Adding new contact"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {contact && (
                  <>
                    <Button
                      type="button"
                      onClick={handleToggleActive}
                      disabled={saving}
                      variant="outline" size="sm"
                    >
                      {contact.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                      {contact.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={saving}
                      variant="outline" size="sm" className="text-red-700"
                    >
                      <Trash2 size={13} /> Delete
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !formEmail.trim() || !formPhone.trim() || (!contact && !selectedYearId && !formYearId)}
                  size="sm"
                >
                  {saving ? <Loader2 className="animate-spin" size={13} /> : (contact ? <Save size={13} /> : <Plus size={13} />)}
                  {saving ? "Saving…" : (contact ? "Save Changes" : "Add Contact")}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Delete confirm */}
        <AlertModal
          open={showDeleteConfirm}
          onOpenChange={(o) => !o && setShowDeleteConfirm(false)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Contact Detail"
          description={
            <>
              Are you sure you want to delete the contact detail for{" "}
              <span className="font-semibold text-foreground">{contact?.email}</span>? This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setShowDeleteConfirm(false)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
