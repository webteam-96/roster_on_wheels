"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useBrand } from "@/contexts/BrandContext";
import HeaderAdminDashboardLink from "@/components/HeaderAdminDashboardLink";
import { getCreditNotifications } from "@/services/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { User, LogOut, Key, Settings, Clock, ClipboardList, Bell } from "@/components/icons";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import LanguagePicker from "@/components/LanguagePicker";
import BrandLogo from "@/components/BrandLogo";

import { appLocale } from "@/lib/appFormat";
function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface CreditNotification {
  creditType: string;
  remainingCredits: number;
  expiryDate: string;
  daysLeft: number;
}

export default function AppHeader() {
  const { user, isAuthenticated, isSuperAdmin, isAdmin, lastLoginTime, sessionRemaining, logout } = useAuth();
  const brand = useBrand();
  // Only the support details the instance has configured.
  const helpline = [
    brand.support.phones.length ? `Help line No: ${brand.support.phones.join(" / ")}` : "",
    brand.support.hours ? `Time: ${brand.support.hours}` : "",
    brand.support.email ? `Email: ${brand.support.email}` : "",
  ].filter(Boolean).join(" | ");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [notifications, setNotifications] = useState<CreditNotification[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    async function fetchNotifications() {
      try {
        const data = await getCreditNotifications();
        setNotifications(data || []);
      } catch { /* ignore */ }
    }
    fetchNotifications();
  }, [isAuthenticated, isAdmin]);

  // Hide header on public/auth pages
  const hideOnPages = [
    "/login",
    "/forgot-password",
    "/reset-password",
    // Public/marketing pages (Cashfree-compliance landing system).
    // These pages render their own PublicHeader; the V1 AppHeader would
    // collide visually with it for authenticated users browsing policies.
    "/contact-us",
    "/terms-and-conditions",
    "/refunds-and-cancellations",
    "/privacy-policy",
    "/cookies",
    "/about-us",
    "/tutorial",
  ];
  const isPublicPage = pathname.startsWith("/pay/") || pathname.startsWith("/report/") || pathname.startsWith("/public/") || hideOnPages.some(p => pathname.startsWith(p));
  if (isPublicPage) return null;

  // Hide header on V2 dashboard routes — they render their own slate-900
  // sidebar + white topbar via DashboardShell / ClubAdminShell. Without this
  // gate the V1 blue header SSRs first and flashes for ~10ms on every load /
  // Add / Edit click before the V2 fixed shell mounts on top.
  // V1 pages still get the V1 header (this is checked in the global root
  // layout — AppHeader is always rendered, this hook just no-ops on V2 paths).
  const isDashboardRoute =
    pathname.startsWith("/club-admin-dashboard") ||
    pathname.startsWith("/ag-dashboard") ||
    pathname.startsWith("/district-admin-dashboard");
  // V2 pages live at /clubs/[id]/<module>/v2/... — match any segment-bounded /v2/
  // (or trailing /v2) so we don't accidentally match a slug like "v2x".
  const isV2Page = /\/v2(\/|$)/.test(pathname);
  // Greetings Settings (/clubs/{id}/greetings, /districts/{id}/greetings) now
  // render inside ClubAdminShell / DistrictAdminShell, so suppress the V1 header
  // there too (same reason as V2 pages).
  const isGreetingsSettings = /\/(clubs|districts)\/\d+\/greetings(\/|$)/.test(pathname);
  // NOTE: do NOT hide the V1 AppHeader on `/`. SuperAdmin legitimately lands
  // on the home page and needs this header for navigation. The brief flash
  // for users who DO auto-redirect away from `/` is handled by RoleBasedHome
  // showing its loader synchronously (Wave 24) — no need to suppress the
  // header here. Suppressing it broke SuperAdmin's UX.
  if (isDashboardRoute || isV2Page || isGreetingsSettings) return null;

  // Don't show header if not authenticated
  if (!isAuthenticated) return null;

  const isSessionLow = sessionRemaining > 0 && sessionRemaining < 300; // less than 5 min
  // SuperAdmin's logo goes to Global Search (their landing). Scoped to SA on purpose:
  // /settings/global-search is SuperAdmin-only and shows "Access Denied" to anyone else,
  // so Admin/AG must keep their existing target.
  const homeLink = isSuperAdmin ? "/settings/global-search" : "/";

  return (
    <>
      {helpline && (
        <div className="w-full bg-primary-foreground text-primary text-xs py-1 px-8 flex items-center justify-center gap-1 border-b">
          <span>{helpline}</span>
        </div>
      )}
      <header className="sticky top-0 z-50 w-full border-b border-[color:var(--row-line)] bg-white text-foreground shadow-sm">
        <div className="flex h-20 items-center justify-between px-8">
          <Link href={homeLink} className="flex items-center">
            <BrandLogo className="h-16" />
          </Link>


          <nav className="hidden md:flex items-center gap-1">
            <LanguagePicker signedIn={isAuthenticated} className="border-border bg-transparent text-foreground" />
            {/* Multi-role SuperAdmin: prominent way BACK to their own operational dashboard. */}
            {isAuthenticated && <HeaderAdminDashboardLink />}
            {isAuthenticated && isSuperAdmin && (
              <>
                <Button variant="ghost" className="text-foreground hover:bg-muted gap-2" asChild>
                  <Link href="/admin/login-logs">
                    <ClipboardList className="h-4 w-4" />
                    Login Logs
                  </Link>
                </Button>
                <Button variant="ghost" className="text-foreground hover:bg-muted gap-2" asChild>
                  <Link href="/settings">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </Button>
              </>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {isAuthenticated && sessionRemaining > 0 && (
              <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${isSessionLow ? "bg-red-500 text-white animate-pulse" : "bg-muted text-foreground"}`}>
                <Clock className="h-3 w-3" />
                <span className="font-mono">{formatTime(sessionRemaining)}</span>
              </div>
            )}
            {isAuthenticated && isAdmin && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative text-foreground hover:bg-muted">
                    <Bell className="h-4 w-4" />
                    {notifications.length > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                        {notifications.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="border-b px-4 py-3 font-semibold text-sm">Notifications</div>
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications</div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto">
                      {notifications.map((n, i) => (
                        <div key={i} className="border-b last:border-0 px-4 py-3 bg-orange-50">
                          <p className="text-sm text-orange-800">
                            <span className="font-medium">Warning: </span>
                            {n.creditType} credits expiring on {new Date(n.expiryDate).toLocaleDateString(appLocale())} ({n.daysLeft} day{n.daysLeft !== 1 ? "s" : ""} left). {n.remainingCredits} credit{n.remainingCredits !== 1 ? "s" : ""} remaining.
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="text-foreground hover:bg-muted gap-2">
                    <User className="h-4 w-4" />
                    <span className="hidden sm:inline">{user?.name || "User"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {lastLoginTime && (
                    <>
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Last login: {new Date(lastLoginTime).toLocaleString(appLocale(), {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
                    <Key className="mr-2 h-4 w-4" />
                    Change Password
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
          </div>
        </div>
      </header>

      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </>
  );
}
