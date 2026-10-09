"use client";

/**
 * HelplineBar — thin support strip shown at the top of the authenticated dashboards.
 * Reads the instance brand (useBrand) so the numbers / email stay in sync with
 * the public site's header strip.
 */

import { Phone, Clock, Mail } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { telHref } from "@/lib/brand";

export default function HelplineBar() {
  const brand = useBrand();
  const { phones, hours, email } = brand.support;
  if (!phones.length && !hours && !email) return null;
  return (
    <div className="w-full text-white" style={{ backgroundColor: "#0f172a" }}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-1.5 text-[11px] font-medium sm:text-xs">
        {[
          phones.length > 0 && (
            <a key="phone" href={telHref(phones[0])} className="inline-flex items-center gap-1.5 hover:text-amber-300 transition-colors">
              <Phone size={12} className="opacity-80" />
              <span className="opacity-90">{brand.shortName} help line:</span>
              <span className="font-semibold tracking-wide">{phones.join(" / ")}</span>
            </a>
          ),
          hours && (
            <span key="hours" className="inline-flex items-center gap-1.5">
              <Clock size={12} className="opacity-80" />
              <span className="opacity-90">{hours}</span>
            </span>
          ),
          email && (
            <a key="email" href={`mailto:${email}`} className="inline-flex items-center gap-1.5 hover:text-amber-300 transition-colors">
              <Mail size={12} className="opacity-80" />
              <span className="font-semibold">{email}</span>
            </a>
          ),
        ]
          .filter(Boolean)
          .flatMap((part, i) => (i === 0 ? [part] : [<span key={`sep${i}`} className="hidden sm:inline text-white/30">|</span>, part]))}
      </div>
    </div>
  );
}
