"use client";

/**
 * OCV / GOV v2 landing — frontend overhaul replacement for the v1 page.
 *
 * Data semantics identical to v1: getMonthlyReportYears, getClub. Same 8 category
 * cards (Static / Financial / Trust / Grants / Additional / Dues / Live Documents /
 * Newsletters) plus a "Generate OCV Report" CTA.
 *
 * Routing:
 *   - 6 doc categories  → /clubs/[id]/ocv-gov/v2/[categoryCode]?yearId=…&returnTo=…
 *   - Live Documents    → /clubs/[id]/ocv-gov/v2/live-documents?yearId=…&returnTo=…
 *   - Newsletters       → /clubs/[id]/newsletters/v2?yearId=…&returnTo=<this v2 page>
 *   - Generate Report   → /clubs/[id]/ocv-gov/v2/report?yearId=…&returnTo=…
 *
 * `?returnTo=` is honored for the back arrow; defaults to
 * /club-admin-dashboard/e-governance.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Banknote,
  ShieldCheck,
  Gift,
  FilePlus2,
  IndianRupee,
  Radio,
  Newspaper,
  BarChart3,
  Loader2,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getClub, getMonthlyReportYears } from "@/services/api";
import type { ReportYear } from "@/types/clubMonthlyReport";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorAlert from "@/components/ErrorAlert";
import LoadingLink from "@/components/v2/LoadingLink";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

const DEFAULT_BACK = "/club-admin-dashboard/e-governance";

// ── Category cards (8) ─────────────────────────────────────────────────────

type CardKey =
  | "static_documents"
  | "financial_documents"
  | "trust_documents"
  | "grants"
  | "additional_documents"
  | "dues"
  | "live_documents"
  | "newsletters";

interface OcvCard {
  key: CardKey;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  bg: string;
  ring: string;
  gradient: string;
}

const CARDS: OcvCard[] = [
  {
    key: "static_documents",
    title: "Static Documents",
    description: "Constitution, bylaws and official static documents.",
    icon: FileText,
    accent: "text-blue-600",
    bg: "bg-blue-50",
    ring: "hover:ring-blue-200",
    gradient: "from-blue-50/60 to-white",
  },
  {
    key: "financial_documents",
    title: "Financial Documents",
    description: "Budgets, audits and financial statements.",
    icon: Banknote,
    accent: "text-emerald-600",
    bg: "bg-emerald-50",
    ring: "hover:ring-emerald-200",
    gradient: "from-emerald-50/60 to-white",
  },
  {
    key: "trust_documents",
    title: "Trust Documents",
    description: "Trust deeds, registrations and compliance.",
    icon: ShieldCheck,
    accent: "text-violet-600",
    bg: "bg-violet-50",
    ring: "hover:ring-violet-200",
    gradient: "from-violet-50/60 to-white",
  },
  {
    key: "grants",
    title: "Grants",
    description: "Grant applications, approvals and reports.",
    icon: Gift,
    accent: "text-amber-600",
    bg: "bg-amber-50",
    ring: "hover:ring-amber-200",
    gradient: "from-amber-50/60 to-white",
  },
  {
    key: "additional_documents",
    title: "Additional Documents",
    description: "Other supporting and miscellaneous files.",
    icon: FilePlus2,
    accent: "text-teal-600",
    bg: "bg-teal-50",
    ring: "hover:ring-teal-200",
    gradient: "from-teal-50/60 to-white",
  },
  {
    key: "dues",
    title: "Dues",
    description: "Club dues, payments and receipts.",
    icon: IndianRupee,
    accent: "text-rose-600",
    bg: "bg-rose-50",
    ring: "hover:ring-rose-200",
    gradient: "from-rose-50/60 to-white",
  },
  {
    key: "live_documents",
    title: "Live Documents",
    description: "Module-wise Excel snapshots, downloadable.",
    icon: Radio,
    accent: "text-fuchsia-600",
    bg: "bg-fuchsia-50",
    ring: "hover:ring-fuchsia-200",
    gradient: "from-fuchsia-50/60 to-white",
  },
  {
    key: "newsletters",
    title: "Newsletters",
    description: "Club newsletters and bulletins.",
    icon: Newspaper,
    accent: "text-sky-600",
    bg: "bg-sky-50",
    ring: "hover:ring-sky-200",
    gradient: "from-sky-50/60 to-white",
  },
];

// Named export — the actual view. Accepts optional clubId/embedded so it can be
// rendered inline inside the Club Admin E-Governance page. The route's default
// export (below) is a prop-less wrapper so it still satisfies Next's PageProps.
export function OcvGovV2View({ clubId: propClubId, embedded = false, yearId: globalYearId = null }: { clubId?: number; embedded?: boolean; yearId?: number | null } = {}) {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = propClubId ?? Number(params.id);
  const urlYearId = searchParams.get("yearId");
  const inboundReturnTo = searchParams.get("returnTo");

  // Back arrow always honors inbound returnTo; default to e-governance hub.
  const backHref = inboundReturnTo || DEFAULT_BACK;

  // Two-hop returnTo chain: e-gov → ocv-gov hub → category sub-page → hub → e-gov.
  // Sub-pages get returnTo = THIS hub URL (with inbound returnTo nested), so save
  // returns to the hub, then user clicks back on the hub → e-gov dashboard.
  // EMBEDDED in the dashboard's e-Gov tab → sub-pages return straight to that tab (with its
  // year), not to the standalone hub, which shows its own Year picker.
  const downstreamReturnTo = useMemo(() => {
    if (embedded) {
      return `/club-admin-dashboard/e-governance?${globalYearId != null ? `yearId=${globalYearId}&` : ""}tab=ocv`;
    }
    return `/clubs/${clubId}/ocv-gov/v2${inboundReturnTo ? `?returnTo=${encodeURIComponent(inboundReturnTo)}` : ""}`;
  }, [embedded, globalYearId, inboundReturnTo, clubId]);

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [club, yrs] = await Promise.all([
          getClub(clubId),
          getMonthlyReportYears(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setYears(yrs);
        // Embedded (dashboard) mode: the GLOBAL year drives it (a separate effect syncs it) — don't
        // auto-select the module's own current/first data-year.
        if (globalYearId != null) {
          setSelectedYearId(globalYearId);
        } else if (urlYearId && yrs.some((y) => y.id === Number(urlYearId))) {
          setSelectedYearId(Number(urlYearId));
        } else {
          const cur = yrs.find((y) => y.isCurrent);
          setSelectedYearId(cur ? cur.id : yrs[0]?.id ?? null);
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = (err as any)?.response?.data;
        if (!cancelled) {
          setErrorMessage(
            e?.message || e?.detail || e?.title || (err instanceof Error ? err.message : "Failed to load."),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // urlYearId is consumed once at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  // Embedded in the dashboard → follow the GLOBAL dashboard year, not the module's own dropdown.
  useEffect(() => {
    if (globalYearId != null) setSelectedYearId(globalYearId);
  }, [globalYearId]);

  const yearLabel = years.find((y) => y.id === selectedYearId)?.yearLabel ?? "—";

  function buildHref(card: OcvCard): string {
    const yid = selectedYearId ?? "";
    const rt = encodeURIComponent(downstreamReturnTo);
    if (card.key === "newsletters") {
      return `/clubs/${clubId}/newsletters/v2?yearId=${yid}&returnTo=${rt}`;
    }
    if (card.key === "live_documents") {
      return `/clubs/${clubId}/ocv-gov/v2/live-documents?yearId=${yid}&returnTo=${rt}`;
    }
    return `/clubs/${clubId}/ocv-gov/v2/${card.key}?yearId=${yid}&returnTo=${rt}`;
  }

  const reportHref = `/clubs/${clubId}/ocv-gov/v2/report?yearId=${selectedYearId ?? ""}&returnTo=${encodeURIComponent(downstreamReturnTo)}`;

  const hasNoYear = !selectedYearId;

  const body = (
      <div className="space-y-5">
        {/* Header */}
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-start ${embedded ? "sm:justify-end" : "sm:justify-between"}`}>
          {!embedded && (
          <div className="flex items-start gap-2 min-w-0">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-slate-800 leading-tight">OCV / GOV</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {clubName ? `${clubName} · ` : ""}Official Club Visit / Governor&apos;s Official Visit
              </p>
            </div>
          </div>
          )}

          {/* Year picker — hidden when embedded: the dashboard's global year drives it. */}
          {!embedded && !loading && years.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                <Calendar size={13} /> Year
              </span>
              <select
                value={selectedYearId ?? ""}
                onChange={(e) => setSelectedYearId(e.target.value ? Number(e.target.value) : null)}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[10rem]"
              >
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.yearLabel}
                    {y.isCurrent ? " · current" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Loading guard */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mr-2" size={18} /> Loading…
          </div>
        )}

        {!loading && (
          <>
            {/* Context banner */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-[#003DA5]/[0.04] to-white p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">RY {yearLabel}</p>
                  <p className="text-base font-semibold text-slate-800 mt-0.5">Document compliance hub</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-xl">
                    Upload, review and generate documents required for the Official Club Visit and Governor&apos;s Official Visit. Use the categories below or jump straight to the compliance report.
                  </p>
                </div>
                <LoadingLink
                  href={reportHref}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition ${
                    hasNoYear
                      ? "border-slate-200 text-slate-400 pointer-events-none"
                      : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  }`}
                >
                  <BarChart3 size={14} />
                  Generate OCV Report
                </LoadingLink>
              </div>
            </div>

            {/* 8-card grid */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">Categories</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Manage uploads for each OCV/GOV section.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {CARDS.map((card) => {
                  const Icon = card.icon;
                  const href = buildHref(card);
                  const cardCls =
                    "group relative rounded-xl border border-slate-200 bg-gradient-to-br " +
                    card.gradient +
                    " p-4 transition ring-1 ring-transparent " +
                    card.ring +
                    " hover:shadow-md hover:-translate-y-0.5";

                  if (hasNoYear) {
                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => setErrorMessage("Please select a Rotary Year first.")}
                        className={`${cardCls} text-left cursor-pointer w-full`}
                      >
                        <CardInner card={card} Icon={Icon} />
                      </button>
                    );
                  }

                  return (
                    <LoadingLink
                      key={card.key}
                      href={href}
                      className={cardCls}
                    >
                      <CardInner card={card} Icon={Icon} />
                    </LoadingLink>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
  );

  if (embedded) return body;

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="OCV / GOV"
        pageSubtitle="On-Cloud Verification & GOV documents"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
        {body}
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

// ── Small subcomponent for card body (avoids duplicating markup) ───────────
function CardInner({ card, Icon }: { card: OcvCard; Icon: LucideIcon }) {
  return (
    <>
      <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${card.bg} ${card.accent} mb-3`}>
        <Icon size={20} />
      </div>
      <p className="text-sm font-semibold text-slate-800 leading-tight">{card.title}</p>
      <p className="text-xs text-slate-500 mt-1 leading-snug">{card.description}</p>
      <span className={`absolute top-3 right-3 ${card.accent} opacity-0 group-hover:opacity-100 transition`}>
        <ChevronRight size={16} />
      </span>
    </>
  );
}
