"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { DistrictDashboard, ModuleComingSoonInfo } from "@/types/module";
import { getDistrictDashboard, getDistrictCreditBalance, getModulesComingSoon, getDistrictWebsiteStatus, type WebsiteStatusInfo } from "@/services/api";
import WebsiteStatusPill from "@/components/WebsiteStatusPill";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, MapPin, Mail} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import DashboardModuleGrid from "@/components/DashboardModuleGrid";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictDashboardPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
  const { user, isSuperAdmin, isAdmin, isAG } = useAuth();
  const [data, setData] = useState<DistrictDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingModule, setNavigatingModule] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<{ emailRemaining: number } | null>(null);
  const [websiteStatus, setWebsiteStatus] = useState<WebsiteStatusInfo | null>(null);
  const [comingSoonList, setComingSoonList] = useState<ModuleComingSoonInfo[]>([]);
  // SuperAdmin always bypasses Coming Soon. Other roles see the placeholder for any module flagged in module_master.
  const comingSoonModules = isSuperAdmin
    ? []
    : comingSoonList.filter((m) => m.isComingSoon).map((m) => m.moduleKey);
  const comingSoonDates: Record<string, string | null> = isSuperAdmin
    ? {}
    : Object.fromEntries(comingSoonList.filter((m) => m.isComingSoon).map((m) => [m.moduleKey, m.comingSoonDate]));

  useEffect(() => {
    async function fetchCredits() {
      try {
        const balance = await getDistrictCreditBalance(districtId);
        setCreditBalance(balance);
      } catch {
        // silently ignore — endpoint forbids non-SA/non-DA users
      }
      try {
        setWebsiteStatus(await getDistrictWebsiteStatus(districtId));
      } catch {
        // silently ignore
      }
    }
    fetchCredits();
  }, [districtId]);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const [result, csList] = await Promise.all([getDistrictDashboard(districtId), getModulesComingSoon().catch(() => [])]);
        setData(result);
        setComingSoonList(csList);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    fetchDashboard();
  }, [districtId]);

  // District-admin-only with single district: no back button (they'd loop)
  const isDistrictAdminOnly = isAdmin && !isSuperAdmin && !isAG;
  // ?returnTo=/some/path overrides the default — used by Settings → Global Search
  // and any other entry point that wants the back button to return to its own page.
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const dashboardBackHref = returnTo ?? "/";

  const handleModuleClick = (moduleKey: string, routeUrl: string | null) => {
    if (navigatingModule) return;
    // External URL (module hosted on another site)
    if (routeUrl && routeUrl.startsWith("http")) {
      const url = routeUrl.replace("{memberId}", String(user?.memberId || ""));
      window.location.href = url;
      return;
    }
    // Internal navigation
    setNavigatingModule(moduleKey);
    if (moduleKey === "directory") router.push(`/districts/${districtId}/members`);
    else if (moduleKey === "clubs") router.push(`/districts/${districtId}/clubs?view=module`);
    else if (moduleKey === "upcoming_events") router.push(`/districts/${districtId}/upcoming-events`);
    else if (moduleKey === "announcements") router.push(`/districts/${districtId}/announcements`);
    else if (moduleKey === "newsletters") router.push(`/districts/${districtId}/newsletters`);
    else if (moduleKey === "documents") router.push(`/districts/${districtId}/documents`);
    else if (moduleKey === "greetings") router.push(`/districts/${districtId}/greetings`);
    else if (moduleKey === "weblinks" || moduleKey === "web_links") router.push(`/districts/${districtId}/weblinks`);
    else if (moduleKey === "sub_groups") router.push(`/districts/${districtId}/sub-groups`);
    else if (moduleKey === "mass_email") router.push(`/districts/${districtId}/mass-emails`);
    else if (moduleKey === "district_projects") router.push(`/districts/${districtId}/projects`);
    else if (moduleKey === "district_events") router.push(`/districts/${districtId}/district-events`);
    else if (moduleKey === "website_data") router.push(`/districts/${districtId}/website-data`);
    else if (moduleKey === "district_committee") router.push(`/districts/${districtId}/district-committee`);
    else if (moduleKey === "club_monthly_report") router.push(`/districts/${districtId}/club-monthly-report`);
    else if (moduleKey === "ag") router.push(`/districts/${districtId}/ag`);
    else if (moduleKey === "online_event_link") router.push(`/districts/${districtId}/event-payment-links`);
    else if (moduleKey === "citation" || moduleKey === "district_citation") router.push(`/districts/${districtId}/citation`);
    else if (moduleKey === "reports" || moduleKey === "district_report") router.push(`/districts/${districtId}/district-report`);
    else setNavigatingModule(null);
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <Button variant="outline" size="icon" asChild>
                <Link href={dashboardBackHref}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {data ? `District ${data.districtNumber} - Dashboard` : "District Dashboard"}
              </h2>
              <p className="text-muted-foreground text-base">Modules and features</p>
            </div>
          </div>
          {(creditBalance || websiteStatus?.status === "active") && (
            <div className="flex flex-wrap items-center gap-3">
              {creditBalance && (
                <>
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${creditBalance.emailRemaining > 0 ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-red-50 border-red-200 text-red-600"}`}>
                    <Mail className="h-3.5 w-3.5" />
                    <span>Email: {creditBalance.emailRemaining}</span>
                  </div>
                </>
              )}
              <WebsiteStatusPill status={websiteStatus} kind="district" />
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && data && data.moduleGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No modules assigned</h3>
            <p className="text-muted-foreground mt-2">Contact Super Admin to assign modules to this district.</p>
          </div>
        )}

        {!loading && !error && data && data.moduleGroups.length > 0 && (
          <DashboardModuleGrid
            moduleGroups={data.moduleGroups}
            navigatingModule={navigatingModule}
            onModuleClick={handleModuleClick}
            comingSoonModules={comingSoonModules}
            comingSoonDates={comingSoonDates}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}
