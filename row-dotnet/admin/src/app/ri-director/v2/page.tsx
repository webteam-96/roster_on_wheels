"use client";

/**
 * RI Director dashboard — V2 design (new slate sidebar shell, like the Zonal Coordinator V2).
 *
 * Single "Report" menu:
 *   • Top: 4 count tiles — Zones / Districts / Clubs / Members (global totals, display only).
 *   • Below: the shared DistrictReportContent (same report as the Zonal Coordinator's, with the
 *     Members subsection hidden) — but GLOBAL scope: a mandatory Zone → District two-step filter
 *     (RI Director can open any district in any zone). The year picker lives inside the report.
 *
 * Reuses existing APIs only: /api/ri-director/context (counts), /api/zones, /api/districts?zoneId=,
 * and the shared district-report endpoints. District/Club-admin reports are never touched.
 */

import { useState, useEffect, Suspense } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import {
  getRiDirectorContext,
  getZones,
  getDistricts,
  getDistrictReportAvailableYears,
  getRotaryYears,
} from "@/services/api";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import RotaryLoader from "@/components/RotaryLoader";
import DistrictReportContent from "@/components/dashboard/DistrictReportContent";
import DashboardSwitcher from "@/components/dashboard/DashboardSwitcher";
import { Menu, X, LogOut, FileText, Layers, MapPin, Building2, Users } from "lucide-react";

import { appLocale } from "@/lib/appFormat";
const SIDEBAR_BG = "#0f172a";
const ACTIVE_BG = "#F7A81B";
const ACTIVE_TEXT = "#1e3a5f";

// Exclude only the placeholder zones so any newly-activated real zone (e.g. Zone 8) auto-appears in
// the dropdown — no whitelist to keep updating. Mirrors the backend count scoping.
const EXCLUDED_ZONE_NAMES = ["Other Zones", "Zone 0"];

function getInitials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

interface Counts { zoneCount: number; districtCount: number; clubCount: number; memberCount: number; }
interface ZoneOpt { id: number; zoneName: string; }
interface DistrictOpt { id: number; districtNumber: string; }

