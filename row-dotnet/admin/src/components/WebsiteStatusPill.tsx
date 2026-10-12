"use client";

import { Globe, ExternalLink } from "lucide-react";
import type { WebsiteStatusInfo } from "@/services/api";

const PILL = "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium";

// Dashboard "Visit Website" pill.
//   kind="club"     → PAID product: shows in every state (active/trial/expired/none).
//   kind="district" → FREE product: only renders when an active site exists (hidden otherwise).
export default function WebsiteStatusPill({
  status,
  kind,
}: {
  status: WebsiteStatusInfo | null;
  kind: "club" | "district";
}) {
  if (!status) return null;

  // ── District (free): only when live ──
  if (kind === "district") {
    if (status.status !== "active" || !status.visitUrl) return null;
    return (
      <a href={status.visitUrl} target="_blank" rel="noopener noreferrer"
         className={`${PILL} bg-green-50 border-green-200 text-green-700 hover:bg-green-100`}>
        <Globe className="h-3.5 w-3.5" />
        <span>Visit District Website</span>
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  // ── Club (paid) ──
  const days = status.daysRemaining ?? 0;
  const dayLabel = `${days} day${days === 1 ? "" : "s"}`;

  if (status.status === "active" && status.visitUrl) {
    const expiringSoon = days <= 30;
    return (
      <a href={status.visitUrl} target="_blank" rel="noopener noreferrer"
         className={`${PILL} ${expiringSoon
            ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
            : "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"}`}
         title={expiringSoon ? "Renew soon to avoid downtime" : "Open your club website"}>
        <Globe className="h-3.5 w-3.5" />
        <span>Visit Website{expiringSoon ? ` · Expires in ${dayLabel}` : ""}</span>
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  if (status.status === "trial" && status.visitUrl) {
    return (
      <a href={status.visitUrl} target="_blank" rel="noopener noreferrer"
         className={`${PILL} bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100`}
         title="Trial site — purchase to keep it live after the trial">
        <Globe className="h-3.5 w-3.5" />
        <span>Visit Website · Trial: {dayLabel} left</span>
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  // Non-live states → informational (not clickable)
  const info: Record<string, string> = {
    expired: "Website expired — renew to restore",
    trial_expired: "Website inactive — purchase to activate",
    not_configured: "No website yet",
  };
  const text = info[status.status] ?? "No website yet";
  const danger = status.status === "expired" || status.status === "trial_expired";
  return (
    <span className={`${PILL} ${danger
        ? "bg-red-50 border-red-200 text-red-600"
        : "bg-muted border-border text-muted-foreground"}`}>
      <Globe className="h-3.5 w-3.5" />
      <span>{text}</span>
    </span>
  );
}
