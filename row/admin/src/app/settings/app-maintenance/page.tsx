"use client";

/**
 * App Route Maintenance — SuperAdmin switchboard.
 *
 * Flips per-route maintenance flags that the mobile Flutter app obeys.
 * The mobile app polls /api/app/route-maintenance (active rows only) and
 * blocks any route whose RouteKey appears with IsUnderMaintenance=1, OR
 * blocks the whole app when RouteKey='*' is on.
 *
 * Per the spec: ONLY new edits allowed on existing files are api.ts helpers
 * and the DI line in Program.cs. This page is fully self-contained.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Search,
  Settings,
  Wrench,
} from "@/components/icons";

import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorAlert from "@/components/ErrorAlert";
import KpiCard from "@/components/dashboard/KpiCard";
import RotaryLoader from "@/components/RotaryLoader";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

import {
  getAppRouteMaintenanceAll,
  upsertAppRouteMaintenance,
  type AppRouteMaintenanceRow,
} from "@/services/api";

import { appLocale } from "@/lib/appFormat";
// ---------------------------------------------------------------------------
// Static catalog — verbatim from the spec. Keys MUST match the backend seed
// (the unique RouteKey is the join). Groups drive the UI section order.
// ---------------------------------------------------------------------------
type GroupKey =
  | "auth"
  | "zones"
  | "districts"
  | "ag"
  | "clubs"
  | "members"
  | "admin"
  | "zonal_websites_ri"
  | "unified"
  | "tools"
  | "club_tabs"
  | "district_tabs"
  | "ag_tabs";

interface GroupDef {
  key: GroupKey;
  title: string;
  description: string;
  locked?: boolean;
  routes: string[];
}

const GROUPS: GroupDef[] = [
  {
    key: "auth",
    title: "Auth & System",
    description: "Locked: blocking these would lock users out of the app.",
    locked: true,
    routes: [
      "/splash", "/login", "/otp-verify", "/welcome", "/terms",
      "/admin-login", "/forgot-password", "/reset-password", "/home",
      "/app-lock", "/settings/security", "/profile", "/profile/edit",
      "/notifications", "/settings", "/settings/color-theme",
      "/settings/text-size", "/settings/font-family", "/settings/rotary-years",
      "/settings/designations", "/settings/area-of-focus",
    ],
  },
  {
    key: "zones",
    title: "Zones",
    description: "",
    routes: ["/zones", "/zones/new", "/zones/:id/edit", "/zones/:id/districts"],
  },
  {
    key: "districts",
    title: "Districts",
    description: "",
    routes: [
      "/districts", "/districts/new", "/districts/:id/edit",
      "/districts/:id/dashboard", "/districts/:id/overview",
      "/districts/:id/members", "/directory/:memberId",
      "/districts/:id/announcements", "/districts/:id/newsletters",
      "/districts/:id/documents", "/districts/:id/upcoming-events",
      "/districts/:id/projects", "/districts/:id/mass-emails",
      "/districts/:id/clubs", "/districts/:id/greetings",
      "/districts/:id/sub-groups", "/districts/:id/website-data",
      "/districts/:id/website-data/contact-details",
      "/districts/:id/website-data/social-media-links",
      "/districts/:id/website-data/about",
      "/districts/:id/website-data/banners",
      "/districts/:id/website-data/advertisements",
      "/districts/:id/website-data/menu-list", "/districts/:id/weblinks",
      "/districts/:id/club-monthly-report",
      "/districts/:id/club-monthly-report/:yearId/:month",
      "/districts/:id/district-committee",
      "/districts/:id/district-committee/members",
      "/districts/:id/district-committee/groups",
      "/districts/:id/district-committee/groups/:groupId",
      "/districts/:id/district-committee/groups/:groupId/sub-groups",
      "/districts/:id/district-committee/groups/:groupId/sub-groups/:subGroupId",
      "/districts/:id/district-events",
      "/districts/:id/district-citation",
      "/districts/:id/reports",
      "/districts/:id/online-event-link",
      "/districts/:id/event-payment-links/:linkId/members",
      "/districts/:id/club-dues", "/districts/:id/ag",
    ],
  },
  {
    key: "ag",
    title: "AG",
    description: "",
    routes: ["/agdashboard", "/agdashboard/clubs/:id"],
  },
  {
    key: "clubs",
    title: "Clubs",
    description: "",
    routes: [
      "/clubs", "/clubs/new", "/clubs/:id/edit", "/clubs/:id/dashboard",
      "/clubs/:id/overview", "/clubs/:id/members",
      "/clubs/:id/announcements", "/clubs/:id/newsletters",
      "/clubs/:id/documents", "/clubs/:id/upcoming-events",
      "/clubs/:id/attendance", "/clubs/:id/club-monthly-report",
      "/clubs/:id/projects", "/clubs/:id/club-service",
      "/clubs/:id/vocational-service", "/clubs/:id/international-service",
      "/clubs/:id/public-image-initiative",
      "/clubs/:id/new-generation-service",
      "/clubs/:id/board-of-directors", "/clubs/:id/past-presidents",
      "/clubs/:id/greetings", "/clubs/:id/sub-groups",
      "/clubs/:id/mass-emails", "/clubs/:id/membership-dues",
      "/clubs/:id/event-payment-links", "/clubs/:id/trf",
      "/clubs/:id/ocv-gov", "/clubs/:id/ocv-gov/live-documents",
      "/clubs/:id/weblinks",
      "/clubs/:id/website-data", "/clubs/:id/website-data/theme",
      "/clubs/:id/website-data/banners",
      "/clubs/:id/website-data/advertisements",
      "/clubs/:id/website-data/social-media-links",
      "/clubs/:id/website-data/contact-details",
      "/clubs/:id/website-data/menu-list",
      "/clubs/:id/website-data/about", "/clubs/:id/rotary-network",
      "/clubs/:id/rotary-network/potential-members",
      "/clubs/:id/rotary-network/terminated-members",
      "/clubs/:id/citation", "/clubs/:id/reports",
    ],
  },
  {
    key: "members",
    title: "Members",
    description: "",
    routes: ["/members", "/members/new", "/members/:id/edit"],
  },
  {
    key: "admin",
    title: "Admin",
    description: "",
    routes: ["/admin/login-logs", "/admin/role-management"],
  },
  {
    key: "zonal_websites_ri",
    title: "Websites",
    description: "",
    routes: [
      "/my-club-websites",
      "/my-district-websites", "/ag-reports",
    ],
  },
  {
    key: "unified",
    title: "Unified Dashboard",
    description: "",
    routes: [
      "/unified/:districtId",
      "/unified/:districtId/module/:moduleKey",
      "/module-detail/:moduleKey",
    ],
  },
  {
    key: "tools",
    title: "Tools / Misc",
    description: "",
    routes: [
      "/webview", "/club-finder", "/club-finder/:clubId",
      "/find-rotarian", "/find-rotarian/:memberId",
      "/club-calendar", "/district-calendar", "/my-dues",
    ],
  },
  {
    key: "club_tabs",
    title: "Club Dashboard Tabs",
    description: "Per-tab maintenance for /clubs/:id/overview",
    routes: [
      "/clubs/:id/overview#dashboard",
      "/clubs/:id/overview#foundation",
      "/clubs/:id/overview#membership",
      "/clubs/:id/overview#service-projects",
      "/clubs/:id/overview#e-governance",
      "/clubs/:id/overview#communication",
      "/clubs/:id/overview#my-club-website",
      "/clubs/:id/overview#membership-dues",
      "/clubs/:id/overview#payment-links",
    ],
  },
  {
    key: "district_tabs",
    title: "District Dashboard Tabs",
    description: "Per-tab maintenance for /districts/:id/overview",
    routes: [
      "/districts/:id/overview#overview",
      "/districts/:id/overview#membership",
      "/districts/:id/overview#foundation",
      "/districts/:id/overview#communication",
      "/districts/:id/overview#e-governance",
    ],
  },
  {
    key: "ag_tabs",
    title: "AG Dashboard Tabs",
    description: "Per-tab maintenance for /agdashboard",
    routes: [
      "/agdashboard#my-clubs",
      "/agdashboard#membership",
      "/agdashboard#foundation-trf",
      "/agdashboard#goals",
      "/agdashboard#youth-services",
      "/agdashboard#service-projects",
      "/agdashboard#district-view",
    ],
  },
];

// Build a fast lookup set: every route_key that lives in a locked group.
const LOCKED_ROUTE_KEYS = new Set<string>(
  GROUPS.filter((g) => g.locked).flatMap((g) => g.routes),
);

// ---------------------------------------------------------------------------
// Format helpers.
// ---------------------------------------------------------------------------
function fmtDate(d: string | null): string {
  if (!d) return "–";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "–";
  return dt.toLocaleString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// HTML datetime-local input wants "YYYY-MM-DDTHH:mm"; we strip seconds + TZ.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Row component — controls per-route toggle + message + until-date.
// Auto-save: toggle is immediate; text/date debounced 800ms.
// ---------------------------------------------------------------------------
interface RowProps {
  row: AppRouteMaintenanceRow;
  locked: boolean;
  onSaved: (saved: AppRouteMaintenanceRow) => void;
  onError: (msg: string) => void;
}

function RouteRow({ row, locked, onSaved, onError }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [isOn, setIsOn] = useState(row.isUnderMaintenance);
  const [message, setMessage] = useState(row.message ?? "");
  const [until, setUntil] = useState(toLocalInputValue(row.maintenanceUntil));
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-sync from props when parent refreshes (e.g. initial load).
  useEffect(() => {
    setIsOn(row.isUnderMaintenance);
    setMessage(row.message ?? "");
    setUntil(toLocalInputValue(row.maintenanceUntil));
  }, [row.id, row.isUnderMaintenance, row.message, row.maintenanceUntil]);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    async (next: { isOn: boolean; message: string; until: string }) => {
      if (locked) return;
      setSaving(true);
      try {
        await upsertAppRouteMaintenance({
          routeKey: row.routeKey,
          isUnderMaintenance: next.isOn,
          message: next.message.trim() ? next.message.trim() : null,
          maintenanceUntil: next.until ? new Date(next.until).toISOString() : null,
        });
        onSaved({
          ...row,
          isUnderMaintenance: next.isOn,
          message: next.message.trim() ? next.message.trim() : null,
          maintenanceUntil: next.until ? new Date(next.until).toISOString() : null,
          modifiedDate: new Date().toISOString(),
        });
        setSavedFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
      } catch (err: any) {
        onError(
          err?.response?.data?.message ||
            err?.message ||
            "Failed to save route maintenance flag.",
        );
      } finally {
        setSaving(false);
      }
    },
    [row, locked, onSaved, onError],
  );

  // Debounced save for text/date inputs.
  const queueDebouncedSave = useCallback(
    (next: { isOn: boolean; message: string; until: string }) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => persist(next), 800);
    },
    [persist],
  );

  // Immediate save for toggle.
  const handleToggle = (checked: boolean) => {
    if (locked) return;
    setIsOn(checked);
    persist({ isOn: checked, message, until });
  };

  const handleMessageChange = (val: string) => {
    setMessage(val);
    queueDebouncedSave({ isOn, message: val, until });
  };

  const handleUntilChange = (val: string) => {
    setUntil(val);
    queueDebouncedSave({ isOn, message, until: val });
  };

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const isGlobal = row.routeKey === "*";

  return (
    <div
      className={`rounded-lg border ${
        isGlobal
          ? "border-red-300 bg-red-50"
          : isOn
            ? "border-amber-300 bg-amber-50/40"
            : "border-slate-200 bg-white"
      } px-3 py-2.5 transition-colors`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex-shrink-0 text-slate-400 hover:text-slate-700 disabled:opacity-40"
          onClick={() => setExpanded((v) => !v)}
          disabled={locked}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate font-medium ${
                isGlobal ? "text-red-700 text-base" : "text-slate-800 text-sm"
              }`}
              title={row.label ?? row.routeKey}
            >
              {row.label ?? row.routeKey}
            </span>
            {locked && (
              <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
                <Lock className="h-3 w-3" /> LOCKED
              </Badge>
            )}
            {isOn && !isGlobal && (
              <Badge className="text-[10px] bg-amber-500 hover:bg-amber-600 text-white">
                UNDER MAINTENANCE
              </Badge>
            )}
          </div>
          <p
            className={`truncate text-xs font-mono ${
              isGlobal ? "text-red-600" : "text-slate-500"
            }`}
            title={row.routeKey}
          >
            {row.routeKey}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {saving && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
          )}
          {savedFlash && !saving && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 animate-in fade-in">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <Switch
            checked={isOn}
            onCheckedChange={handleToggle}
            disabled={locked}
            className={
              isGlobal && isOn
                ? "data-[state=checked]:bg-red-600"
                : undefined
            }
            aria-label={`Toggle maintenance for ${row.routeKey}`}
          />
        </div>
      </div>

      {expanded && !locked && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_220px]">
          <div>
            <Label className="text-xs text-slate-600">
              Maintenance message
            </Label>
            <Input
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              placeholder="e.g. We're upgrading this section. Back by 6 PM."
              maxLength={500}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600">Maintenance until</Label>
            <Input
              type="datetime-local"
              value={until}
              onChange={(e) => handleUntilChange(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <p className="text-[11px] text-slate-400 sm:col-span-2">
            Last modified: {fmtDate(row.modifiedDate)}
            {row.modifiedDate && row.maintenanceUntil
              ? `  •  Until: ${fmtDate(row.maintenanceUntil)}`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------
export default function AppMaintenancePage() {
  const { isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<AppRouteMaintenanceRow[]>([]);
  const [search, setSearch] = useState("");

  // Build a fast lookup by routeKey.
  const rowsByKey = useMemo(() => {
    const m = new Map<string, AppRouteMaintenanceRow>();
    rows.forEach((r) => m.set(r.routeKey, r));
    return m;
  }, [rows]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAppRouteMaintenanceAll();
      setRows(data);
    } catch (err: any) {
      setErrorMessage(
        err?.response?.data?.message ||
          err?.message ||
          "Failed to load route maintenance list.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) fetchRows();
  }, [isSuperAdmin, fetchRows]);

  // Patch a single row in place after auto-save (no full refetch).
  const handleRowSaved = useCallback((updated: AppRouteMaintenanceRow) => {
    setRows((prev) =>
      prev.map((r) => (r.routeKey === updated.routeKey ? updated : r)),
    );
  }, []);

  const handleRowError = useCallback((msg: string) => {
    setErrorMessage(msg);
  }, []);

  // KPI stats. Track the max modified-date as a numeric epoch to dodge
  // TypeScript's over-narrowing of `Date | null` inside the forEach closure.
  const stats = useMemo(() => {
    let active = 0;
    let maxMs = 0;
    rows.forEach((r) => {
      if (r.isUnderMaintenance) active++;
      if (r.modifiedDate) {
        const t = new Date(r.modifiedDate).getTime();
        if (!isNaN(t) && t > maxMs) maxMs = t;
      }
    });
    return {
      total: rows.length,
      active,
      lastModified: maxMs > 0 ? new Date(maxMs).toISOString() : null,
    };
  }, [rows]);

  // Apply search filter to each group's route list.
  const visibleByGroup = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = new Map<GroupKey, string[]>();
    GROUPS.forEach((g) => {
      const filtered = g.routes.filter((rk) => {
        if (!q) return true;
        if (rk.toLowerCase().includes(q)) return true;
        const row = rowsByKey.get(rk);
        return (row?.label ?? "").toLowerCase().includes(q);
      });
      result.set(g.key, filtered);
    });
    return result;
  }, [search, rowsByKey]);

  // Access denied gate.
  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-3" />
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2 max-w-md">
            Only SuperAdmin can manage App Route Maintenance. This controls
            which mobile app routes are currently blocked for all users.
          </p>
          <Button variant="outline" className="mt-6" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Settings
            </Link>
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  // Find the global row (RouteKey = "*") — always render at top.
  const globalRow = rowsByKey.get("*");

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Wrench className="h-6 w-6" /> App Route Maintenance
            </h2>
            <p className="text-muted-foreground text-base">
              Mark mobile app routes as &quot;under maintenance.&quot; The mobile app
              respects these flags in real time.
            </p>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            title="Total Routes"
            value={stats.total}
            icon={Settings}
            color="blue"
          />
          <KpiCard
            title="Active Maintenance"
            value={stats.active}
            subtitle={stats.active > 0 ? "Mobile users will see blocks" : "All routes open"}
            icon={Wrench}
            color={stats.active > 0 ? "red" : "green"}
          />
          <KpiCard
            title="Last Modified"
            value={stats.lastModified ? fmtDate(stats.lastModified) : "–"}
            icon={AlertTriangle}
            color="gold"
          />
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by label or route key..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16">
            <RotaryLoader size="md" />
          </div>
        ) : (
          <>
            {/* Global switch — render at top, distinct red styling */}
            {globalRow && (
              <Card className="border-red-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-red-700">
                    <AlertTriangle className="h-4 w-4" /> Global Kill Switch
                  </CardTitle>
                  <p className="text-xs text-red-600">
                    Turning this on blocks the ENTIRE mobile app. Use only for
                    emergency maintenance.
                  </p>
                </CardHeader>
                <CardContent>
                  <RouteRow
                    row={globalRow}
                    locked={false}
                    onSaved={handleRowSaved}
                    onError={handleRowError}
                  />
                </CardContent>
              </Card>
            )}

            {/* Per-group sections */}
            {GROUPS.map((group) => {
              const visibleRouteKeys = visibleByGroup.get(group.key) ?? [];
              if (visibleRouteKeys.length === 0 && search.trim()) return null;
              return (
                <Card key={group.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      {group.locked ? (
                        <Lock className="h-4 w-4 text-slate-500" />
                      ) : (
                        <Settings className="h-4 w-4" />
                      )}
                      {group.title}
                      <Badge variant="secondary" className="text-[10px]">
                        {visibleRouteKeys.length}
                      </Badge>
                    </CardTitle>
                    {group.description && (
                      <p className="text-xs text-slate-500">
                        {group.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {visibleRouteKeys.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">
                        No routes match the search.
                      </p>
                    ) : (
                      visibleRouteKeys.map((rk) => {
                        const row = rowsByKey.get(rk);
                        if (!row) {
                          // Backend seed hasn't run yet OR a route is in the
                          // catalog but missing in DB. Render a placeholder.
                          return (
                            <div
                              key={rk}
                              className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
                            >
                              <span className="font-mono">{rk}</span>
                              <span className="ml-2 italic">
                                (not yet seeded: run the API once)
                              </span>
                            </div>
                          );
                        }
                        return (
                          <RouteRow
                            key={row.id}
                            row={row}
                            locked={LOCKED_ROUTE_KEYS.has(row.routeKey)}
                            onSaved={handleRowSaved}
                            onError={handleRowError}
                          />
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
