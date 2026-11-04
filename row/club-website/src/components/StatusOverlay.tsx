import { Clock, AlertCircle, Sparkles, Mail, Phone } from "lucide-react";
import type { TenantContext } from "@/lib/tenant";
import { getSupportContact } from "@/lib/support";

// Renders the subscription-state UI:
//   - active        → nothing
//   - trial         → top sticky banner with urgency tier
//   - trial_expired → full-screen "purchase to activate" lock
//   - expired       → full-screen "renew" lock
// Modals are intentionally NOT dismissable — locked sites stay locked.

export function StatusOverlay({ tenant }: { tenant: TenantContext }) {
  if (tenant.status === "active") return null;
  if (tenant.status === "trial") return <TrialBanner days={tenant.daysRemaining} />;
  if (tenant.status === "trial_expired") return <LockModal kind="trial_expired" tenant={tenant} />;
  if (tenant.status === "expired") return <LockModal kind="expired" tenant={tenant} />;
  return null;
}

// ── Trial banner ────────────────────────────────────────────────────────────

function TrialBanner({ days }: { days: number }) {
  // Urgency tiers: green (>=7 days), amber (3-6), red (0-2).
  const tier: "ok" | "warn" | "urgent" =
    days >= 7 ? "ok" : days >= 3 ? "warn" : "urgent";

  const styles: Record<typeof tier, string> = {
    ok:     "bg-emerald-50 text-emerald-900 border-emerald-200",
    warn:   "bg-amber-50 text-amber-900 border-amber-200",
    urgent: "bg-rose-50 text-rose-900 border-rose-200",
  };
  const icon = tier === "urgent" ? AlertCircle : Clock;
  const Icon = icon;

  const label =
    days <= 0 ? "Trial ends today" :
    days === 1 ? "Trial ends tomorrow" :
    `Trial · ${days} day${days === 1 ? "" : "s"} remaining`;

  const support = getSupportContact();
  const renewLink = support.purchaseUrl || (support.email ? `mailto:${support.email}?subject=Activate%20our%20club%20website` : undefined);

  return (
    <div className={`trial-bar w-full border-b ${styles[tier]}`} role="status" aria-live="polite">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-medium">
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span>{label}</span>
        {renewLink && (
          <>
            <span aria-hidden className="opacity-50">·</span>
            <a href={renewLink} className="underline underline-offset-2 font-semibold hover:opacity-80">
              Activate now
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ── Locked modal (trial_expired / expired) ──────────────────────────────────

interface LockModalProps { kind: "trial_expired" | "expired"; tenant: TenantContext }

function LockModal({ kind, tenant }: LockModalProps) {
  const support = getSupportContact();

  const title = kind === "trial_expired" ? "Your trial period has ended" : "This website has expired";
  const lead =
    kind === "trial_expired"
      ? "Thank you for trying our club website service. To keep this site live and accessible to your members and visitors, please purchase a subscription."
      : "Your club website subscription has lapsed. Your content is safely preserved — renew anytime to bring the site back online.";
  const ctaLabel = kind === "trial_expired" ? "Purchase to activate" : "Renew subscription";

  const ctaUrl =
    support.purchaseUrl ||
    support.contactUrl  ||
    (support.email ? `mailto:${support.email}?subject=${encodeURIComponent(kind === "trial_expired" ? "Activate club website" : "Renew club website")}%20-%20${encodeURIComponent(tenant.clubName)}` : undefined);

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-900/95 via-slate-800/95 to-slate-900/95 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Accent strip — uses the brand variable so it tints to the active theme */}
        <div className="h-2 w-full" style={{ background: "linear-gradient(90deg, var(--brand) 0%, var(--brand-accent) 100%)" }} />

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-full mb-5" style={{ background: "color-mix(in srgb, var(--brand) 12%, white)" }}>
            {kind === "trial_expired" ? (
              <Sparkles className="h-7 w-7" style={{ color: "var(--brand)" }} />
            ) : (
              <Clock className="h-7 w-7" style={{ color: "var(--brand)" }} />
            )}
          </div>

          <h2 className="text-2xl sm:text-3xl font-heading text-gray-900 leading-tight">{title}</h2>
          <p className="mt-1 text-sm text-gray-500">{tenant.clubName}</p>

          <p className="mt-5 text-base text-gray-700 leading-relaxed">{lead}</p>

          {ctaUrl && (
            <a
              href={ctaUrl}
              className="mt-7 inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-lg text-white font-semibold shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
              style={{ background: "linear-gradient(135deg, var(--brand) 0%, var(--brand-accent) 100%)" }}
            >
              {ctaLabel}
            </a>
          )}

          {(support.email || support.phone) && (
            <div className="mt-7 pt-5 border-t border-gray-100">
              <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Need help?</p>
              <ul className="space-y-2 text-sm">
                {support.email && (
                  <li className="flex items-center gap-2 text-gray-700">
                    <Mail className="h-4 w-4 flex-shrink-0" style={{ color: "var(--brand)" }} />
                    <a href={`mailto:${support.email}`} className="hover:underline break-all">{support.email}</a>
                  </li>
                )}
                {support.phone && (
                  <li className="flex items-center gap-2 text-gray-700">
                    <Phone className="h-4 w-4 flex-shrink-0" style={{ color: "var(--brand)" }} />
                    <a href={`tel:${support.phone}`} className="hover:underline">{support.phone}</a>
                  </li>
                )}
              </ul>
            </div>
          )}

          {(tenant.subdomain || tenant.clientDomain) && (
            <p className="mt-6 text-[11px] text-gray-400 font-mono break-all">
              Reference: {tenant.clientDomain || tenant.subdomain}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
