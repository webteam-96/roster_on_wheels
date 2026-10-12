"use client";

/**
 * HelplineBar — thin support strip shown at the top of the authenticated dashboards.
 * Reads the single source of truth in MERCHANT (lib/merchantInfo) so the numbers /
 * email stay in sync with the public site's header strip.
 */

import { Phone, Clock, Mail } from "lucide-react";
import { MERCHANT } from "@/lib/merchantInfo";

export default function HelplineBar() {
  return (
    <div className="w-full text-white" style={{ backgroundColor: "#0f172a" }}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-1.5 text-[11px] font-medium sm:text-xs">
        <a href={`tel:${MERCHANT.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-amber-300 transition-colors">
          <Phone size={12} className="opacity-80" />
          <span className="opacity-90">ROW help line:</span>
          <span className="font-semibold tracking-wide">{MERCHANT.phone} / {MERCHANT.phoneSecondary}</span>
        </a>
        <span className="hidden sm:inline text-white/30">|</span>
        <span className="inline-flex items-center gap-1.5">
          <Clock size={12} className="opacity-80" />
          <span className="opacity-90">10:00 AM–6:30 PM (Mon–Fri)</span>
        </span>
        <span className="hidden sm:inline text-white/30">|</span>
        <a href={`mailto:${MERCHANT.email}`} className="inline-flex items-center gap-1.5 hover:text-amber-300 transition-colors">
          <Mail size={12} className="opacity-80" />
          <span className="font-semibold">{MERCHANT.email}</span>
        </a>
      </div>
    </div>
  );
}
