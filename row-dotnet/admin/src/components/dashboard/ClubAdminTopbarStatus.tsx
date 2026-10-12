"use client";

/**
 * ClubAdminTopbarStatus
 * --------------------------------------------------------------------------
 * Persistent header widget for the Club Admin Dashboard — WhatsApp/Email
 * credit balances + a website status CTA, visible on every tab (not just
 * Overview) since it reads from the shared dashboard cache.
 *
 * Website CTA:
 *   active/trial (live)      -> "Visit Website" (opens visitUrl)
 *   expired/trial_expired    -> "Renew Website" (-> website-purchase)
 *   not configured           -> "Get Website"   (-> website-purchase)
 *   inactive/killed          -> informational, non-clickable
 */

import Link from "next/link";
import { Mail, MessageCircle, Globe, ExternalLink } from "lucide-react";
import { useClubAdminCache } from "@/contexts/ClubAdminDashboardCacheContext";
import { fmtInt } from "@/components/dashboard/formatters";

const CHIP = "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium whitespace-nowrap";

function websiteCta(status: string, configured: boolean, visitUrl: string | null) {
  const live = status === "active" || status === "trial";
  if (live && visitUrl) {
    return {
      label: "Visit Website", href: visitUrl, external: true,
      className: "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100",
    };
  }
  if (status === "expired" || status === "trial_expired") {
    return {
      label: "Renew Website", href: "/club-admin-dashboard/website-purchase", external: false,
      className: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100",
    };
  }
  if (!configured || status === "not_configured") {
    return {
      label: "Get Website", href: "/club-admin-dashboard/website-purchase", external: false,
      className: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100",
    };
  }
  return {
    label: status === "killed" ? "Website Disabled" : "Website Inactive", href: null, external: false,
    className: "bg-slate-100 border-slate-200 text-slate-500",
  };
}

export default function ClubAdminTopbarStatus() {
  const { overview, website } = useClubAdminCache();
  const club = overview?.club;
  if (!club && !website) return null;

  const cta = website ? websiteCta(website.status, website.configured, website.visitUrl) : null;

  return (
    <div className="hidden lg:flex items-center gap-2">
      {club && (
        <>
          <span className={`${CHIP} bg-green-50 border-green-200 text-green-700`} title="Available WhatsApp credits">
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp <span className="tabular-nums">{fmtInt(club.whatsAppCreditBalance ?? 0)}</span>
          </span>
          <span className={`${CHIP} bg-blue-50 border-blue-200 text-blue-700`} title="Available Email credits">
            <Mail className="h-3.5 w-3.5" />
            Email <span className="tabular-nums">{fmtInt(club.emailCreditBalance ?? 0)}</span>
          </span>
        </>
      )}
      {cta && (
        cta.href ? (
          cta.external ? (
            <a href={cta.href} target="_blank" rel="noopener noreferrer" className={`${CHIP} ${cta.className}`}>
              <Globe className="h-3.5 w-3.5" />
              {cta.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <Link href={cta.href} className={`${CHIP} ${cta.className}`}>
              <Globe className="h-3.5 w-3.5" />
              {cta.label}
            </Link>
          )
        ) : (
          <span className={`${CHIP} ${cta.className}`}>
            <Globe className="h-3.5 w-3.5" />
            {cta.label}
          </span>
        )
      )}
    </div>
  );
}
