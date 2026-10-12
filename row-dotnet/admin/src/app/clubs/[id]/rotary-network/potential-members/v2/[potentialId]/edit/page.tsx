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

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Info, User, Mail, Phone, FileText } from "lucide-react";
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

const TOP_MESSAGE = "Update prospective member information. Provide as much contact information as possible so the club can follow up.";

function FieldLabel({
  children, hint, required, dot,
}: { children: React.ReactNode; hint?: string; required?: boolean; dot: string }) {
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
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

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
            <RotaryLoader size="lg" />
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
        <SectionCard number={1} icon={User} title="Identity" dot="bg-blue-600">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <FieldLabel required dot="bg-blue-500">Name</FieldLabel>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </SectionCard>

        {/* 2. Contact */}
        <SectionCard number={2} icon={Mail} title="Contact Information" dot="bg-emerald-600">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel dot="bg-emerald-500">Email</FieldLabel>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <FieldLabel dot="bg-emerald-500" hint="(e.g. +91 98765 43210)">Mobile Number</FieldLabel>
              <div className="relative">
                <Phone className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 3. Reference */}
        <SectionCard number={3} icon={FileText} title="Reference Details" dot="bg-violet-600">
          <FieldLabel dot="bg-violet-500" hint="(who referred this person, notes, etc.)">Reference</FieldLabel>
          <textarea
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Who referred this person, any notes…"
            rows={4}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </SectionCard>

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
