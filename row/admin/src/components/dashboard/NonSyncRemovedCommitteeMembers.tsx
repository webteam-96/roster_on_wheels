"use client";

/**
 * Non-sync cascade (Phase 4) — shared panel.
 *
 * When a club goes non-sync, its committee members are soft-deleted from the
 * district_committee_* tables. This panel surfaces those removed members (greyed)
 * below the live list and lets a DC admin re-add each one as a NON-member
 * (is_member=0, no club link). Rendered on all three levels (committee / group /
 * sub-group) across the V1, /v2 and DA-dashboard committee pages, so the logic
 * lives here once instead of being copied into each page.
 *
 * Renders nothing when there are no removed members.
 */

import { useState, useEffect, useCallback } from "react";
import {
  getNonSyncRemovedCommitteeMembers, addCommitteeMemberAsNonMember,
  getNonSyncRemovedGroupMembers, addGroupMemberAsNonMember,
  getNonSyncRemovedSubGroupMembers, addSubGroupMemberAsNonMember,
  getPhotoUrl,
} from "@/services/api";
import AlertModal from "@/components/AlertModal";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { UserPlus } from "@/components/icons";

type Level = "committee" | "group" | "subgroup";

interface Props {
  districtId: number;
  level: Level;
  yearId?: number;      // committee level (optional filter)
  groupId?: number;     // group level
  subGroupId?: number;  // sub-group level
  onAdded?: () => void;  // let the parent refresh its live list after an add
}

export default function NonSyncRemovedCommitteeMembers({
  districtId, level, yearId, groupId, subGroupId, onAdded,
}: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [addTarget, setAddTarget] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchRemoved = useCallback(async () => {
    if (!districtId) { setItems([]); return; }
    try {
      let res: any = null;
      if (level === "committee") res = await getNonSyncRemovedCommitteeMembers(districtId, yearId);
      else if (level === "group" && groupId) res = await getNonSyncRemovedGroupMembers(districtId, groupId);
      else if (level === "subgroup" && subGroupId) res = await getNonSyncRemovedSubGroupMembers(districtId, subGroupId);
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch {
      setItems([]);
    }
  }, [districtId, level, yearId, groupId, subGroupId]);

  useEffect(() => { fetchRemoved(); }, [fetchRemoved]);

  const handleConfirmAdd = async () => {
    if (!addTarget || busy) return;
    setBusy(true);
    try {
      if (level === "committee") await addCommitteeMemberAsNonMember(districtId, addTarget.id);
      else if (level === "group" && groupId) await addGroupMemberAsNonMember(districtId, groupId, addTarget.id);
      else if (level === "subgroup" && subGroupId) await addSubGroupMemberAsNonMember(districtId, subGroupId, addTarget.id);
      setAddTarget(null);
      setSuccessMessage("Member added as non-member.");
      await fetchRemoved();
      onAdded?.();
    } catch {
      setAddTarget(null);
      setErrorMessage("Failed to add member as non-member. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-amber-800">Removed: club no longer syncing</h3>
        <p className="text-xs text-amber-700">
          These members were removed because their club is no longer synced with Rotary.org.
          You can re-add them to this committee as a non-member.
        </p>
      </div>
      <ul className="divide-y divide-amber-100">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2">
            {m.profilePhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getPhotoUrl(m.profilePhoto)}
                alt={m.name || ""}
                className="h-9 w-9 rounded-full object-cover grayscale"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-500">
                {(m.name?.charAt(0) || "?").toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-600 line-through decoration-slate-400/60">
                {m.name}
              </div>
              <div className="truncate text-xs text-slate-500">
                {[m.districtDesignation, m.clubName].filter(Boolean).join(" • ")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddTarget(m)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-azure px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-ink"
            >
              <UserPlus className="h-3.5 w-3.5" /> Add as non-member
            </button>
          </li>
        ))}
      </ul>

      <AlertModal
        open={!!addTarget}
        onOpenChange={(o) => !o && setAddTarget(null)}
        icon={UserPlus}
        iconClassName="text-ink"
        title="Add as non-member"
        description={
          `This member is deleted from this club because this club is non-sync. ` +
          `Do you want to add ${addTarget?.name || "this member"} as non-member?`
        }
        confirmLabel={busy ? "Adding…" : "Add as non-member"}
        confirmClassName="bg-azure text-white hover:bg-mint-ink"
        onConfirm={handleConfirmAdd}
        cancelLabel="Cancel"
        onCancel={() => setAddTarget(null)}
      />
      <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </div>
  );
}
