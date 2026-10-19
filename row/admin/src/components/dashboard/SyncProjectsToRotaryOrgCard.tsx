"use client";

import { useCallback, useEffect, useState } from "react";
import { Puzzle, Zap, ExternalLink } from "@/components/icons";
import { useExtensionStatus } from "@/hooks/useExtensionStatus";
import { isFlowBotEnabled, ADD_TO_ORG_WEBSTORE_URL } from "@/lib/addToOrg";
import { getClubRotaryOrgCredentials } from "@/services/api";
import AddToOrgInstallDialog from "@/components/AddToOrgInstallDialog";

/** Tri-state of the club's saved rotary.org login (club_rotary_org_credentials). */
type CredState = "loading" | "yes" | "no" | "unknown";

/**
 * One status line: coloured dot + label, matching the overview hero strip's
 * chips (Rotary.org Sync / Club Website) so the card speaks the same language.
 * "todo" pulses like the hero's amber chips — it's the state that wants action.
 */
function StatusChip({ tone, label }: { tone: "ok" | "todo" | "pending"; label: string }) {
  const dot =
    tone === "ok" ? "bg-emerald-500" : tone === "todo" ? "bg-amber-500 animate-pulse" : "bg-slate-300";
  const text =
    tone === "ok" ? "text-emerald-700" : tone === "todo" ? "text-amber-700" : "text-slate-500";
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className={`whitespace-nowrap text-xs font-semibold ${text}`}>{label}</span>
    </span>
  );
}

/**
 * Dashboard entry point for the RI Flow-Bot setup dialog (extension install +
 * per-club rotary.org credentials), now showing the two things a club admin
 * actually needs to know before the sync can work:
 *
 *   1. Is the browser extension installed?  → useExtensionStatus() (postMessage
 *      PING/PONG + the `data-add-to-org-ext` marker the content script sets).
 *   2. Has the club's rotary.org username/password been saved?  → the same
 *      GET /api/clubs/{id}/rotary-org-credentials the setup dialog already reads.
 *      Only `hasCredentials` is kept — the response's plaintext username/password
 *      are deliberately dropped on the floor here; the dialog owns those.
 *
 * Both states start as "checking" (grey, no claim) so the card never flashes a
 * false "not installed" before the ~700 ms handshake resolves. Clicking anywhere
 * on the card opens AddToOrgInstallDialog, which is where both problems get fixed;
 * the credential state is re-read when that dialog closes so a just-saved login
 * flips the chip without a reload (the extension chip already re-checks on focus).
 */
export default function SyncProjectsToRotaryOrgCard({ clubId }: { clubId: number }) {
  const installed = useExtensionStatus();
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<CredState>("loading");
  const enabled = isFlowBotEnabled(clubId);

  const loadCreds = useCallback(() => {
    if (!enabled || !clubId) return;
    getClubRotaryOrgCredentials(clubId)
      .then((r) => setCreds(r.hasCredentials ? "yes" : "no"))
      .catch(() => setCreds("unknown"));
  }, [clubId, enabled]);

  useEffect(() => { loadCreds(); }, [loadCreds]);

  if (!enabled) return null;

  const extTone = installed === null ? "pending" : installed ? "ok" : "todo";
  const extLabel =
    installed === null ? "Checking extension…" : installed ? "Extension installed" : "Extension not installed";

  const credTone = creds === "yes" ? "ok" : creds === "no" ? "todo" : "pending";
  const credLabel =
    creds === "yes"
      ? "Rotary.org account connected"
      : creds === "no"
        ? "Add your Rotary.org login"
        : creds === "unknown"
          ? "Rotary.org login: unknown"
          : "Checking Rotary.org login…";

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:border-blue-300 hover:shadow-md">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <div className="relative shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
              <Puzzle className="h-5 w-5 text-blue-600" />
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 ring-2 ring-white">
              <Zap className="h-3 w-3 text-blue-950" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-800">Sync Projects to Rotary.org</div>
            <div className="text-xs text-slate-500">ROW -&gt; Rotary.org</div>
          </div>
          <span className="hidden shrink-0 text-xs font-semibold text-blue-600 sm:block">Manage setup</span>
        </button>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-4 py-2.5">
          <StatusChip tone={extTone} label={extLabel} />
          <div className="hidden h-4 w-px bg-slate-200 sm:block" />
          <StatusChip tone={credTone} label={credLabel} />
          {installed === false && (
            <a
              href={ADD_TO_ORG_WEBSTORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Install extension <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {installed === true && creds === "no" && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Add Rotary.org login
            </button>
          )}
        </div>
      </div>

      <AddToOrgInstallDialog
        clubId={clubId}
        open={open}
        onClose={() => { setOpen(false); loadCreds(); }}
        installed={installed}
      />
    </>
  );
}
