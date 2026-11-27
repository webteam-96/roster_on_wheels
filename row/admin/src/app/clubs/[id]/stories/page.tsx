"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import { getClubStories, reviewClubStory, type ClubStory } from "@/services/api";
import { appLocale } from "@/lib/appFormat";

const FILTERS = [
  { key: "Pending", label: "Waiting" },
  { key: "ChangesRequested", label: "Sent back" },
  { key: "Approved", label: "Approved" },
  { key: "Rejected", label: "Rejected" },
] as const;
const STATUS_LABEL: Record<ClubStory["status"], string> = {
  Pending: "Waiting for review", ChangesRequested: "Changes requested", Approved: "Approved", Rejected: "Rejected",
};

/** One story with the editor's decision controls (only while it waits for review). */
function StoryCard({ story, onReview }: {
  story: ClubStory; onReview: (decision: "approve" | "reject" | "changes", note: string | null) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (d: "approve" | "reject" | "changes") => {
    setBusy(true);
    await onReview(d, note.trim() || null);
    setBusy(false);
  };
  const when = (d: string) => new Date(d).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" });

  return (
    <article className="space-y-3 rounded-xl border border-[color:var(--row-line)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="row-h3">{story.title}</h3>
          <p className="text-[13px] text-muted-foreground">{story.authorName ?? "A member"}, sent {when(story.submittedDate)}</p>
        </div>
        <Badge variant={story.status === "Approved" ? "default" : "secondary"}>{STATUS_LABEL[story.status]}</Badge>
      </div>
      <p className="whitespace-pre-wrap text-[15px]">{story.body}</p>
      {story.reviewNote && (
        <p className="text-[13px] text-muted-foreground">Note from {story.reviewerName ?? "the editor"}: {story.reviewNote}</p>
      )}
      {story.status === "Pending" && (
        <div className="space-y-2 border-t border-[color:var(--row-line)] pt-3">
          <Label htmlFor={`note-${story.id}`}>Note to the author (needed to send back or reject)</Label>
          <Textarea id={`note-${story.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide("approve")} disabled={busy}>Approve</Button>
            <Button variant="outline" onClick={() => decide("changes")} disabled={busy || !note.trim()}>Ask for changes</Button>
            <Button variant="ghost" className="text-red-700" onClick={() => decide("reject")} disabled={busy || !note.trim()}>Reject</Button>
          </div>
        </div>
      )}
    </article>
  );
}

// Story approval (gap #6): members send stories from the app; editors decide here. Approved stories can go into a
// bulletin and show on the club website.
export default function ClubStoriesPage() {
  const clubId = Number(useParams().id);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("Pending");
  const [data, setData] = useState<{ canReview: boolean; items: ClubStory[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setData(null);
    try {
      setData(await getClubStories(clubId, filter));
    } catch (err: any) {
      setLoadError(err?.response?.data?.message || "The stories could not be loaded.");
    }
  }, [clubId, filter]);

  useEffect(() => { load(); }, [load]);

  const review = async (id: number, decision: "approve" | "reject" | "changes", note: string | null) => {
    try {
      await reviewClubStory(clubId, id, decision, note);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "The decision could not be saved.");
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl">
        <PageHeader
          title="Member stories"
          description="Members send stories from the app. Approve them to use them in a bulletin and show them on the club website."
          back={`/clubs/${clubId}/bulletins`}
        />

        <div role="tablist" aria-label="Story status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button key={f.key} role="tab" aria-selected={filter === f.key} variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}>{f.label}</Button>
          ))}
        </div>

        {loadError ? <ErrorState message={loadError} onRetry={load} retryLabel="Try again" />
          : data === null ? <Panel title="Stories"><SkeletonRows rows={4} /></Panel>
          : !data.canReview ? (
            <Panel title="Only editors review stories">
              <p className="text-[15px] text-muted-foreground">The club&apos;s managers and the Public Image or Bulletin Editor office on this year&apos;s board review stories.</p>
            </Panel>
          ) : data.items.length === 0 ? (
            <Panel title="Nothing here">
              <p className="text-[15px] text-muted-foreground">No stories with this status.</p>
            </Panel>
          ) : (
            <div className="space-y-3">
              {data.items.map((s) => <StoryCard key={s.id} story={s} onReview={(d, n) => review(s.id, d, n)} />)}
            </div>
          )}
      </div>
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </ProtectedRoute>
  );
}
