"use client";

import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "@/components/icons";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { getClubCalendarFeed, resetClubCalendarFeed } from "@/services/api";

/** The club's calendar feed (N8 Meetings): a private iCal link to the club's meetings and their join links, for
 *  Google, Outlook or Apple Calendar. A new link stops the old one. Hidden until the "meetings" feature is on. */
export default function CalendarFeedCard({ clubId, canManage }: { clubId: number; canManage: boolean }) {
  const on = useFeatureLoadedOn("meetings");
  const [url, setUrl] = useState<string | null | undefined>(undefined); // undefined while loading
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!on || !clubId) return;
    let cancelled = false;
    getClubCalendarFeed(clubId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [on, clubId]);

  if (!on) return null;

  const issue = async () => {
    if (url && !window.confirm("Calendars that use the current link will stop updating. Create a new link?")) return;
    setBusy(true);
    setMsg(null);
    try {
      setUrl(await resetClubCalendarFeed(clubId));
      setMsg("New link created.");
    } catch {
      setMsg("The link could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Link copied.");
    } catch {
      setMsg("Select the link in the box and copy it.");
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <h3 className="text-sm font-semibold text-slate-800">Calendar feed</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        A private link to the club&apos;s meetings and their join links, for Google, Outlook or Apple Calendar. Share it
        with members only.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {url === undefined ? (
          <Skeleton className="h-8 w-full max-w-md" />
        ) : url ? (
          <>
            <input
              readOnly
              value={url}
              aria-label="Calendar feed link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Copy size={13} /> Copy
            </button>
          </>
        ) : (
          <span className="text-xs text-slate-500">No link yet.</span>
        )}
        {canManage && url !== undefined && (
          <button
            type="button"
            onClick={issue}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={13} /> {url ? "New link" : "Create link"}
          </button>
        )}
      </div>
      {msg && <p role="status" className="mt-2 text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
