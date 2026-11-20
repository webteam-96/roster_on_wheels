"use client";

// Contacts merged into this one: what each held just before the merge, who merged it and when.

import { useEffect, useState } from "react";
import { getContactMergeHistory, type ContactMergeHistory, type ContactScope } from "@/services/api";
import { errorText, label } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";

export default function MergeHistory({ scope, ownerId, contactId }: { scope: ContactScope; ownerId: number; contactId: number }) {
  const [rows, setRows] = useState<ContactMergeHistory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getContactMergeHistory(scope, ownerId, contactId)
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { if (live) { setRows([]); setError(errorText(e, "Could not load the merge history.")); } });
    return () => { live = false; };
  }, [scope, ownerId, contactId]);

  if (rows === null) return <Skeleton className="h-10 w-full" />;
  if (error) return <p className="text-xs text-rose-700">{error}</p>;
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1 sm:col-span-2">
      <p className="text-sm font-medium text-slate-700">Merged into this contact</p>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs text-slate-600">
        {rows.map((r) => (
          <li key={r.id} className="px-3 py-2">
            <span className="font-medium text-slate-800">{r.merged.name}</span>
            {[label(r.merged.contactType), r.merged.email, r.merged.mobile, r.merged.organisation].filter(Boolean).map((v) => `, ${v}`).join("")}
            <span className="block text-slate-400">
              {new Date(r.mergedDateUtc).toLocaleString()}{r.mergedBy ? ` by ${r.mergedBy}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
