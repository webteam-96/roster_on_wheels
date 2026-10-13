"use client";

/**
 * Public footer with policy links — REQUIRED on every page Cashfree's
 * whitelisting reviewer might see. Per the Cashfree whitelisting modal:
 *   - Contact Us
 *   - Terms & Conditions
 *   - Refunds & Cancellations
 *
 * Privacy Policy is included as industry standard (IT Rules 2021 + DPDPA 2023).
 *
 * Identity comes from the instance brand (lib/brand.ts via useBrand), the same
 * source the policy pages (Server Components) read with getServerBrand.
 */

import Link from "next/link";
import { Mail, Phone, MapPin, ShieldCheck, Lock } from "lucide-react";
import { merchantFrom } from "@/lib/merchantInfo";
import { telHref } from "@/lib/brand";
import { useBrand } from "@/contexts/BrandContext";
import BrandLogo from "@/components/BrandLogo";

const BRAND_NAVY = "#1e3a5f";
const BRAND_GOLD = "#F7A81B";

const POLICY_LINKS = [
  { label: "Contact Us", href: "/contact-us" },
  { label: "Terms & Conditions", href: "/terms-and-conditions" },
  { label: "Refunds & Cancellations", href: "/refunds-and-cancellations" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Cookies", href: "/cookies" },
];

const QUICK_LINKS = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/about-us" },
  { label: "Services", href: "/#services" },
  { label: "Pricing", href: "/#pricing" },
  // Sign In intentionally omitted during the Cashfree review window —
  // admin users sign in via /login manually for testing.
];

export default function PublicFooter() {
  const year = 2026; // updated on next build; avoids hydration mismatch from new Date()
  const brand = useBrand();
  const MERCHANT = merchantFrom(brand);
  const usesCashfree = brand.paymentGateways.includes("cashfree");

  return (
    <footer className="border-t mt-16" style={{ background: BRAND_NAVY, borderColor: "rgba(247,168,27,0.25)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand column */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <BrandLogo className="h-10 w-auto" textClassName="text-white" />
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Integrated administration platform serving the Rotary clubs of{" "}
              {brand.productName}. Built for member management,
              project tracking, event registration, and secure online payments.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: "rgba(56,161,105,0.18)", border: "1px solid rgba(56,161,105,0.4)" }}>
                <Lock size={11} /> SSL Secured
              </span>
              {usesCashfree && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: "rgba(247,168,27,0.15)", border: "1px solid rgba(247,168,27,0.4)" }}>
                  <ShieldCheck size={11} /> Cashfree Secured
                </span>
              )}
            </div>
          </div>

          {/* Quick links */}
          <nav aria-label="Quick links">
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: BRAND_GOLD }}>
              Quick Links
            </h3>
            <ul className="space-y-2.5">
              {QUICK_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-slate-300 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Policies (Cashfree compliance) */}
          <nav aria-label="Policies">
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: BRAND_GOLD }}>
              Policies
            </h3>
            <ul className="space-y-2.5">
              {POLICY_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-slate-300 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: BRAND_GOLD }}>
              Contact
            </h3>
            <ul className="space-y-3 text-sm text-slate-300">
              <li className="flex items-start gap-2">
                <Mail size={15} className="mt-0.5 flex-shrink-0" style={{ color: BRAND_GOLD }} />
                <a href={`mailto:${MERCHANT.email}`} className="hover:text-white break-all">{MERCHANT.email}</a>
              </li>
              <li className="flex items-start gap-2">
                <Phone size={15} className="mt-0.5 flex-shrink-0" style={{ color: BRAND_GOLD }} />
                <span>
                  {MERCHANT.phones.map((phone) => (
                    <a key={phone} href={telHref(phone)} className="hover:text-white block">{phone}</a>
                  ))}
                  <span className="text-[11px] text-slate-400 block mt-0.5">{MERCHANT.workingHours}</span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin size={15} className="mt-0.5 flex-shrink-0" style={{ color: BRAND_GOLD }} />
                <span>
                  {MERCHANT.addressLines.map((line, i) => (
                    <span key={line}>
                      {i > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-12 pt-6 border-t flex flex-col md:flex-row items-start md:items-center justify-between gap-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <p className="text-xs text-slate-400">
            © {year} {MERCHANT.legalName}. All rights reserved.
          </p>
          {usesCashfree && (
            <p className="text-[11px] text-slate-500">
              Payments powered by Cashfree Payments India Pvt. Ltd. · INR (₹) only
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
