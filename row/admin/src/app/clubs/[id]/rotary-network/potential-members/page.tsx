"use client";
import { ClearButton } from "@/components/ui/text-buttons";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { PotentialMember } from "@/types/potentialMember";
import {
  getClub,
  getPotentialMembers,
  createPotentialMember,
  updatePotentialMember,
  deletePotentialMember,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import Pagination from "@/components/Pagination";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Search, UserPlus, X, Plus, Pencil, Trash2, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function PotentialMembersPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [members, setMembers] = useState<PotentialMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pageSize = 20;

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingMember, setEditingMember] = useState<PotentialMember | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formMobile, setFormMobile] = useState("");
  const [formReference, setFormReference] = useState("");

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingMember, setDeletingMember] = useState<PotentialMember | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function fetchClub() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch {
        // ignore
      }
    }
    fetchClub();
  }, [clubId]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPotentialMembers(clubId, page, pageSize, search || undefined);
      setMembers(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setMembers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, search]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  const openAddDialog = () => {
    setEditing(false);
    setEditingMember(null);
    setFormName("");
    setFormEmail("");
    setFormMobile("");
    setFormReference("");
    setDialogOpen(true);
  };

  const openEditDialog = (member: PotentialMember) => {
    setEditing(true);
    setEditingMember(member);
    setFormName(member.name);
    setFormEmail(member.email || "");
    setFormMobile(member.mobileNumber || "");
    setFormReference(member.referenceDetails || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setErrorMessage("Please enter a name.");
      return;
    }

    setSaving(true);
    try {
      if (editing && editingMember) {
        await updatePotentialMember(clubId, editingMember.id, {
          name: formName.trim(),
          email: formEmail.trim() || null,
          mobileNumber: formMobile.trim() || null,
          referenceDetails: formReference.trim() || null,
        });
        setSuccessMessage("Potential member updated successfully.");
      } else {
        await createPotentialMember(clubId, {
          name: formName.trim(),
          email: formEmail.trim() || null,
          mobileNumber: formMobile.trim() || null,
          referenceDetails: formReference.trim() || null,
        });
        setSuccessMessage("Potential member added successfully.");
      }
      setDialogOpen(false);
      fetchMembers();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save potential member.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (member: PotentialMember) => {
    setDeletingMember(member);
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    if (!deletingMember) return;
    try {
      await deletePotentialMember(clubId, deletingMember.id);
      setShowDeleteConfirm(false);
      setDeletingMember(null);
      setSuccessMessage("Potential member deleted successfully.");
      fetchMembers();
    } catch {
      setShowDeleteConfirm(false);
      setErrorMessage("Failed to delete potential member.");
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Potential Members` : "Potential Members"}
          description="Manage potential members for this club"
          back={`/clubs/${clubId}/rotary-network`}
          actions={canManage && (
            <Button onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />Add Potential Member
            </Button>
          )}
        />

        {/* Search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email or mobile..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
            {searchInput && (
              <ClearButton onClick={clearSearch} aria-label="Clear search" />
            )}
          </div>
          <Button onClick={handleSearch} size="sm">Search</Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserPlus className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No potential members</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No potential members found matching your search." : canManage ? 'Click "Add Potential Member" to add one.' : "No potential members found for this club."}
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && members.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">S.No.</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mobile Number</TableHead>
                    <TableHead>Reference Details</TableHead>
                    {canManage && (
                      <TableHead className="w-24">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member, index) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell>{member.email || "-"}</TableCell>
                      <TableCell>{member.mobileNumber || "-"}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{member.referenceDetails || "-"}</TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(member)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => confirmDelete(member)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Potential Member" : "Add Potential Member"}</DialogTitle>
              <DialogDescription>
                {editing ? "Update the potential member details." : "Enter the potential member details."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  placeholder="Full name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Email ID</Label>
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <Input
                  placeholder="+1 555 123 4567"
                  value={formMobile}
                  onChange={(e) => setFormMobile(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Reference Details</Label>
                <Textarea
                  placeholder="Who referred this person, any notes..."
                  value={formReference}
                  onChange={(e) => setFormReference(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !formName.trim()}>
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
          title="Delete Potential Member"
          description={
            <>
              Are you sure you want to delete <span className="font-semibold text-foreground">{deletingMember?.name}</span>? This action cannot be undone.
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
