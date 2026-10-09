"use client";

/**
 * DistrictAdminTopbarStatus
 * --------------------------------------------------------------------------
 * Persistent header widget for the District Admin dashboard — WhatsApp / Email
 * credit balances, mirroring the club-admin ClubAdminTopbarStatus. Balances come
 * from the district credit wallet (getClubCreditBalance, which is district-scoped
 * here → emailRemaining / whatsAppRemaining).
 */

import { useEffect, useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { getDistrictCreditBalance } from "@/services/api";
import { fmtInt } from "@/components/dashboard/formatters";
import { useAuth } from "@/contexts/AuthContext";

const CHIP =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium whitespace-nowrap";

// Session cache so the chips repaint instantly (no flash) as you navigate.
const balCache = new Map<number, { email: number; whatsApp: number }>();

export default function DistrictAdminTopbarStatus({ districtId: districtIdProp }: { districtId?: number | null } = {}) {
  const { selectedDistrictId } = useAuth();
  const districtId = districtIdProp ?? selectedDistrictId;
  const [bal, setBal] = useState<{ email: number; whatsApp: number } | null>(
    () => (districtId ? balCache.get(districtId) ?? null : null),
  );

  useEffect(() => {
    if (!districtId) return;
    let alive = true;
    const cached = balCache.get(districtId);
    if (cached) setBal(cached);
    const load = () => {
      getDistrictCreditBalance(districtId)
        .then((b: any) => {
          const v = { email: b?.emailRemaining ?? 0, whatsApp: b?.whatsAppRemaining ?? 0 };
          balCache.set(districtId, v);
          if (alive) setBal(v);
        })
        .catch(() => { /* keep last-known / hidden */ });
    };
    load();
    // Refetch when the tab regains focus (e.g. after a reminder send deducts credits).
    window.addEventListener("focus", load);
    return () => { alive = false; window.removeEventListener("focus", load); };
  }, [districtId]);

  if (!bal) return null;

  return (
    <div className="hidden lg:flex items-center gap-2">
      <span className={`${CHIP} bg-green-50 border-green-200 text-green-700`} title="Available WhatsApp credits">
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp <span className="tabular-nums">{fmtInt(bal.whatsApp)}</span>
      </span>
      <span className={`${CHIP} bg-blue-50 border-blue-200 text-blue-700`} title="Available Email credits">
        <Mail className="h-3.5 w-3.5" />
        Email <span className="tabular-nums">{fmtInt(bal.email)}</span>
      </span>
    </div>
  );
}
