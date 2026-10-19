"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, AlertTriangle, Eye, EyeOff, Phone, Mail } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function DistrictContactDetailsPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtName, setDistrictName] = useState("");
  const [contact, setContact] = useState<any>(null);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [allRotaryYears, setAllRotaryYears] = useState<RotaryYear[]>([]);
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
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, allYrs, available] = await Promise.all([getDistrict(districtId), getRotaryYears(), getDistrictContactDetailAvailableYears(districtId)]);
        setDistrictName(`District ${d.districtNumber}`);
        setAllRotaryYears(allYrs);
        const years = available.length > 0 ? available : (allYrs.find((y: any) => y.isCurrent) ? [allYrs.find((y: any) => y.isCurrent)] : []);
        setAllYears(years);
        const cy = years.find((y: any) => y.isCurrent) || years[0];
        if (cy) setSelectedYearId(String(cy.id));
      } catch { setErrorMessage("Failed to load data."); }
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  const fetchContact = useCallback(async (yearId: number) => {
    setLoadingContact(true);
    try {
      const data = await getDistrictContactDetails(districtId, yearId);
      setContact(Array.isArray(data) && data.length > 0 ? data[0] : null);
    } catch { setErrorMessage("Failed to load contact details."); }
    finally { setLoadingContact(false); }
  }, [districtId]);

  useEffect(() => { if (selectedYearId) fetchContact(Number(selectedYearId)); else setContact(null); }, [selectedYearId, fetchContact]);

  const openAddDialog = () => { setEditing(false); setFormEmail(""); setFormPhone(""); setFormIsActive("1"); setDialogOpen(true); };
  const openEditDialog = () => { if (!contact) return; setEditing(true); setFormEmail(contact.email); setFormPhone(contact.phone); setFormIsActive(contact.isActive ? "1" : "0"); setDialogOpen(true); };

  const handleSave = async () => {
    if (!formEmail.trim()) { setErrorMessage("Please enter an email."); return; }
    if (!formPhone.trim()) { setErrorMessage("Please enter a phone number."); return; }
    setSaving(true);
    try {
      if (editing && contact) {
        await updateDistrictContactDetail(districtId, contact.id, { email: formEmail.trim(), phone: formPhone.trim(), isActive: formIsActive === "1" });
        setSuccessMessage("Contact detail updated.");
      } else {
        await createDistrictContactDetail(districtId, { yearId: Number(selectedYearId), email: formEmail.trim(), phone: formPhone.trim(), isActive: formIsActive === "1" });
        setSuccessMessage("Contact detail added.");
      }
      setDialogOpen(false);
      fetchContact(Number(selectedYearId));
      try { const av = await getDistrictContactDetailAvailableYears(districtId); if (av.length > 0) setAllYears(av); } catch {}
    } catch { setErrorMessage("Failed to save."); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!contact) return;
    try { await deleteDistrictContactDetail(districtId, contact.id); setShowDeleteConfirm(false); setSuccessMessage("Contact detail deleted."); fetchContact(Number(selectedYearId)); }
    catch { setShowDeleteConfirm(false); setErrorMessage("Failed to delete."); }
  };

  const handleToggleActive = async () => {
    if (!contact) return;
    try { await updateDistrictContactDetail(districtId, contact.id, { email: contact.email, phone: contact.phone, isActive: !contact.isActive }); setSuccessMessage(contact.isActive ? "Deactivated." : "Activated."); fetchContact(Number(selectedYearId)); }
    catch { setErrorMessage("Failed to update status."); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">{districtName ? `${districtName} - Contact Details` : "Contact Details"}</h2>
              <p className="text-muted-foreground text-base">Manage district contact details by year</p>
            </div>
          </div>
          {canManage && !contact && !loading && !loadingContact && selectedYearId && (
            <Button onClick={openAddDialog}><Plus className="mr-2 h-4 w-4" />Add Contact</Button>
          )}
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && allYears.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>{allYears.map((y) => (<SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </div>
        )}

        {loadingContact && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && !loadingContact && selectedYearId && !contact && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Phone className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No contact details yet</h3>
            <p className="text-muted-foreground mt-2">{canManage ? 'Click "Add Contact" to add contact details.' : "No contact details added yet."}</p>
          </div>
        )}

        {!loading && !loadingContact && contact && (
          <Card className="border-primary/20 max-w-lg">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant={contact.isActive ? "default" : "secondary"}>{contact.isActive ? "Active" : "Inactive"}</Badge>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleToggleActive}>{contact.isActive ? <><EyeOff className="mr-1 h-4 w-4" />Deactivate</> : <><Eye className="mr-1 h-4 w-4" />Activate</>}</Button>
                    <Button variant="outline" size="sm" onClick={openEditDialog}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"><Mail className="h-4 w-4 text-primary" /></div>
                  <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{contact.email}</p></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"><Phone className="h-4 w-4 text-primary" /></div>
                  <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{contact.phone}</p></div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editing ? "Edit Contact Detail" : "Add Contact Detail"}</DialogTitle><DialogDescription>{editing ? "Update the contact detail." : "Enter email and phone."}</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label>Email *</Label><Input type="email" placeholder="email@example.com" value={formEmail} onChange={e => setFormEmail(e.target.value)} /></div>
              <div className="space-y-2"><Label>Phone *</Label><Input placeholder="+1 555 123 4567" value={formPhone} onChange={e => setFormPhone(e.target.value)} /></div>
              <div className="space-y-2"><Label>Status</Label><Select value={formIsActive} onValueChange={setFormIsActive}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Active</SelectItem><SelectItem value="0">Inactive</SelectItem></SelectContent></Select></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !formEmail.trim() || !formPhone.trim()}>{saving ? "Saving..." : editing ? "Update" : "Add"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal open={showDeleteConfirm} onOpenChange={(o) => !o && setShowDeleteConfirm(false)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Contact Detail" description="Are you sure? This action cannot be undone." confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setShowDeleteConfirm(false)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
