import Link from "next/link";
import { ExternalLink, Globe, Mail } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { fmtInt } from "@/components/dashboard/formatters";

export type ClubWebsiteState = { status: string; configured: boolean; visitUrl?: string | null };

/** Live site: visit it. Ended or none: the purchase page. Switched off: just says so. */
export function websiteCta({ status, configured, visitUrl }: ClubWebsiteState): { label: string; href: string | null; external: boolean } {
  if ((status === "active" || status === "trial") && visitUrl) return { label: "Visit Website", href: visitUrl, external: true };
  if (status === "expired" || status === "trial_expired") return { label: "Renew Website", href: "/club-admin-dashboard/website-purchase", external: false };
  if (!configured || status === "not_configured") return { label: "Get Website", href: "/club-admin-dashboard/website-purchase", external: false };
  return { label: status === "killed" ? "Website Disabled" : "Website Inactive", href: null, external: false };
}

/** Email credits and the website button of the club's top bar. */
export default function ClubStatusChips({ emailCredits, website }: { emailCredits?: number | null; website?: ClubWebsiteState | null }) {
  const cta = website ? websiteCta(website) : null;
  return (
    <div className="hidden items-center gap-2 lg:flex">
      {emailCredits != null && (
        <span className="row-btn row-btn-sm cursor-default text-muted-foreground" title="Available Email credits">
          <Mail /> Email <span className="tabular-nums">{fmtInt(emailCredits)}</span>
        </span>
      )}
      {cta && (cta.href ? (
        <Button variant="outline" size="sm" asChild>
          {cta.external
            ? <a href={cta.href} target="_blank" rel="noopener noreferrer"><Globe /> {cta.label} <ExternalLink /></a>
            : <Link href={cta.href}><Globe /> {cta.label}</Link>}
        </Button>
      ) : (
        <span className="row-btn row-btn-sm cursor-default text-muted-foreground"><Globe /> {cta.label}</span>
      ))}
    </div>
  );
}
