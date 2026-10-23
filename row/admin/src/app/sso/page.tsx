"use client";

/**
 * Mobile → Web SSO landing. The mobile app opens /sso?token=… ; this page exchanges the one-time
 * token for a full web session (no password), logs the member in, and routes them to the right
 * dashboard (only-SuperAdmin → global search; 2+ roles → the role-list picker at /admin).
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ssoExchange, resolveDashboardLanding } from "@/services/api";
import RotaryLoader from "@/components/RotaryLoader";

function SsoInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false); // one-time tokens are single-use — never fire the exchange twice

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = params.get("token");
    if (!token) { setError("Missing sign-in token."); return; }

    (async () => {
      try {
        const response = await ssoExchange(token);
        login(
          response.token,
          {
            memberId: response.memberId,
            name: response.memberName,
            email: response.email,
            roles: response.roles,
            scopedRoles: response.scopedRoles,
            accessibleZones: response.accessibleZones,
            accessibleDistricts: response.accessibleDistricts,
            accessibleClubs: response.accessibleClubs,
          },
          response.lastLoginTime,
          response.sessionExpiryMinutes,
        );

        // Same routing as the login page: land DIRECTLY on the resolver's dashboard (SuperAdmin
        // that is ALSO an operational role lands on the operational dashboard; a member who is
        // ONLY SuperAdmin lands on Global Search). Switching happens via the sidebar switcher,
        // which reads the `available` list we prime below.
        let landingRoute = "/settings/global-search";
        try {
          const landing = await resolveDashboardLanding();
          if (landing?.route) landingRoute = landing.route;
          if (landing?.available && landing.available.length > 0) {
            localStorage.setItem("dashboard_available_v2", JSON.stringify(landing.available));
            localStorage.removeItem("dashboard_available");
          } else {
            localStorage.removeItem("dashboard_available_v2");
            localStorage.removeItem("dashboard_available");
          }
        } catch {
          if (response.roles.includes("SuperAdmin")) landingRoute = "/settings/global-search";
        }
        router.replace(landingRoute);
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setError(msg || "This sign-in link is invalid or has expired. Please try again from the app.");
      }
    })();
  }, [params, login, router]);

  if (error) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center gap-4 text-center px-6">
        <h2 className="text-xl font-semibold text-rose-700">Sign-in failed</h2>
        <p className="text-muted-foreground max-w-md">{error}</p>
        <Link href="/login" className="text-primary underline">Go to login</Link>
      </div>
    );
  }
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-4">
      <RotaryLoader size="lg" />
      <p className="text-muted-foreground">Signing you in…</p>
    </div>
  );
}

export default function SsoPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[80vh] items-center justify-center"><RotaryLoader size="lg" /></div>}>
      <SsoInner />
    </Suspense>
  );
}
