"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Loader2 } from "@/components/icons";
import { MemberRemovalPreview } from "@/types/memberRemoval";

interface Props {
  open: boolean;
  loading: boolean;
  preview: MemberRemovalPreview | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function MemberRemovalDialog({ open, loading, preview, onConfirm, onCancel }: Props) {
  const isLast = preview?.isLastClub === true;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className={`h-8 w-8 ${isLast ? "text-destructive" : "text-amber-600"}`} />
            <AlertDialogTitle className="text-xl">
              {isLast ? "Fully Remove Member" : "Remove Member from Club"}
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        {loading || !preview ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Loading impact preview…</span>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              Removing <span className="font-semibold">{preview.memberName}</span>
              {preview.emailId ? <span className="text-muted-foreground"> ({preview.emailId})</span> : null}
              {" "}from <span className="font-semibold">{preview.clubName}</span>.
            </p>

            {/* Banner — different message based on isLastClub */}
            {isLast ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="font-semibold text-destructive">
                  This is the member&apos;s ONLY club.
                </p>
                <p className="text-destructive/80 mt-1">
                  Profile will be fully deactivated: login will be blocked on web and mobile.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-amber-300/50 bg-amber-50 p-3">
                <p className="font-semibold text-amber-900">
                  Member belongs to other clubs: profile will stay active.
                </p>
              </div>
            )}

            {/* Other clubs */}
            {preview.otherClubs.length > 0 && (
              <Section title={`Other clubs (kept): ${preview.otherClubs.length}`}>
                <ul className="list-disc ml-5 space-y-0.5">
                  {preview.otherClubs.map((c) => (
                    <li key={c.clubId}>{c.clubName}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Roles in this club */}
            {preview.rolesInThisClub.length > 0 && (
              <Section title={`Roles in this club (will be removed): ${preview.rolesInThisClub.length}`}>
                <div className="flex flex-wrap gap-1.5">
                  {preview.rolesInThisClub.map((r) => (
                    <span key={r} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs border border-blue-200">{r}</span>
                  ))}
                </div>
              </Section>
            )}

            {/* All roles (full picture) */}
            {preview.allRoleNames.length > 0 && (
              <Section title={`All current roles: ${preview.allRoleNames.length}`}>
                <div className="flex flex-wrap gap-1.5">
                  {preview.allRoleNames.map((r) => (
                    <span key={r} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">{r}</span>
                  ))}
                </div>
                {isLast && (
                  <p className="text-xs text-muted-foreground mt-2">
                    All roles except <span className="font-semibold">SuperAdmin</span> will be removed (SuperAdmin is kept for audit; login is blocked anyway).
                  </p>
                )}
              </Section>
            )}

            {/* BOD */}
            {preview.bodEntries.length > 0 && (
              <Section title={`Board of Directors (will be removed): ${preview.bodEntries.length}`}>
                <ul className="space-y-0.5">
                  {preview.bodEntries.map((b, i) => (
                    <li key={i}>
                      <span className="font-medium">{b.designationName}</span>
                      <span className="text-muted-foreground">: {b.yearLabel}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* District Committee (level-1) */}
            {(preview.dcCommitteeMemberships?.length ?? 0) > 0 && (
              <Section title={`District Committee (will be removed): ${preview.dcCommitteeMemberships!.length}`}>
                <ul className="space-y-0.5">
                  {preview.dcCommitteeMemberships!.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.designation || "Member"}</span>
                      {c.yearLabel ? <span className="text-muted-foreground">: {c.yearLabel}</span> : null}
                      {c.districtNumber ? <span className="text-muted-foreground">: D{c.districtNumber}</span> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* DC Groups */}
            {preview.dcGroupMemberships.length > 0 && (
              <Section title={`District Committee Groups (will be removed): ${preview.dcGroupMemberships.length}`}>
                <ul className="space-y-0.5">
                  {preview.dcGroupMemberships.map((g, i) => (
                    <li key={i}>
                      <span className="font-medium">{g.groupName}</span>
                      {g.districtNumber ? <span className="text-muted-foreground">: D{g.districtNumber}</span> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Sub-groups */}
            {preview.subGroupMemberships.length > 0 && (
              <Section title={`Sub-groups (will be removed): ${preview.subGroupMemberships.length}`}>
                <ul className="space-y-0.5">
                  {preview.subGroupMemberships.map((s, i) => (
                    <li key={i}>
                      <span className="font-medium">{s.subGroupName}</span>
                      {s.districtNumber ? <span className="text-muted-foreground">: D{s.districtNumber}</span> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Empty state */}
            {preview.rolesInThisClub.length === 0 &&
              preview.bodEntries.length === 0 &&
              (preview.dcCommitteeMemberships?.length ?? 0) === 0 &&
              preview.dcGroupMemberships.length === 0 &&
              preview.subGroupMemberships.length === 0 && (
                <p className="text-muted-foreground italic">No additional module memberships in this club.</p>
              )}
          </div>
        )}

        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading || !preview}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLast ? "Confirm Full Removal" : "Confirm Removal"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}
