"use client";

/**
 * Global top-right notification card for club-website provisioning.
 * --------------------------------------------------------------------------
 * Mounted in the club-admin dashboard layout, so it persists across tab
 * navigation. After a purchase, provisioning runs server-side (background
 * worker) — this card polls its status and updates from "Setting up…" to
 * "Your website is live!" even if the user left the purchase page. A reload
 * re-attaches to any in-progress order via the latest-order endpoint.
 *
 * The purchase page fires window event "rc-website-provisioning-started" so
 * the card appears immediately after payment.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getLatestWebsiteOrder, getWebsiteOrderStatus } from "@/services/api";

const DISMISSED_KEY = "rc_website_dismissed";

function dismissedSet(): Set<number> {
  try { return new Set<number>(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); }
  catch { return new Set(); }
}
function rememberDismissed(orderId: number) {
  const s = dismissedSet(); s.add(orderId);
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

type Order = {
  websiteOrderId: number;
  subdomain: string;
  status: "AwaitingPayment" | "Provisioning" | "Active" | "ActivationFailed" | string;
  visitUrl?: string | null;
};

export default function WebsiteProvisioningToast() {
  const { selectedClubId } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((orderId: number) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const s = await getWebsiteOrderStatus(orderId);
        if (!s) return;
        setOrder(s);
        if (s.status === "Active" || s.status === "ActivationFailed") stopPolling();
      } catch { /* transient — keep polling */ }
    }, 4000);
  }, [stopPolling]);

  // Discover an order to watch. allowTerminal=true when we KNOW the user just paid,
  // so an instantly-finished provision still surfaces. On plain mount/reload we only
  // surface in-progress work (never resurrect old completed orders).
  const check = useCallback(async (allowTerminal: boolean) => {
    if (!selectedClubId) return;
    try {
      const s = await getLatestWebsiteOrder(selectedClubId);
      if (!s) return;
      if (dismissedSet().has(s.websiteOrderId)) return;
      if (s.status === "Provisioning") { setOrder(s); startPolling(s.websiteOrderId); }
      else if (allowTerminal && (s.status === "Active" || s.status === "ActivationFailed")) { setOrder(s); }
    } catch { /* ignore */ }
  }, [selectedClubId, startPolling]);

  useEffect(() => {
    check(false);
    const onStarted = () => check(true);
    window.addEventListener("rc-website-provisioning-started", onStarted);
    return () => { window.removeEventListener("rc-website-provisioning-started", onStarted); stopPolling(); };
  }, [check, stopPolling]);

  if (!order || order.status === "AwaitingPayment") return null;

  const provisioning = order.status === "Provisioning";
  const active = order.status === "Active";
  const failed = order.status === "ActivationFailed";
  const host = `${order.subdomain}.rotaryindia.org`;

  const dismiss = () => { rememberDismissed(order.websiteOrderId); stopPolling(); setOrder(null); };

  return (
    <div className="fixed top-4 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-white shadow-lg p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${active ? "bg-emerald-50 text-emerald-600" : failed ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-[#003DA5]"}`}>
          {provisioning ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#003DA5] border-t-transparent" />
          ) : active ? "✓" : "⏳"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800">
            {provisioning ? "Setting up your website…" : active ? "Your website is live!" : "Almost there…"}
          </div>
          <div className="mt-0.5 break-all text-xs text-slate-500">{host}</div>
          {provisioning && (
            <p className="mt-1.5 text-xs text-slate-500">You can safely leave this page — we&apos;ll email you when it&apos;s ready.</p>
          )}
          {active && order.visitUrl && (
            <a href={order.visitUrl} target="_blank" rel="noreferrer"
              className="mt-1.5 inline-block text-xs font-semibold text-[#003DA5] hover:underline">Open website →</a>
          )}
          {failed && (
            <p className="mt-1.5 text-xs text-slate-500">Setup is taking a little longer than usual. We&apos;ll email you as soon as it&apos;s live.</p>
          )}
        </div>
        {!provisioning && (
          <button onClick={dismiss} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        )}
      </div>
    </div>
  );
}
