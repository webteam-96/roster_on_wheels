"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ClubContactDetail } from "@/types/contactDetail";
import { RotaryYear } from "@/types/rotaryYear";
import {
  getClubContactDetails,
  createClubContactDetail,
  updateClubContactDetail,
  deleteClubContactDetail,
  getRotaryYears,
  getClubContactAvailableYears,
  getClub,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Plus, Pencil, Trash2,
  AlertTriangle, Eye, EyeOff, Phone, Mail,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function ContactDetailsPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [contact, setContact] = useState<ClubContactDetail | null>(null);
  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  // Listing year filter is data-only (years that actually have a contact); popup uses allYears.
  const [dataYears, setDataYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [formYearId, setFormYearId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingContact, setLoadingContact] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canManage = isSuperAdmin || isAdmin;

  // Initial load
  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [clubData, years, dyears] = await Promise.all([
          getClub(clubId),
          getRotaryYears(),
          getClubContactAvailableYears(clubId),
        ]);
        setClubName(clubData.clubName);
        setAllYears(years);
        setDataYears(dyears);
        const currentYear = dyears.find((y) => y.isCurrent) || dyears[0];
        if (currentYear) setSelectedYearId(String(currentYear.id));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchInitial();
  }, [clubId]);

  // Fetch contact when year changes
  const fetchContact = useCallback(async (yearId: number) => {
    setLoadingContact(true);
    try {
      const data = await getClubContactDetails(clubId, yearId);
      setContact(data.length > 0 ? data[0] : null);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load contact details.");
    } finally {
      setLoadingContact(false);
    }
  }, [clubId]);

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
    if (dy.find((y) => String(y.id) === selectedYearId)) { fetchContact(Number(selectedYearId)); return; }
    const cy = dy.find((y) => y.isCurrent) || dy[0];
    if (cy) setSelectedYearId(String(cy.id)); else { setSelectedYearId(""); setContact(null); }
  }, [clubId, selectedYearId, fetchContact]);

  const currentYearId = allYears.find((y) => y.isCurrent)?.id;

  useEffect(() => {
    if (selectedYearId) {
      fetchContact(Number(selectedYearId));
    } else {
      setContact(null);
    }
  }, [selectedYearId, fetchContact]);

  const openAddDialog = () => {
    setEditing(false);
    setFormEmail("");
    setFormPhone("");
    setFormIsActive("1");
    // Popup year defaults to the listing's selected year, else current rotary year.
    setFormYearId(selectedYearId || (currentYearId ? String(currentYearId) : (allYears[0] ? String(allYears[0].id) : "")));
    setDialogOpen(true);
  };

  const openEditDialog = () => {
    if (!contact) return;
    setEditing(true);
    setFormEmail(contact.email);
    setFormPhone(contact.phone);
    setFormIsActive(contact.isActive ? "1" : "0");
    setFormYearId(selectedYearId);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formEmail.trim()) { setErrorMessage("Please enter an email address."); return; }
    if (!formPhone.trim()) { setErrorMessage("Please enter a phone number."); return; }
    if (!editing && !formYearId) { setErrorMessage("Please select a rotary year."); return; }

    setSaving(true);
    try {
      if (editing && contact) {
        await updateClubContactDetail(clubId, contact.id, {
          email: formEmail.trim(),
          phone: formPhone.trim(),
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Contact detail updated successfully.");
        setDialogOpen(false);
        fetchContact(Number(selectedYearId));
      } else {
        await createClubContactDetail(clubId, {
          yearId: Number(formYearId),
          email: formEmail.trim(),
          phone: formPhone.trim(),
          isActive: formIsActive === "1",
        });
        setSuccessMessage("Contact detail added successfully.");
        setDialogOpen(false);
        // New contact may have created the first data for its year — refresh + jump to it.
        await reconcileDataYears(Number(formYearId));
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save contact detail.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!contact) return;
    try {
      await deleteClubContactDetail(clubId, contact.id);
      setShowDeleteConfirm(false);
      setSuccessMessage("Contact detail deleted successfully.");
      // Deleting the last contact of a year removes it from the data-only filter.
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
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update contact detail status.");
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/website-data`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Contact Details` : "Contact Details"}
              </h2>
              <p className="text-muted-foreground text-base">Manage club contact details by year</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openAddDialog} disabled={allYears.length === 0}>
              <Plus className="mr-2 h-4 w-4" />Add Contact
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Year filter — data-only (only years that have contact details) */}
        {!loading && dataYears.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-48">
              <Select value={selectedYearId} onValueChange={setSelectedYearId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {dataYears.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {loadingContact && (
          <div className="flex items-center justify-center py-12">
            <ListPageSkeleton />
          </div>
        )}

        {/* Empty state — no contact details for any year yet */}
        {!loading && !loadingContact && dataYears.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Phone className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No contact details yet</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Contact" to add the first contact detail.' : "No contact details have been added yet."}
            </p>
          </div>
        )}

        {/* Single contact card */}
        {!loading && !loadingContact && contact && (
          <Card className="border-primary/20 max-w-lg">
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant={contact.isActive ? "default" : "secondary"}>
                  {contact.isActive ? "Active" : "Inactive"}
                </Badge>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleToggleActive}>
                      {contact.isActive ? (
                        <><EyeOff className="mr-1 h-4 w-4" />Deactivate</>
                      ) : (
                        <><Eye className="mr-1 h-4 w-4" />Activate</>
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={openEditDialog}>
                      <Pencil className="mr-1 h-4 w-4" />Edit
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                      <Trash2 className="mr-1 h-4 w-4" />Delete
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Mail className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium">{contact.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium">{contact.phone}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add/Edit Contact Detail Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Contact Detail" : "Add Contact Detail"}</DialogTitle>
              <DialogDescription>
                {editing ? "Update the contact detail." : "Enter the email and phone number."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Email */}
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label>Phone *</Label>
                <Input
                  placeholder="+1 555 123 4567"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Rotary Year — only in Add mode (all years) */}
              {!editing && (
                <div className="space-y-2">
                  <Label>Rotary Year</Label>
                  <Select value={formYearId} onValueChange={setFormYearId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a year" />
                    </SelectTrigger>
                    <SelectContent>
                      {allYears.map((y) => (
                        <SelectItem key={y.id} value={String(y.id)}>
                          {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !formEmail.trim() || !formPhone.trim()}>
                {saving ? "Saving..." : editing ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <AlertModal
          open={showDeleteConfirm}
          onOpenChange={(o) => !o && setShowDeleteConfirm(false)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Contact Detail"
          description={
            <>
              Are you sure you want to delete the contact detail for <span className="font-semibold text-foreground">{contact?.email}</span>? This action cannot be undone.
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
    </ProtectedRoute>
  );
}
