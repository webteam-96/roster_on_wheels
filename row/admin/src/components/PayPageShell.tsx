"use client";

/**
 * Branded wrapper for the PUBLIC (no-login) payment pages (/pay/*). AppHeader hides itself on
 * /pay/ routes, so these pages carry their own ROW header + footer.
 *
 * Design: "Trust & Authority" — full-width Rotary blue (#17458F) navbar with a gold (#F7A81B)
 * accent, the page title in the bar (logo left · title center · secure-payment right), a soft
 * branded background, a trust strip, and a full-width footer with policy links.
 */

import type { ReactNode } from "react";
import { Lock, ShieldCheck, BadgeCheck } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";

const NAVY = "#17458F";
const NAVY_DARK = "#0F3168";
const GOLD = "#F7A81B";

export default function PayPageShell({ title, wide, children }: { title?: ReactNode; wide?: boolean; children: ReactNode }) {
  const { phones, hours, email } = useBrand().support;
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Helpline bar (full width) */}
      <div className="w-full text-white/90 text-[11px] sm:text-xs py-1.5 px-4 text-center" style={{ backgroundColor: NAVY_DARK }}>
        {phones.length > 0 && <>Help line: {phones.join(" / ")}</>}
        <span className="hidden sm:inline">{hours && <> &nbsp;·&nbsp; {hours}</>}{email && <> &nbsp;·&nbsp; {email}</>}</span>
      </div>

      {/* Branded navbar (full width) — logo left · title center · secure payment right */}
      <header className="w-full text-white shadow-sm" style={{ background: `linear-gradient(90deg, ${NAVY} 0%, ${NAVY_DARK} 100%)` }}>
        <div className="flex h-16 sm:h-20 items-center gap-3 sm:gap-4 px-4 sm:px-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/rotary-white-live.png" alt="ROW" className="h-10 sm:h-14 object-contain shrink-0" />
          <div className="flex-1 min-w-0 text-center">
            {title && <span className="font-semibold text-sm sm:text-lg truncate block">{title}</span>}
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/20 shrink-0">
            <Lock className="h-3.5 w-3.5" style={{ color: GOLD }} />
            <span className="hidden sm:inline">Secure payment</span>
          </div>
        </div>
      </header>
      {/* Gold accent rule */}
      <div className="w-full h-1" style={{ backgroundColor: GOLD }} />

      {/* Content — soft branded gradient so the page never feels empty */}
      <main className="flex-1 w-full bg-gradient-to-b from-blue-50/70 via-slate-50 to-slate-50">
        <div className={`${wide ? "max-w-6xl" : "max-w-xl"} mx-auto px-4 pt-8 sm:pt-10 pb-12`}>{children}</div>
      </main>

      {/* Trust strip */}
      <div className="w-full border-t border-slate-200 bg-white">
        <div className="px-4 sm:px-8 py-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /> 256-bit SSL encrypted</span>
          <span className="inline-flex items-center gap-1.5"><Lock className="h-4 w-4 text-slate-500" /> Secured by Razorpay</span>
          <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4" style={{ color: NAVY }} /> Official Rotary Zones portal</span>
        </div>
      </div>

      {/* Footer (full width) */}
      <footer className="w-full text-white/75 text-xs" style={{ backgroundColor: NAVY_DARK }}>
        <div className="px-4 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="font-semibold text-white text-sm">ROW</div>
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {[
              ["About", "/about-us"], ["Contact", "/contact-us"], ["Terms", "/terms-and-conditions"],
              ["Privacy", "/privacy-policy"], ["Refunds", "/refunds-and-cancellations"],
            ].map(([label, href]) => (
              <a key={href} href={href} className="text-white/80 hover:text-white transition-colors">{label}</a>
            ))}
          </nav>
        </div>
        <div className="border-t border-white/10 px-4 sm:px-8 py-3 text-center text-white/60">
          © {new Date().getFullYear()} ROW. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
