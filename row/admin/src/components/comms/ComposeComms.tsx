"use client";

/**
 * Mass email compose, while the "communication" feature is on (N5): pick a template so each member gets the version
 * in their language (the subject and body typed here stay the fallback), and see what is left of this month's
 * allowance. Sends then use the allowance instead of email credits.
 */

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { getCommTemplates, getCommUsage, type CommTemplate, type CommUsage, type CommsScope } from "@/services/api";
import { SYSTEM_TEMPLATES } from "@/lib/comms";

export default function ComposeComms({ scope, ownerId, templateKey, onTemplateKey, needed }: {
  scope: CommsScope; ownerId: number; templateKey: string; onTemplateKey: (key: string) => void; needed: number;
}) {
  const [templates, setTemplates] = useState<CommTemplate[] | null>(null);
  const [usage, setUsage] = useState<CommUsage | null | undefined>(undefined); // undefined: loading

  useEffect(() => {
    if (!ownerId) return;
    getCommTemplates(scope, ownerId).then(setTemplates).catch(() => setTemplates([]));
    getCommUsage(scope, ownerId).then(setUsage).catch(() => setUsage(null));
  }, [scope, ownerId]);

  const keys = Array.from(new Set((templates ?? []).map((t) => t.templateKey)))
    .filter((k) => !SYSTEM_TEMPLATES.some((s) => s.key === k));
  const languages = (key: string) => (templates ?? []).filter((t) => t.templateKey === key).map((t) => t.language).join(", ");
  const short = usage?.remaining != null && needed > usage.remaining;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <label className="block text-sm font-medium text-slate-700">
        Language versions
        <select className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm md:w-80" value={templateKey}
          onChange={(e) => onTemplateKey(e.target.value)} disabled={templates === null}>
          <option value="">None: everyone gets the text below</option>
          {keys.map((k) => <option key={k} value={k}>{k} ({languages(k)})</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-500">
        With a template, each member gets the version in their language; members without a matching version get the
        subject and body below. Add templates under Email Settings.
      </p>
      {usage === undefined && <Skeleton className="h-4 w-64" />}
      {usage && (
        <p className={`text-sm ${short ? "text-red-700" : "text-slate-600"}`}>
          {usage.remaining == null
            ? "This month's emails are not limited."
            : `${usage.remaining.toLocaleString()} of this month's ${usage.allowance?.toLocaleString()} emails are left${short ? `; this email needs ${needed}.` : "."}`}
        </p>
      )}
    </div>
  );
}
