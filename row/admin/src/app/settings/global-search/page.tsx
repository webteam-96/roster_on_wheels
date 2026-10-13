"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft, Search, Globe, Building, MapPin, LayoutDashboard, AlertCircle,
  Loader2, Inbox, ChevronRight,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { globalSearchAll, type GlobalSearchResult, type GlobalSearchRow } from "@/services/api";

type ResultRow = GlobalSearchRow & { type: "zone" | "district" | "club" };

// All navigation from this page passes ?returnTo=/settings/global-search so the
// dashboard pages (which already honor that query param across the codebase) send
// the back-button straight back here. The normal Zone → District → Club drill-down
// users never get returnTo, so their back-buttons behave as before — to the parent
// page in the chain.
const RETURN_TO = "/settings/global-search";

// The NEW (V2) club dashboard is scoped by AuthContext.selectedClubId, not by a URL id.
// So opening a club there = set the scope + remember which club (for the header, since a
// SuperAdmin's accessibleClubs never contains it) + stash where "back" should go.
const ACTIVE_CLUB_KEY = "da_active_club";            // { id, name } of a club opened via an override path
const ACTIVE_DISTRICT_KEY = "sa_active_district";     // { id, name } of a district opened from here
const CLUB_DASH_RETURN_KEY = "club_dash_return_to";  // where the borrowed dashboard's Back button returns

function routeFor(row: ResultRow): string {
  const ret = `returnTo=${encodeURIComponent(RETURN_TO)}`;
  if (row.type === "zone")     return `/zonal-dashboard?zoneId=${row.id}`;
  if (row.type === "district") return `/districts/${row.id}/dashboard?${ret}`;
  // club
  const parts: string[] = [];
  if (row.districtId != null) parts.push(`districtId=${row.districtId}`);
  parts.push(ret);
  return `/clubs/${row.id}/dashboard?${parts.join("&")}`;
}

// Some clubs have garbage stored in clubWebsiteSubdomain ("https//rcthanehills/",
// "club.example.org/", etc) — strip protocol prefixes, leading/trailing
// slashes, and any trailing parent-domain suffix so we end up with the bare subdomain.
function clubWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const sub = raw
    .trim()
    .replace(/^https?:?\/+/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.(ROW|ROW|ROW)\.org$/i, "")
    .trim()
    .toLowerCase();
  if (!sub) return null;
  return `https://${sub}.example.org`;
}

// District sites store a FULL url ("https://club.example.org/"), not a bare subdomain like
// the club ones - so take it as it is. A bare word still gets the parent domain appended, and a
// custom domain ("rid3141.org") is left alone instead of being turned into club.example.org.
function districtWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().replace(/^https?:?\/+/i, "").replace(/^\/+/, "").replace(/\/+$/, "").trim().toLowerCase();
  if (!v) return null;
  return v.includes(".") ? `https://${v}` : `https://${v}.example.org`;
}

