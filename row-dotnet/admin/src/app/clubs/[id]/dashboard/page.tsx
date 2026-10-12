"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ClubDashboard, ModuleComingSoonInfo } from "@/types/module";
import { WeblinkTree } from "@/types/weblink";
import { getClubDashboard, getWeblinkTree, getClubCreditBalance, getModulesComingSoon, getClubWebsiteStatus, getClubPendingOfflineApprovals, type WebsiteStatusInfo } from "@/services/api";
import AlertModal from "@/components/AlertModal";
import { ClipboardCheck } from "lucide-react";
import WebsiteStatusPill from "@/components/WebsiteStatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, AlertCircle, Building2, Settings, ExternalLink, FileText, ChevronDown, ChevronUp, Image as ImageIcon, Mail, MessageCircle } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import DashboardModuleGrid from "@/components/DashboardModuleGrid";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubDashboardPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  // ?returnTo=/some/path overrides the default back URL — used by Settings →
  // Global Search and any other entry point that wants the back button to
  // return to its own page.
  const returnTo = searchParams.get("returnTo");
  const clubId = Number(params.id);
  const districtId = searchParams.get("districtId");
  const router = useRouter();
  const { user, isSuperAdmin, isAdmin, isZonalCoordinator } = useAuth();
  const [data, setData] = useState<ClubDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingModule, setNavigatingModule] = useState<string | null>(null);
  const [weblinkTree, setWeblinkTree] = useState<WeblinkTree[]>([]);
  const [expandedWeblinks, setExpandedWeblinks] = useState<Set<number>>(new Set());
  const [creditBalance, setCreditBalance] = useState<{ emailRemaining: number; whatsAppRemaining: number } | null>(null);
  const [websiteStatus, setWebsiteStatus] = useState<WebsiteStatusInfo | null>(null);
  const [comingSoonList, setComingSoonList] = useState<ModuleComingSoonInfo[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ duesId: number; purpose: string; pendingCount: number }>>([]);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  // SuperAdmin always bypasses Coming Soon. Other roles see the placeholder for any module flagged in module_master.
  const comingSoonModules = isSuperAdmin
    ? []
    : comingSoonList.filter((m) => m.isComingSoon).map((m) => m.moduleKey);
  const comingSoonDates: Record<string, string | null> = isSuperAdmin
    ? {}
    : Object.fromEntries(comingSoonList.filter((m) => m.isComingSoon).map((m) => [m.moduleKey, m.comingSoonDate]));
  const canManage = isSuperAdmin || isAdmin;

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const [result, csList] = await Promise.all([getClubDashboard(clubId), getModulesComingSoon().catch(() => [])]);
        setData(result);
        setComingSoonList(csList);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    fetchDashboard();
  }, [clubId]);

  useEffect(() => {
    async function fetchCredits() {
      try {
        const balance = await getClubCreditBalance(clubId);
        setCreditBalance(balance);
      } catch {
        // silently ignore
      }
      try {
        setWebsiteStatus(await getClubWebsiteStatus(clubId));
      } catch {
        // silently ignore
      }
    }
    fetchCredits();
  }, [clubId]);

  useEffect(() => {
    async function fetchWeblinks() {
      try {
        const tree = await getWeblinkTree(clubId);
        setWeblinkTree(tree);
      } catch {
        // silently ignore — weblinks sidebar just won't show
      }
    }
    fetchWeblinks();
  }, [clubId]);

  // Pending offline payment approvals — shows a popup on dashboard load if any
  // membership_dues records for this club have at least one pending offline
  // payment. OK → jump straight to the dues edit screen so the admin can act.
  // Only Admin / SuperAdmin can approve, so non-admins skip the fetch.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getClubPendingOfflineApprovals(clubId);
        if (cancelled) return;
        if (Array.isArray(list) && list.length > 0) {
          setPendingApprovals(list);
          setPendingDialogOpen(true);
        }
      } catch {
        // silently ignore — popup is a nudge, not critical
      }
    })();
    return () => { cancelled = true; };
  }, [clubId, canManage]);

  const toggleWeblinkExpand = (id: number) => {
    setExpandedWeblinks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleWeblinkClick = (w: WeblinkTree) => {
    if (w.linkType === "URL" && w.linkUrl) {
      window.open(w.linkUrl, "_blank", "noopener,noreferrer");
    } else if (w.linkType === "PDF" && w.pdfPath) {
      window.open(`${API_BASE_URL}${w.pdfPath}`, "_blank", "noopener,noreferrer");
    } else if (w.children && w.children.length > 0) {
      toggleWeblinkExpand(w.id);
    }
  };

  const renderWeblinkChildren = (children: WeblinkTree[], depth: number = 1) => (
    <div className={`space-y-1 ${depth === 1 ? "ml-3" : "ml-6"}`}>
      {children.map((child) => (
        <div key={child.id}>
          <button
            onClick={() => handleWeblinkClick(child)}
            className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm transition-colors"
          >
            {child.logoPath ? (
              <img src={`${API_BASE_URL}${child.logoPath}`} alt="" className="h-5 w-5 rounded object-cover flex-shrink-0" />
            ) : (
              <div className="h-5 w-5 rounded bg-muted flex items-center justify-center flex-shrink-0">
                <ImageIcon className="h-3 w-3 text-muted-foreground" />
              </div>
            )}
            <span className="flex-1 truncate">{child.title}</span>
            {child.linkType === "URL" && <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
            {child.linkType === "PDF" && <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
            {child.children && child.children.length > 0 && (
              expandedWeblinks.has(child.id)
                ? <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                : <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            )}
          </button>
          {child.children && child.children.length > 0 && expandedWeblinks.has(child.id) && (
            renderWeblinkChildren(child.children, depth + 1)
          )}
        </div>
      ))}
    </div>
  );

  // When navigating to a sub-module, append the current URL's districtId +
  // returnTo so the chain back to the original entry point (e.g. Global Search)
  // stays intact across one or more hops. Returns "" if nothing to forward.
  const buildModuleQs = (): string => {
    const params = new URLSearchParams();
    if (districtId) params.set("districtId", districtId);
    const returnTo = searchParams.get("returnTo");
    if (returnTo) params.set("returnTo", returnTo);
    const q = params.toString();
    return q ? `?${q}` : "";
  };
  const qs = buildModuleQs();

  const handleModuleClick = (moduleKey: string, routeUrl: string | null) => {
    if (navigatingModule) return;
    // External URL (e.g. Market Place)
    if (routeUrl && routeUrl.startsWith("http")) {
      const url = routeUrl.replace("{memberId}", String(user?.memberId || ""));
      window.location.href = url;
      return;
    }
    // Internal navigation
    if (moduleKey === "directory") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/members${qs}`);
    } else if (moduleKey === "past_presidents") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/past-presidents${qs}`);
    } else if (moduleKey === "board_of_directors") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/board-of-directors${qs}`);
    } else if (moduleKey === "website_data") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/website-data${qs}`);
    } else if (moduleKey === "rotary_network") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/rotary-network${qs}`);
    } else if (moduleKey === "club_service") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/club-service${qs}`);
    } else if (moduleKey === "vocational_service") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/vocational-service${qs}`);
    } else if (moduleKey === "international_service") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/international-service${qs}`);
    } else if (moduleKey === "new_generation_service") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/new-generation-service${qs}`);
    } else if (moduleKey === "public_image_initiative") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/public-image-initiative${qs}`);
    } else if (moduleKey === "upcoming_events") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/upcoming-events${qs}`);
    } else if (moduleKey === "announcements") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/announcements${qs}`);
    } else if (moduleKey === "newsletters") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/newsletters${qs}`);
    } else if (moduleKey === "documents") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/documents${qs}`);
    } else if (moduleKey === "greetings") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/greetings${qs}`);
    } else if (moduleKey === "attendance") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/attendance${qs}`);
    } else if (moduleKey === "club_monthly_report") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/club-monthly-report${qs}`);
    } else if (moduleKey === "ocv_gov") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/ocv-gov${qs}`);
    } else if (moduleKey === "club_report" || moduleKey === "reports") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/club-report${qs}`);
    } else if (moduleKey === "pph_camp") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/pph-camps${qs}`);
    } else if (moduleKey === "district_citation" || moduleKey === "citation") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/citation${qs}`);
    } else if (moduleKey === "trf_contribution") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/trf${qs}`);
    } else if (["community_service"].includes(moduleKey)) {
      setNavigatingModule(moduleKey);
      // projects route needs `?module=`; merge with the forwarded qs so districtId
      // + returnTo also ride along.
      router.push(`/clubs/${clubId}/projects?module=${moduleKey}${qs ? `&${qs.slice(1)}` : ""}`);
    } else if (moduleKey === "weblinks" || moduleKey === "web_links") {
      // DB seed uses key "web_links" (with underscore) — check both for safety.
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/weblinks${qs}`);
    } else if (moduleKey === "sub_groups") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/sub-groups${qs}`);
    } else if (moduleKey === "event_payment_links" || moduleKey === "online_event_link") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/event-payment-links${qs}`);
    } else if (moduleKey === "membership_dues") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/membership-dues${qs}`);
    } else if (moduleKey === "mass_email") {
      setNavigatingModule(moduleKey);
      router.push(`/clubs/${clubId}/mass-emails${qs}`);
    }
    // Other modules: future implementation
  };

  const totalPending = pendingApprovals.reduce((s, r) => s + (r.pendingCount || 0), 0);
  const firstPending = pendingApprovals[0];

  return (
    <ProtectedRoute>
      <AlertModal
        open={pendingDialogOpen}
        onOpenChange={setPendingDialogOpen}
        icon={ClipboardCheck}
        iconClassName="text-amber-500"
        title="Offline payment approvals pending"
        description={
          firstPending
            ? `${totalPending} offline payment${totalPending === 1 ? "" : "s"} waiting for your approval across ${pendingApprovals.length} dues record${pendingApprovals.length === 1 ? "" : "s"}.${firstPending.purpose ? ` Open "${firstPending.purpose}" now?` : " Open the first one now?"}`
            : ""
        }
        confirmLabel="OK, review now"
        confirmClassName="bg-amber-600 hover:bg-amber-700"
        onConfirm={() => {
          setPendingDialogOpen(false);
          if (firstPending) {
            router.push(`/clubs/${clubId}/membership-dues/${firstPending.duesId}/members`);
          }
        }}
        cancelLabel="Cancel"
        onCancel={() => setPendingDialogOpen(false)}
      />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(isSuperAdmin || isZonalCoordinator) && (
              <Button variant="outline" size="icon" asChild>
                <Link href={returnTo ?? (districtId ? `/districts/${districtId}/clubs` : "/")}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {data ? `${data.clubName} - Dashboard` : "Club Dashboard"}
              </h2>
              <p className="text-muted-foreground text-base">
                {data?.districtNumber ? `District ${data.districtNumber}` : "Modules and features"}
              </p>
            </div>
          </div>
          {(creditBalance || websiteStatus) && (
            <div className="flex flex-wrap items-center gap-3">
              {creditBalance && (
                <>
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${creditBalance.emailRemaining > 0 ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-red-50 border-red-200 text-red-600"}`}>
                    <Mail className="h-3.5 w-3.5" />
                    <span>Email: {creditBalance.emailRemaining}</span>
                  </div>
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${creditBalance.whatsAppRemaining > 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-600"}`}>
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>WhatsApp: {creditBalance.whatsAppRemaining}</span>
                  </div>
                </>
              )}
              <WebsiteStatusPill status={websiteStatus} kind="club" />
              {websiteStatus?.visitUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => window.open(websiteStatus.visitUrl!, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />Visit Website
                </Button>
              )}
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
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No modules assigned</h3>
            <p className="text-muted-foreground mt-2">Contact Super Admin to assign modules to this club.</p>
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
