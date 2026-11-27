"use client";

/**
 * Business directory for club and district admins: the review queue (members add or edit their listing in the app;
 * every edit waits here for approval) and a search of the district's approved listings, the same list members see in
 * the app and visitors see on the club websites.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import {
  getBusinessListingsForReview, reviewBusinessListing, searchBusinessDirectory,
  type BusinessListing, type ListingStatus, type MapScope,
} from "@/services/api";

const STATUSES: { key: ListingStatus | ""; label: string }[] = [
  { key: "pending", label: "Waiting for approval" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Not approved" },
  { key: "", label: "All" },
];
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

function ListingText({ l }: { l: BusinessListing }) {
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <p className="text-base font-semibold">{l.businessName}</p>
      <p className="text-muted-foreground">
        {[l.classification, l.memberName, l.clubName].filter(Boolean).join(", ")}
      </p>
      {l.description && <p>{l.description}</p>}
      <p className="flex flex-wrap gap-x-4 text-muted-foreground">
        {safeUrl(l.website) && <a className="text-primary underline" href={safeUrl(l.website)} target="_blank" rel="noopener noreferrer">{l.website}</a>}
        {l.phone && <span>{l.phone}</span>}
      </p>
    </div>
  );
}

export default function BusinessDirectoryAdmin({ scope, id }: { scope: MapScope; id: number }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-8">
      <ReviewSection scope={scope} id={id} onError={setError} />
      <SearchSection scope={scope} id={id} onError={setError} />
      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function ReviewSection({ scope, id, onError }: { scope: MapScope; id: number; onError: (m: string) => void }) {
  const fmt = useFormat();
  const [status, setStatus] = useState<ListingStatus | "">("pending");
  const [list, setList] = useState<BusinessListing[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    setList(null);
    getBusinessListingsForReview(scope, id, status || undefined)
      .then(setList)
      .catch((err) => { setList([]); onError(message(err, "Could not load the listings.")); });
  }, [scope, id, status, onError]);
  useEffect(() => { load(); }, [load]);

  const review = async (l: BusinessListing, approve: boolean) => {
    const note = notes[l.id]?.trim();
    if (!approve && !note) { onError("Write a short reason first, so the member knows what to change."); return; }
    setBusy(l.id);
    try {
      await reviewBusinessListing(l.id, approve, note);
      setNotes((n) => ({ ...n, [l.id]: "" }));
      load();
    } catch (err) {
      onError(message(err, "Could not save the review."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="row-h2">Listings to review</h3>
        <p className="text-sm text-muted-foreground">
          Members add their business from the app. A listing shows in the directory only after you approve it, and goes
          back here whenever the member edits it.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {STATUSES.map((s) => (
          <Button key={s.key || "all"} size="sm" variant={status === s.key ? "default" : "outline"} onClick={() => setStatus(s.key)}
            role="tab" aria-selected={status === s.key}>
            {s.label}
          </Button>
        ))}
      </div>
      {list === null ? (
        <TableSkeleton rows={3} />
      ) : list.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No listings here.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {list.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1">
                  <ListingText l={l} />
                  <p className="text-xs text-muted-foreground">
                    {l.status === "pending" ? "Waiting for approval" : l.status === "approved" ? "Approved" : "Not approved"}, updated{" "}
                    {fmt.dateTime(l.modifiedUtc)}
                    {l.reviewNote ? `. Note: ${l.reviewNote}` : ""}
                  </p>
                </div>
                <div className="flex w-full shrink-0 flex-col gap-2 md:w-72">
                  <Input placeholder="Reason, if not approving" value={notes[l.id] ?? ""} maxLength={500}
                    onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))} aria-label="Reason for not approving" />
                  <div className="flex gap-2">
                    {l.status !== "approved" && (
                      <Button size="sm" disabled={busy === l.id} onClick={() => review(l, true)}>
                        {busy === l.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />} Approve
                      </Button>
                    )}
                    {l.status !== "rejected" && (
                      <Button size="sm" variant="outline" disabled={busy === l.id} onClick={() => review(l, false)}>
                        <X className="mr-1 h-4 w-4" /> Do not approve
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function SearchSection({ scope, id, onError }: { scope: MapScope; id: number; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<BusinessListing[] | null>(null);

  const search = useCallback((text: string) => {
    setList(null);
    searchBusinessDirectory(scope, id, text)
      .then(setList)
      .catch((err) => { setList([]); onError(message(err, "Could not search the directory.")); });
  }, [scope, id, onError]);
  useEffect(() => { search(""); }, [search]);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="row-h2">District business directory</h3>
        <p className="text-sm text-muted-foreground">Approved listings of every club in the district.</p>
      </div>
      <form className="flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); search(q); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business, classification, member or club" maxLength={100}
          aria-label="Search the directory" />
        <Button type="submit"><Search className="mr-1 h-4 w-4" /> Search</Button>
      </form>
      {list === null ? (
        <TableSkeleton rows={4} />
      ) : list.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No approved listings match.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((l) => (
            <Card key={l.id}><CardContent className="p-5"><ListingText l={l} /></CardContent></Card>
          ))}
        </div>
      )}
    </section>
  );
}
