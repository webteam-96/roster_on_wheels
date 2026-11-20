"use client";

/**
 * District Admin Dashboard › Job Board (flag job_board): job postings and business-to-business offers that members of
 * the district post in the app. A post goes live only after an admin approves it; a post with three open abuse reports
 * hides until an admin keeps or removes it. Posts stop showing after their expiry date.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import { getDistrictJobPosts, reviewJobPost, type JobPost, type JobPostFilter } from "@/services/api";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "@/components/icons";

const FILTERS: { key: JobPostFilter; label: string; empty: string }[] = [
  { key: "pending", label: "Waiting for approval", empty: "No posts are waiting for approval." },
  { key: "reported", label: "Reported", empty: "No live post has open reports." },
  { key: "live", label: "Live", empty: "No posts are live right now." },
  { key: "closed", label: "Closed", empty: "No closed posts yet." },
];

const STATUS: Record<JobPost["status"], string> = {
  pending: "Waiting for approval", approved: "Live", rejected: "Rejected", removed: "Removed",
  withdrawn: "Withdrawn by the poster", expired: "Expired",
};

const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function DistrictJobBoardPage() {
  const { selectedDistrictId: districtId } = useAuth();
  const fmt = useFormat();
  const [filter, setFilter] = useState<JobPostFilter>("pending");
  const [posts, setPosts] = useState<JobPost[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!districtId) return;
    setPosts(null);
    getDistrictJobPosts(districtId, filter)
      .then(setPosts)
      .catch((err) => {
        setPosts([]);
        setError(apiMessage(err, "Could not load the job board."));
      });
  }, [districtId, filter]);

  useEffect(load, [load]);

  async function review(p: JobPost, action: "approve" | "reject" | "remove") {
    if (!districtId) return;
    setBusy(p.id);
    try {
      await reviewJobPost(districtId, p.id, action, notes[p.id]?.trim() ?? "");
      setPosts((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch (err) {
      setError(apiMessage(err, "Could not save the review."));
    } finally {
      setBusy(null);
    }
  }

  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  const current = FILTERS.find((f) => f.key === filter)!;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Job board</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Jobs and business offers that members of your district post in the app. Members of the district see a post
            once you approve it, until its expiry date. A post that three members report is hidden until you keep or
            remove it. Your note is shown to the poster.
          </p>
        </div>
        <Button variant="outline" onClick={load} className="gap-1.5">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div role="tablist" aria-label="Posts" className="inline-flex flex-wrap gap-1 rounded-md border p-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {posts == null ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {[0, 1, 2].map((n) => <div key={n} className="h-32 w-full animate-pulse rounded-md bg-muted" />)}
            </div>
          ) : posts.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{current.empty}</p>
          ) : (
            <ul className="divide-y">
              {posts.map((p) => (
                <li key={p.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{p.kind === "job" ? "Job" : "Business offer"}</Badge>
                    <span className="font-medium" data-no-translate>{p.title}</span>
                    <Badge variant="outline">{STATUS[p.status]}</Badge>
                    {p.openReports > 0 && <Badge variant="destructive">{p.openReports} open reports</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[p.company, p.location].filter(Boolean).length > 0 && (
                      <><span data-no-translate>{[p.company, p.location].filter(Boolean).join(", ")}</span>{". "}</>
                    )}
                    Posted by <span data-no-translate>{p.postedBy ?? "a former member"}</span>
                    {p.clubName && <> of <span data-no-translate>{p.clubName}</span></>} on {fmt.date(p.createdAt)}.
                    {" "}Runs until {fmt.date(p.expiresOn.slice(0, 10))}.
                  </p>
                  <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-sm" data-no-translate>
                    {p.description}
                  </p>
                  <p className="text-sm">
                    Contact: <span className="break-all" data-no-translate>{p.contact}</span>
                  </p>
                  {p.reviewNote && (
                    <p className="text-sm text-muted-foreground">
                      Note: <span className="text-foreground" data-no-translate>{p.reviewNote}</span>
                    </p>
                  )}
                  {p.reports && p.reports.length > 0 && (
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {p.reports.map((r) => (
                        <li key={r.id}>
                          Reported by <span data-no-translate>{r.reporterName ?? "a former member"}</span> on {fmt.dateTime(r.reportedAt)}
                          {r.reason ? <>: <span className="text-foreground" data-no-translate>{r.reason}</span></> : ", no reason given."}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(p.status === "pending" || p.status === "approved") && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input className="h-9 w-full sm:w-72" maxLength={500} placeholder="Note for the poster (optional)"
                        aria-label="Note for the poster" value={notes[p.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                      {(p.status === "pending" || p.openReports > 0) && (
                        <Button size="sm" disabled={busy === p.id} onClick={() => review(p, "approve")}>
                          {p.status === "pending" ? "Approve" : "Keep, close the reports"}
                        </Button>
                      )}
                      {p.status === "pending" && (
                        <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => review(p, "reject")}>Reject</Button>
                      )}
                      <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => review(p, "remove")}>Remove</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
