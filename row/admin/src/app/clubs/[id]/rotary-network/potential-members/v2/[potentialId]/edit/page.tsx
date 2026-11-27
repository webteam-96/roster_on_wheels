"use client";

/**
 * Potential Members v2 — Edit.
 *
 * Same data semantics as the v1 inline-dialog flow: name, email,
 * mobileNumber, referenceDetails. Pre-populates from getPotentialMember
 * and submits via updatePotentialMember. Only the visual presentation
 * differs (V2FormShell wrapper, dot-accented section headers, sticky
 * save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Info, User, Mail, Phone, FileText } from "@/components/icons";
import {
  getClub,
  getPotentialMember,
  updatePotentialMember,
} from "@/services/api";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import ProspectPipelineFields, { type PipelineValue } from "@/components/contacts/ProspectPipelineFields";
import ProspectTasksPanel from "@/components/contacts/ProspectTasksPanel";
import { ListPageSkeleton } from "@/components/row/AppKit";

const TOP_MESSAGE = "Update prospective member information. Provide as much contact information as possible so the club can follow up.";

export default function PotentialMembersV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const potentialId = Number(params.potentialId);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/rotary-network/potential-members/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [reference, setReference] = useState("");
  const [pipeline, setPipeline] = useState<PipelineValue>({ stage: "inquiry", ownerMemberId: null, notes: "" });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, member] = await Promise.all([
          getClub(clubId),
          getPotentialMember(clubId, potentialId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setName(member.name || "");
        setEmail(member.email || "");
        setMobile(member.mobileNumber || "");
        setReference(member.referenceDetails || "");
        setPipeline({ stage: member.stage || "inquiry", ownerMemberId: member.ownerMemberId, notes: member.notes || "" });
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } | string } };
        const data = e?.response?.data;
        const msg = typeof data === "string" ? data : data?.message;
        if (!cancelled) setErrorMessage(msg || "Failed to load potential member.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId, potentialId]);

  const handleSave = async () => {
    if (!name.trim()) { setErrorMessage("Please enter a name."); return; }

    setSaving(true);
    try {
      await updatePotentialMember(clubId, potentialId, {
        name: name.trim(),
        email: email.trim() || null,
        mobileNumber: mobile.trim() || null,
        referenceDetails: reference.trim() || null,
        stage: pipeline.stage,
        ownerMemberId: pipeline.ownerMemberId ?? 0, // 0 clears the owner; null would keep the stored one
        notes: pipeline.notes.trim(),
      });
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } | string } };
      const data = e?.response?.data;
      const msg = typeof data === "string" ? data : data?.message;
      setErrorMessage(msg || "Failed to update potential member.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit Potential Member"
          pageSubtitle="Club Admin Dashboard"
          activeNavHref="/club-admin-dashboard/dashboard"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit Potential Member"
        pageSubtitle="Club Admin Dashboard"
        activeNavHref="/club-admin-dashboard/dashboard"
      >
      <V2FormShell
        title="Edit Potential Member"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/rotary-network/potential-members/v2`}
        saving={saving}
        saveLabel="Update Potential Member"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Identity */}
        <SectionCard number={1} icon={User} title="Identity">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <FieldLabel required>Name</FieldLabel>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                
              />
            </div>
          </div>
        </SectionCard>

        {/* 2. Contact */}
        <SectionCard number={2} icon={Mail} title="Contact Information">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                
              />
            </div>
            <div>
              <FieldLabel hint="(e.g. +1 555 123 4567)">Mobile Number</FieldLabel>
              <div className="relative">
                <Phone className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  type="text"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="pl-7 pr-3"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 3. Reference */}
        <SectionCard number={3} icon={FileText} title="Reference Details">
          <FieldLabel hint="(who referred this person, notes, etc.)">Reference</FieldLabel>
          <Textarea
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Who referred this person, any notes…"
            rows={4}
            
          />
        </SectionCard>

        {/* 4. Pipeline (feature contacts_growth) */}
        <ProspectPipelineFields clubId={clubId} number={4} value={pipeline} onChange={setPipeline} />

        {/* 5. Follow-up tasks (feature contacts_growth); saved on their own, not with the form */}
        <ProspectTasksPanel clubId={clubId} prospectId={potentialId} canManage />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description="Potential member updated successfully."
          onOk={() => { setShowSuccessDialog(false); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
