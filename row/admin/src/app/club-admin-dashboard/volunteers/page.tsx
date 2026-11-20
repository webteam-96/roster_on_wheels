"use client";

/**
 * Club Admin Dashboard › Volunteers (flagged module "volunteers"): the club's sign-up sheets for events and service
 * projects. Members sign up in the app; anyone else through a sheet's public link.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import { getVolunteerSheets } from "@/services/api";
import type { VolunteerSheetListItem } from "@/types/volunteers";

export default function VolunteerSheetsPage() {
  const { selectedClubId: clubId } = useAuth();
  const fmt = useFormat();
  const [sheets, setSheets] = useState<VolunteerSheetListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    if (!clubId) return;
    setSheets(null);
    getVolunteerSheets(clubId)
      .then(setSheets)
      .catch((err) => setError(err?.response?.data?.message || "Could not load the sign-up sheets."));
  }, [clubId]);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  const shown = sheets?.filter((s) => !!s.archivedAt === archived) ?? null;
  const archivedCount = sheets?.filter((s) => s.archivedAt).length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Volunteers</h2>
          <p className="text-base text-muted-foreground">
            Sign-up sheets for your events and service projects. Members sign up in the app, anyone else through the
            sheet&apos;s public link. Hours you record afterwards are added to the project&apos;s man-hours.
          </p>
        </div>
        <Button asChild className="gap-1.5">
          <Link href="/club-admin-dashboard/volunteers/new"><Plus className="h-4 w-4" /> New sign-up sheet</Link>
        </Button>
      </div>

      {sheets && (archivedCount > 0 || archived) && (
        <div className="flex gap-2" role="group" aria-label="Which sheets">
          <Button size="sm" variant={archived ? "outline" : "default"} aria-pressed={!archived} onClick={() => setArchived(false)}>Current</Button>
          <Button size="sm" variant={archived ? "default" : "outline"} aria-pressed={archived} onClick={() => setArchived(true)}>
            Archived ({archivedCount})
          </Button>
        </div>
      )}

      {!shown ? (
        <div aria-busy="true"><TableSkeleton rows={4} /></div>
      ) : shown.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">
          {archived ? "No archived sheets." : sheets?.length ? "Every sheet is archived. Start a new one or copy an archived sheet." : "The club has no sign-up sheets yet."}
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Sheet</th>
                  <th className="p-3 font-medium">For</th>
                  <th className="p-3 font-medium">First slot</th>
                  <th className="p-3 text-right font-medium">Places taken</th>
                  <th className="p-3 text-right font-medium">Hours</th>
                  <th className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="p-3">
                      <Link href={`/club-admin-dashboard/volunteers/${s.id}`} className="font-medium text-primary hover:underline">{s.title}</Link>
                    </td>
                    <td className="p-3">{[s.eventTitle, s.projectId ? "Service project" : null].filter(Boolean).join(", ")}</td>
                    <td className="p-3">{s.firstStart ? fmt.dateTime(s.firstStart) : ""}</td>
                    <td className="p-3 text-right tabular-nums">{s.filled} of {s.capacity}</td>
                    <td className="p-3 text-right tabular-nums">{fmt.number(s.hours)}</td>
                    <td className="p-3">{s.archivedAt ? "Archived" : s.status === "open" ? (s.isPublic ? "Open, public link on" : "Open, members only") : "Closed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
