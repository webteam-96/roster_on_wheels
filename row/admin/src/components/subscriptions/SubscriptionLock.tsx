"use client";

/**
 * The locked screen (KIS/ROW/SUB/01 section 4.2 steps 2 and 5, exception 6). The API is what refuses a locked
 * feature; this keeps the page from loading into errors and says how to unlock it. Super Admins are never locked.
 */

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/row/AppKit";
import { useAuth } from "@/contexts/AuthContext";
import { getClubSubscription, getDistrictSubscription } from "@/services/api";

type Kind = "club" | "district";
export type LockLevel = "None" | "Reporting" | "Full";

/** Club dashboard areas open under the District subscription alone (section 3 rows 3 to 7). */
const REPORTING_PATHS = [
  "/club-admin-dashboard/dashboard", "/club-admin-dashboard/membership", "/club-admin-dashboard/service-projects-and-public-image",
  "/club-admin-dashboard/e-governance", "/club-admin-dashboard/goal-setting", "/club-admin-dashboard/targets",
  "/club-admin-dashboard/club-dues",
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** True when this page is locked at this level. The subscription page itself is always open. */
export function isLockedPath(kind: Kind, level: LockLevel, path: string): boolean {
  if (level === "Full" || under(path, `/${kind}-admin-dashboard/subscription`)) return false;
  if (kind === "district" || level === "None") return true;
  return path !== "/club-admin-dashboard" && !REPORTING_PATHS.some((p) => under(path, p));
}

/**
 * The access level of the open club or district: "Full" while it loads, when enforcement is off and for Super
 * Admins, so nothing flashes locked. A district is Full while its subscription works, None otherwise.
 */
export function useSubscriptionLevel(kind: Kind, ownerId: number | null): { level: LockLevel; loading: boolean } {
  const { isSuperAdmin } = useAuth();
  const [state, setState] = useState<{ level: LockLevel; loading: boolean }>({ level: "Full", loading: true });
  useEffect(() => {
    if (!ownerId || isSuperAdmin) { setState({ level: "Full", loading: false }); return; }
    let alive = true;
    (kind === "club"
      ? getClubSubscription(ownerId).then((s) => (s.enforced ? s.level : "Full"))
      : getDistrictSubscription(ownerId).then((s) => (!s.enforced || s.state === "Active" || s.state === "Grace" ? "Full" : "None")))
      .then((level) => { if (alive) setState({ level: level as LockLevel, loading: false }); })
      .catch(() => { if (alive) setState({ level: "Full", loading: false }); }); // the API still refuses locked calls
    return () => { alive = false; };
  }, [kind, ownerId, isSuperAdmin]);
  return state;
}

export default function SubscriptionLock({ kind, level, loading, children }: { kind: Kind; level: LockLevel; loading: boolean; children: ReactNode }) {
  const pathname = usePathname() || "";
  if (loading) return <SkeletonRows rows={6} />;
  if (!isLockedPath(kind, level, pathname)) return <>{children}</>;
  const clubFeature = kind === "club" && level === "Reporting";
  return (
    <section className="row-card row-rise mx-auto mt-10 max-w-[560px] px-8 py-10 text-center">
      <h2 className="row-h2">
        {clubFeature ? "Available with Club subscription" : "This area needs an active subscription"}
      </h2>
      <p className="mx-auto mt-3 max-w-[44ch] text-[15px] text-muted-foreground">
        {clubFeature
          ? "Your district's subscription covers club reporting. This feature opens when the club has its own subscription."
          : "Nothing has been deleted. Everything comes back as it was once the subscription is active."}
      </p>
      <Button asChild className="mt-6">
        <Link href={`/${kind}-admin-dashboard/subscription`}>{kind === "club" ? "See Club subscription" : "See District subscription"}</Link>
      </Button>
    </section>
  );
}
