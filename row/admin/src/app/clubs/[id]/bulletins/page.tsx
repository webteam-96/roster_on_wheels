"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import { Plus } from "@/components/icons";
import { getBulletins, type BulletinListItem } from "@/services/api";
import { appLocale } from "@/lib/appFormat";

// Club email bulletins: drafts to finish and the archive of sent issues (gap #6).
export default function BulletinsPage() {
  const clubId = Number(useParams().id);
  const [items, setItems] = useState<BulletinListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      setItems(await getBulletins(clubId));
    } catch (err: any) {
      setError(err?.response?.data?.message || "The bulletins could not be loaded.");
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const drafts = items?.filter((b) => b.status !== "Sent") ?? [];
  const sent = items?.filter((b) => b.status === "Sent") ?? [];
  const when = (d: string) => new Date(d).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" });

  const row = (b: BulletinListItem) => (
    <li key={b.id}>
      <Link
        href={`/clubs/${clubId}/bulletins/${b.id}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-3 hover:bg-muted focus-visible:outline focus-visible:outline-2"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-[#1B2C42]">{b.title}</span>
          <span className="text-[13px] text-muted-foreground">
            {b.status === "Sent" && b.sentDate
              ? `Sent ${when(b.sentDate)}${b.totalRecipients ? `, ${b.totalRecipients} members` : ""}${b.subscriberCount ? `, ${b.subscriberCount} subscribers` : ""}`
              : `Started ${when(b.createdDate)}`}
          </span>
        </span>
        <Badge variant={b.status === "Sent" ? "default" : "secondary"}>{b.status}</Badge>
      </Link>
    </li>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl">
        <PageHeader
          title="Club bulletins"
          description="Build the weekly bulletin from club news, upcoming events and birthdays, then send it to members by email."
          back={`/clubs/${clubId}/mass-emails`}
          actions={
              <>
                <Button variant="outline" asChild><Link href={`/clubs/${clubId}/stories`}>Stories to review</Link></Button>
                <Button variant="outline" asChild><Link href={`/clubs/${clubId}/bulletins/subscribers`}>Subscribers</Link></Button>
                <Button asChild>
                  <Link href={`/clubs/${clubId}/bulletins/new`}><Plus className="h-4 w-4 mr-2" />New bulletin</Link>
                </Button>
              </>
            }
        />

        {error ? (
          <ErrorState message={error} onRetry={load} retryLabel="Try again" />
        ) : items === null ? (
          <Panel title="Bulletins"><SkeletonRows rows={5} /></Panel>
        ) : items.length === 0 ? (
          <Panel title="No bulletins yet">
            <p className="text-[15px] text-muted-foreground">Start one with New bulletin. Sent bulletins stay here as the club archive.</p>
          </Panel>
        ) : (
          <>
            {drafts.length > 0 && <Panel title="Drafts"><ul className="divide-y divide-[color:var(--row-line)]">{drafts.map(row)}</ul></Panel>}
            <Panel title="Archive" subtitle="Members read these in the app.">
              {sent.length === 0
                ? <p className="text-[15px] text-muted-foreground">Nothing sent yet.</p>
                : <ul className="divide-y divide-[color:var(--row-line)]">{sent.map(row)}</ul>}
            </Panel>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