export default function RiDirectorV2Page() {
  const { user, logout, isRIDirector, isSuperAdmin, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [counts, setCounts] = useState<Counts | null>(null);
  const [zones, setZones] = useState<ZoneOpt[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [districts, setDistricts] = useState<DistrictOpt[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [reportYears, setReportYears] = useState<{ id: number; yearLabel: string; isCurrent?: boolean }[]>([]);
  const [reportYearId, setReportYearId] = useState<string>("");

  // Initial load: counts + all zones.
  useEffect(() => {
    (async () => {
      try {
        const [ctx, zoneRes] = await Promise.all([
          getRiDirectorContext().catch(() => null),
          getZones(1, 1000).catch(() => ({ items: [] as any[] })),
        ]);
        if (ctx) setCounts({
          zoneCount: ctx.zoneCount ?? 0, districtCount: ctx.districtCount ?? 0,
          clubCount: ctx.clubCount ?? 0, memberCount: ctx.memberCount ?? 0,
        });
        const zs = (zoneRes?.items || [])
          .filter((z: any) => !EXCLUDED_ZONE_NAMES.includes(z.zoneName))
          .map((z: any) => ({ id: z.id, zoneName: z.zoneName }))
          .sort((a: ZoneOpt, b: ZoneOpt) => String(a.zoneName).localeCompare(String(b.zoneName)));
        setZones(zs);
      } finally { setLoading(false); }
    })();
  }, []);

  // When a zone is picked → load its districts, reset district + year.
  useEffect(() => {
    setDistricts([]); setDistrictId(""); setReportYears([]); setReportYearId("");
    if (!zoneId) return;
    let cancelled = false;
    getDistricts(1, 1000, undefined, undefined, Number(zoneId))
      .then((res) => {
        if (cancelled) return;
        const ds = (res?.items || [])
          .map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }))
          .sort((a: DistrictOpt, b: DistrictOpt) =>
            String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true }));
        setDistricts(ds);
      })
      .catch(() => { if (!cancelled) setDistricts([]); });
    return () => { cancelled = true; };
  }, [zoneId]);

  // When a district (or "All") is picked → load the year list, default to current.
  // "All Districts" has no single district to key data-only years off, so it uses the
  // global rotary-year list; a specific district uses its data-only available years.
  useEffect(() => {
    if (!districtId) { setReportYears([]); setReportYearId(""); return; }
    let cancelled = false;
    const loader = districtId === "all"
      ? getRotaryYears().then((yrs) => (yrs || []).map((y: any) => ({
          id: y.id ?? y.pkYearId, yearLabel: y.yearLabel ?? y.YearLabel, isCurrent: y.isCurrent ?? y.IsCurrent ?? false,
        })))
      : getDistrictReportAvailableYears(Number(districtId));
    loader
      .then((yrs: any[]) => {
        if (cancelled) return;
        setReportYears(yrs || []);
        const cur = (yrs || []).find((y: any) => y.isCurrent);
        setReportYearId(String(cur?.id || yrs?.[0]?.id || ""));
      })
      .catch(() => { if (!cancelled) { setReportYears([]); setReportYearId(""); } });
    return () => { cancelled = true; };
  }, [districtId]);

  if (authLoading || loading) {
    return <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>;
  }
  if (!isRIDirector && !isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="text-lg font-semibold">Access Denied</h3>
        <p className="text-muted-foreground mt-2">Only RI Director can access this dashboard.</p>
      </div>
    );
  }

  const identityName = user?.name ?? "RI Director";
  const initials = getInitials(identityName) || "RI";

  const tiles = [
    { label: "Zones", value: counts?.zoneCount, icon: Layers },
    { label: "Districts", value: counts?.districtCount, icon: MapPin },
    { label: "Clubs", value: counts?.clubCount, icon: Building2 },
    { label: "Members", value: counts?.memberCount, icon: Users },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-white/10">
        <Image src="/brand/row-logo-badge.png" alt="Roster On Wheels" width={140} height={40} className="h-10 w-auto object-contain" priority />
        <p className="text-xs text-slate-400 mt-2 font-medium">RI Director Dashboard</p>
      </div>

      <div className="px-3 py-3 border-b border-white/10">
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>
          <Avatar className="h-9 w-9 rounded-md flex-shrink-0">
            <AvatarFallback className="text-xs font-bold rounded-md" style={{ background: ACTIVE_BG, color: ACTIVE_TEXT }}>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{identityName}</p>
            <p className="text-slate-400 text-xs truncate">RI Director</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 py-4">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-2">Navigation</p>
        <nav className="flex flex-col gap-0.5">
          <button
            className="flex items-center gap-2.5 px-3 py-2.5 mx-0.5 my-0.5 rounded-lg text-sm font-semibold shadow-sm text-left"
            style={{ backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ACTIVE_TEXT }} />
            <span className="truncate">Report</span>
          </button>
        </nav>
      </ScrollArea>

      <Separator className="bg-white/10 mx-3" />

      <div className="px-3 py-3 space-y-2">
        {/* Multi-role: switch to another dashboard the member holds (District/Club Admin, etc.).
            Renders nothing for an RI-Director-only member. */}
        <Suspense fallback={null}>
          <DashboardSwitcher currentKind="ri-director" onNavigate={() => setSidebarOpen(false)} />
        </Suspense>
        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all"
        >
          <LogOut size={14} /><span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex h-screen overflow-hidden bg-slate-50" style={{ top: 0, left: 0 }}>
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0" style={{ background: SIDEBAR_BG }}>
        {sidebarContent}
      </aside>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative flex flex-col w-60 z-10 shadow-2xl" style={{ background: SIDEBAR_BG }}>
            <button className="absolute top-3 right-3 text-slate-400 hover:text-white" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b-2 px-6 h-14 flex items-center justify-between flex-shrink-0 gap-3" style={{ borderBottomColor: ACTIVE_BG }}>
          <div className="flex items-center gap-3 min-w-0">
            <button className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <div className="min-w-0">
              <p className="text-slate-800 font-semibold text-base leading-tight truncate">Report</p>
              <p className="text-slate-400 text-xs mt-0.5 truncate">District-wise reports across all zones</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Count tiles — global totals (display only). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary flex-shrink-0">
                    <t.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">{t.label}</p>
                    <p className="text-2xl font-bold text-slate-800 tabular-nums leading-tight">
                      {t.value == null ? "—" : t.value.toLocaleString(appLocale())}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Mandatory Zone → District filters. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileText className="h-4 w-4 text-slate-500" /> Zone <span className="text-rose-600">*</span>
              </div>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Select a zone…" /></SelectTrigger>
                <SelectContent>
                  {zones.map((z) => <SelectItem key={z.id} value={String(z.id)}>{z.zoneName}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                District <span className="text-rose-600">*</span>
              </div>
              <Select value={districtId} onValueChange={setDistrictId} disabled={!zoneId}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder={zoneId ? "Select a district…" : "Pick a zone first"} />
                </SelectTrigger>
                <SelectContent>
                  {districts.length > 0 && <SelectItem value="all">All Districts</SelectItem>}
                  {districts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
                </SelectContent>
              </Select>

              {districtId && (
                <>
                  <span className="text-sm font-semibold text-slate-800">Year</span>
                  <Select value={reportYearId} onValueChange={setReportYearId}>
                    <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent>
                      {reportYears.map((y) => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
              <p className="text-xs text-slate-400">
                {districtId === "all"
                  ? "All Districts: each report downloads every district in the zone (all clubs) in one file."
                  : "Year list shows only years that have report data for the chosen district."}
              </p>
            </div>
          </div>

          {/* Report — Members subsection hidden (same as Zonal Coordinator); per-club
              dropdowns and AG-wise rows removed for the RI Director view. "All Districts"
              merges every district in the zone into one combined download per report. */}
          {districtId ? (
            <Suspense fallback={<div className="flex justify-center py-16"><RotaryLoader size="lg" /></div>}>
              {districtId === "all" ? (
                <DistrictReportContent
                  districtIds={districts.map((d) => d.id)}
                  initialYearId={Number(reportYearId) || undefined}
                  hideMembers hideClubFilter hideAgReports showGeoColumns
                />
              ) : (
                <DistrictReportContent
                  districtId={Number(districtId)}
                  initialYearId={Number(reportYearId) || undefined}
                  hideMembers hideClubFilter hideAgReports showGeoColumns
                />
              )}
            </Suspense>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-slate-300 mb-4" />
              <h3 className="text-lg font-semibold text-slate-700">Select a zone and district</h3>
              <p className="text-slate-500 mt-2">Choose a zone, then a district, to load its reports.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
