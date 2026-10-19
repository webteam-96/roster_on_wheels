"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import MemberForm from "@/components/MemberForm";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getMember, updateMember, getClubMemberHonorary, setClubMemberHonorary } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Member } from "@/types/member";
import { AlertCircle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function EditMemberPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const paramClubId = searchParams.get("clubId");
  const backUrl = paramClubId ? `/clubs/${paramClubId}/members` : "/";
  const { isSuperAdmin, isAdmin, user } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadMember() {
      try {
        const data = await getMember(id);
        // Per-club honorary read-only display — when ?clubId= is in URL,
        // fetch the per-club flag and merge it into the member object so
        // MemberForm can render the disabled checkbox. Failures are silent
        // (member simply not in that club → checkbox stays unchecked).
        if (paramClubId) {
          const clubIdNum = parseInt(paramClubId);
          if (Number.isFinite(clubIdNum) && clubIdNum > 0) {
            try {
              const h = await getClubMemberHonorary(clubIdNum, id);
              data.isHonoraryMember = !!h.isHonorary;
            } catch { /* non-fatal */ }
          }
        }
        setMember(data);
      } catch {
        setError("Failed to load member details.");
      } finally {
        setLoading(false);
      }
    }
    if (id) loadMember();
  }, [id, paramClubId]);

  const handleSubmit = async (data: Partial<Member>) => {
    try {
      // Carry forward existing club membership so backend can update JoinedDate on the right row
      const payload: Partial<Member> = {
        ...data,
        clubId: data.clubId ?? member?.clubId ?? null,
      };
      await updateMember(id, payload);

      // SuperAdmin per-club honorary write — the main member UPDATE path doesn't
      // touch club_members.IsHonoraryMember (it's a per-club column with no place
      // on the UpdateMemberDto). Fire the dedicated PATCH endpoint here so the
      // SuperAdmin's toggle change actually persists. Idempotent — backend just
      // re-sets the same value if unchanged.
      if (isSuperAdmin && paramClubId && data.isHonoraryMember !== undefined) {
        const clubIdNum = parseInt(paramClubId);
        if (Number.isFinite(clubIdNum) && clubIdNum > 0) {
          try {
            await setClubMemberHonorary(clubIdNum, id, !!data.isHonoraryMember);
          } catch (hErr) {
            const msg = hErr instanceof Error ? hErr.message : "Honorary status update failed.";
            setErrorMessage(msg);
            return;     // surface to user; keep success dialog closed
          }
        }
      }

      setShowSuccess(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      const message = axiosErr?.response?.data?.message || "Failed to update member. Please try again.";
      setErrorMessage(message);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  if (error || !member) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold">Error</h3>
          <p className="text-muted-foreground mt-2">
            {error || "Member not found."}
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href={backUrl}>Back to Members</Link>
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <MemberForm
        initialData={member}
        onSubmit={handleSubmit}
        isEdit
        isSuperAdmin={isSuperAdmin}
        isSelfEdit={user?.memberId === id}
        isAdminPartial={isAdmin}
        backUrl={backUrl}
      />
      <SuccessAlert
        open={showSuccess}
        title="Member Updated"
        description="The member has been updated successfully."
        onOk={() => router.push(backUrl)}
      />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
