"use client";

/**
 * Club Admin Dashboard › Volunteers (flagged module "volunteers"): the club's sign-up sheets for events and service
 * projects. Members sign up in the app; anyone else through a sheet's public link.
 */

import { PageHeader } from "@/components/row/AppKit";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { FilterChips } from "@/components/ui/text-buttons";
import ErrorAlert from "@/components/ErrorAlert";
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
    <div className="space-y-6">
      <PageHeader
        title="Volunteers"
        description={<>Sign-up sheets for your events and service projects. Members sign up in the app, anyone else through the sheet&apos;s public link. Hours you record afterwards are added to the project&apos;s man-hours.</>}
        actions={
          <>
<Button asChild>
          <Link href="/club-admin-dashboard/volunteers/new"><Plus className="h-4 w-4" /> New sign-up sheet</Link>
        </Button>
          </>
        }
      />

      {sheets && (archivedCount > 0 || archived) && (
        <FilterChips
          label="Which sheets"
          value={archived ? "archived" : "current"}
          onChange={(v) => setArchived(v === "archived")}
          options={[
            { value: "current", label: "Current" },
            { value: "archived", label: `Archived (${archivedCount})` },
          ]}
        />
      )}

      <DataTable
        caption="Sign-up sheets"
        loading={!shown}
        loadingRows={4}
        rows={shown ?? []}
        rowKey={(s) => s.id}
        className="min-w-0 [&_table]:min-w-[760px]"
        empty={archived ? "No archived sheets." : sheets?.length ? "Every sheet is archived. Start a new one or copy an archived sheet." : "The club has no sign-up sheets yet."}
        columns={[
          {
            key: "title",
            header: "Sheet",
            sortValue: (s) => s.title,
            cell: (s) => (
              <Link href={`/club-admin-dashboard/volunteers/${s.id}`} className="font-medium text-primary hover:underline">{s.title}</Link>
            ),
          },
          { key: "for", header: "For", cell: (s) => [s.eventTitle, s.projectId ? "Service project" : null].filter(Boolean).join(", ") },
          { key: "first", header: "First slot", sortValue: (s) => s.firstStart, cell: (s) => (s.firstStart ? fmt.dateTime(s.firstStart) : "") },
          { key: "filled", header: "Places taken", align: "right", className: "tabular-nums", cell: (s) => `${s.filled} of ${s.capacity}` },
          { key: "hours", header: "Hours", align: "right", className: "tabular-nums", sortValue: (s) => s.hours, cell: (s) => fmt.number(s.hours) },
          {
            key: "status",
            header: "Status",
            cell: (s) => (s.archivedAt ? "Archived" : s.status === "open" ? (s.isPublic ? "Open, public link on" : "Open, members only") : "Closed"),
          },
        ]}
      />

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
