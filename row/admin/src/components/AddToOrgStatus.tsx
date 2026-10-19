"use client";

import { Button } from "@/components/ui/button";
import { ADD_TO_ORG_WEBSTORE_URL } from "@/lib/addToOrg";
import { CheckCircle2, ShieldCheck, Download } from "@/components/icons";

/**
 * Status shown in the add-form footer for the "Add to Org" browser extension.
 * When it isn't installed, offers a one-time install button. `installed` comes
 * from useExtensionStatus(): null = checking, false/true = result. A scope
 * disclaimer is always shown beneath the status.
 *
 * Sized for readability (club admins are frequently 50+): larger type, a solid
 * status badge, and a clearly legible note rather than faint fine print.
 */
const ADD_TO_ORG_DISCLAIMER =
  "RI Flow-Bot only helps create new projects in Rotary's Service Project Center. " +
  "It does not modify, sync, or delete existing Rotary.org projects.";

export default function AddToOrgStatus({ installed }: { installed: boolean | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <AddToOrgStatusRow installed={installed} />
      <p className="flex max-w-xl items-start gap-2 text-[13.5px] leading-relaxed text-slate-600">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
        <span>{ADD_TO_ORG_DISCLAIMER}</span>
      </p>
    </div>
  );
}

function AddToOrgStatusRow({ installed }: { installed: boolean | null }) {
  if (installed === null) {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-500">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-300" />
        Checking for the Add-to-Org extension…
      </span>
    );
  }

  if (installed) {
    return (
      <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 size={18} className="text-emerald-600" aria-hidden />
        Add-to-Org extension ready
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2.5">
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800 ring-1 ring-amber-300">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
        Extension not installed
      </span>
      <a href={ADD_TO_ORG_WEBSTORE_URL} target="_blank" rel="noopener noreferrer">
        <Button type="button" variant="outline" className="h-9 gap-2 px-3.5 text-sm font-semibold">
          <Download size={16} /> Install extension
        </Button>
      </a>
    </span>
  );
}