function badge(type: ResultRow["type"]) {
  if (type === "zone")     return { label: "Zone",     icon: Globe,    color: "bg-purple-100 text-purple-700 border-purple-200" };
  if (type === "district") return { label: "District", icon: MapPin,   color: "bg-blue-100   text-blue-700   border-blue-200"   };
  return                         { label: "Club",     icon: Building, color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
}

export default function GlobalSearchPage() {
  const { isSuperAdmin, selectScope } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  // Tracks which result row is currently navigating to its dashboard so we can
  // show a spinner on that row (Next.js client-side navigation can take 1-2s
  // on the first hit while the dashboard chunk + data loads — without feedback
  // the SA wonders if the click registered).
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);
  // Which page of results is on screen; a new search starts at the top again.
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateTo = (row: ResultRow) => {
    const key = `${row.type}-${row.id}`;
    if (navigatingKey === key) return; // already going
    setNavigatingKey(key);
    router.push(routeFor(row));
  };

  // Club + district rows — open in the NEW (V2) dashboard. Those dashboards are scoped by
  // AuthContext (selectedClubId / selectedDistrictId), not by a URL id, so we set the scope
  // then HARD-navigate: crossing into another dashboard shell needs a fresh mount of its
  // layout + cache provider (a soft push reuses this tree and renders blank).
  const openNewDashboard = (row: ResultRow) => {
    const key = `new-${row.type}-${row.id}`;
    if (navigatingKey === key) return;
    setNavigatingKey(key);
    try {
      sessionStorage.setItem(CLUB_DASH_RETURN_KEY, RETURN_TO);
      // Remember the borrowed scope's name. A SuperAdmin's accessibleClubs/accessibleDistricts
      // never contain it, so the header would otherwise fall back to THEIR own club/district.
      if (row.type === "club") {
        localStorage.setItem(ACTIVE_CLUB_KEY, JSON.stringify({ id: row.id, name: row.label }));
      } else {
        localStorage.setItem(ACTIVE_DISTRICT_KEY, JSON.stringify({ id: row.id, name: row.label }));
      }
    } catch { /* ignore storage errors */ }

    if (row.type === "club") {
      selectScope({ clubId: row.id });
      window.location.assign("/club-admin-dashboard");
    } else {
      selectScope({ districtId: row.id });
      window.location.assign("/district-admin-dashboard");
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResult(null);
      setHasSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      setHasSearched(true);
      try {
        const data = await globalSearchAll(trimmed);
        setResult(data);
        setPage(1);   // a fresh search always starts on page 1
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Search failed.";
        setError(msg);
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can use Global Search.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const rows: ResultRow[] = result
    ? [
        ...result.zones.map((r): ResultRow => ({ ...r, type: "zone" })),
        ...result.districts.map((r): ResultRow => ({ ...r, type: "district" })),
        ...result.clubs.map((r): ResultRow => ({ ...r, type: "club" })),
      ]
    : [];

  const totalCount = rows.length;

  // 20 to a page (user 2026-10-01), the same as the global member search - a broad term matches
  // hundreds of clubs and the page used to render every one of them. Paged in the browser; the
  // search itself is untouched.
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <ProtectedRoute>
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="mb-4">
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back to Settings
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Search className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Global Search</h1>
            <p className="text-sm text-muted-foreground">
              Search zones, districts or clubs. Click any result to open its dashboard.
            </p>
          </div>
        </div>

        <Card className="mb-4">
          <CardContent className="p-5">
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Zone, District &amp; Club Search
            </label>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                id="zdc-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type at least 2 characters — zone name, district number, or club name"
                className="pl-10"
                autoFocus
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
              )}
            </div>
            {error && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}
          </CardContent>
        </Card>

        {!hasSearched && (
          <div className="text-sm text-slate-500 text-center py-10">
            Type a name or number to start searching.
          </div>
        )}

        {hasSearched && !loading && totalCount === 0 && !error && (
          <Card>
            <CardContent className="p-10 flex flex-col items-center text-slate-500">
              <Inbox className="h-10 w-10 mb-2" />
              <div className="text-sm">No results found for &ldquo;{query.trim()}&rdquo;.</div>
            </CardContent>
          </Card>
        )}

        {totalCount > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-slate-500 mb-1">
              {totalCount} result{totalCount === 1 ? "" : "s"}
              {totalCount > PAGE_SIZE && (
                <span> · showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, totalCount)}</span>
              )}
            </div>
            {pageRows.map((row) => {
              const b = badge(row.type);
              const Icon = b.icon;
              const rowKey = `${row.type}-${row.id}`;
              const newKey = `new-${rowKey}`;
              const isNavigating = navigatingKey === rowKey;
              const isNavigatingNew = navigatingKey === newKey;
              // Once ANY row is navigating, dim everything else so the SA
              // can't queue up extra clicks while the first one's still loading.
              const isOtherNavigating = navigatingKey != null && !isNavigating && !isNavigatingNew;
              const isRotaract = row.type === "club" && row.clubType === "Rotaract Club";
              // The row itself opens the new dashboard; this icon is the way back to the old one.
              const dashboardIcon = row.type === "zone" ? null : (
                <button
                  type="button"
                  disabled={isNavigating || isNavigatingNew || isOtherNavigating}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateTo(row);
                  }}
                  title={`Open the old ${row.type} dashboard`}
                  aria-label={`Open the old ${row.type} dashboard`}
                  className="inline-flex items-center text-slate-400 hover:text-slate-600 disabled:opacity-50"
                >
                  {isNavigating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LayoutDashboard className="h-4 w-4" />
                  )}
                </button>
              );
              return (
                <Card
                  key={rowKey}
                  className={`transition-all ${
                    isNavigating || isNavigatingNew
                      ? "border-primary/40 shadow-sm cursor-wait"
                      : isOtherNavigating
                      ? "opacity-60 pointer-events-none"
                      : "hover:border-primary/40 hover:shadow-sm cursor-pointer"
                  }`}
                  // The new dashboard is the primary destination, so the whole row goes there.
                  // Zones have no V2 dashboard — their row keeps the old one.
                  onClick={() => (row.type === "zone" ? navigateTo(row) : openNewDashboard(row))}
                >
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full border ${b.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${b.color}`}>
                          {b.label}
                        </span>
                        <span className="font-medium text-slate-800 truncate">{row.label}</span>
                      </div>
                      {(row.subLabel || row.type === "district") && (
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          {row.subLabel && <span>{row.subLabel}</span>}
                          {/* Districts have no detail line of their own, so their icon rides here. */}
                          {row.type === "district" && dashboardIcon}
                        </div>
                      )}
                      {/* District rollup line (user 2026-10-01): how big the district is, at a glance. */}
                      {row.type === "district" && (
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span>Active clubs:&nbsp;<span className="text-slate-700 font-medium">{row.clubCount ?? 0}</span></span>
                          <span>Sync:&nbsp;<span className="text-slate-700 font-medium">{row.syncedClubCount ?? 0}</span></span>
                          <span>Non-sync:&nbsp;<span className="text-slate-700 font-medium">{row.nonSyncedClubCount ?? 0}</span></span>
                          <span>Members:&nbsp;<span className="text-slate-700 font-medium">{row.memberCount ?? 0}</span></span>
                          <span>
                            Website:&nbsp;
                            {row.districtWebsiteStatus === "active" ? (
                              districtWebsiteUrl(row.districtWebsiteClientDomain || row.districtWebsiteSubdomain) ? (
                                <a
                                  href={districtWebsiteUrl(row.districtWebsiteClientDomain || row.districtWebsiteSubdomain)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-600 hover:underline font-medium"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Yes
                                </a>
                              ) : (
                                <span className="text-emerald-600 font-medium">Yes</span>
                              )
                            ) : row.districtWebsiteStatus === "expired" ? (
                              <span className="text-amber-600 font-medium">Expired</span>
                            ) : (
                              <span className="text-slate-600">No</span>
                            )}
                          </span>
                        </div>
                      )}
                      {row.type === "zone" && (
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span>Districts:&nbsp;<span className="text-slate-700 font-medium">{row.districtCount ?? 0}</span></span>
                          <span>Clubs:&nbsp;<span className="text-slate-700 font-medium">{row.clubCount ?? 0}</span></span>
                          <span>Members:&nbsp;<span className="text-slate-700 font-medium">{row.memberCount ?? 0}</span></span>
                        </div>
                      )}
                      {row.type === "club" && (
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          {row.clubRotaryId && (
                            <span>
                              Rotary ID:&nbsp;
                              <span className="text-slate-700 font-medium">{row.clubRotaryId}</span>
                            </span>
                          )}
                          <span>
                            Sync:&nbsp;
                            <span className={row.isSyncedFromRotaryOrg ? "text-emerald-600 font-medium" : "text-slate-600"}>
                              {row.isSyncedFromRotaryOrg ? "Yes" : "No"}
                            </span>
                          </span>
                          <span>
                            Members:&nbsp;
                            <span className="text-slate-700 font-medium">{row.memberCount ?? 0}</span>
                          </span>
                          <span>
                            Website:&nbsp;
                            {row.clubWebsiteStatus === "active" ? (
                              clubWebsiteUrl(row.clubWebsiteSubdomain) ? (
                                <a
                                  href={clubWebsiteUrl(row.clubWebsiteSubdomain)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-600 hover:underline font-medium"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Yes
                                </a>
                              ) : (
                                <span className="text-emerald-600 font-medium">Yes</span>
                              )
                            ) : row.clubWebsiteStatus === "expired" ? (
                              <span className="text-red-600 font-medium">Expired</span>
                            ) : (
                              <span className="text-slate-500">No website</span>
                            )}
                          </span>
                          <span>
                            Type:&nbsp;
                            <span className={isRotaract ? "text-pink-600 font-medium" : "text-slate-700 font-medium"}>
                              {row.clubType || "Rotary Club"}
                            </span>
                          </span>
                          {dashboardIcon}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Zones have no V2 dashboard, so their row IS the old dashboard — no
                          separate link needed. Clubs/districts get a quiet opt-out to the old one. */}
                      {/* Row click = new dashboard. The old one lives on the inline icon above. */}
                      {(row.type === "zone" ? isNavigating : isNavigatingNew) ? (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {pageCount > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <span className="text-xs text-slate-500">Page {safePage} of {pageCount}</span>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={safePage === 1} onClick={() => setPage(1)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">First</button>
                  <button type="button" disabled={safePage === 1} onClick={() => setPage((p) => p - 1)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Previous</button>
                  <button type="button" disabled={safePage === pageCount} onClick={() => setPage((p) => p + 1)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
                  <button type="button" disabled={safePage === pageCount} onClick={() => setPage(pageCount)}
                    className="h-7 rounded-md border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Last</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
