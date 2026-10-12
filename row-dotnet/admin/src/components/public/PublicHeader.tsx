"use client";

/**
 * Public-facing top navigation. Used by the marketing landing page and every
 * policy page (Contact Us, Terms, Refunds, Privacy Policy, About Us).
 *
 * IMPORTANT: no Sign In / Dashboard CTA is rendered here during the Cashfree
 * domain-whitelisting review window. Admin users sign in by typing /login
 * manually. The header is a pure public marketing nav.
 */

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, Phone, Mail, Clock } from "lucide-react";
import { MERCHANT } from "@/lib/merchantInfo";

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about-us" },
  { label: "Services", href: "/#services" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Contact", href: "/contact-us" },
];

const BRAND_NAVY = "#1e3a5f";
const BRAND_GOLD = "#F7A81B";

export default function PublicHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white border-b shadow-sm" style={{ borderColor: "rgba(30,58,95,0.08)" }}>
      {/* Top contact strip — always visible. Industry standard on Indian
          payment-enabled sites; Cashfree reviewers expect it on the home
          page. Carries help-line numbers, working hours, and support email
          per the merchant's published policy. */}
      <div className="border-b" style={{ background: BRAND_NAVY, borderColor: "rgba(247,168,27,0.25)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 text-[11px] sm:text-xs text-slate-200">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Phone size={12} style={{ color: BRAND_GOLD }} />
              <span className="font-medium">Help line:</span>
              <a href={`tel:${MERCHANT.phone.replace(/[^+\d]/g, "")}`} className="hover:text-white">{MERCHANT.phone}</a>
              <span className="text-slate-400">/</span>
              <a href={`tel:${MERCHANT.phoneSecondary.replace(/[^+\d]/g, "")}`} className="hover:text-white">{MERCHANT.phoneSecondary}</a>
            </span>
            <span className="hidden sm:flex items-center gap-1.5">
              <Clock size={12} style={{ color: BRAND_GOLD }} />
              <span>10:00 AM – 6:30 PM (Mon–Fri)</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <Mail size={12} style={{ color: BRAND_GOLD }} />
            <a href={`mailto:${MERCHANT.email}`} className="hover:text-white">{MERCHANT.email}</a>
          </span>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 flex-shrink-0">
            <Image
              src="/images/rotary-masterbrand.png"
              alt="ROW"
              width={130}
              height={40}
              className="h-9 w-auto object-contain"
              priority
            />
            <span className="hidden lg:inline text-xs font-semibold tracking-wide" style={{ color: BRAND_NAVY }}>
              ROW · 5 · 6 · 7 · 8
            </span>
          </Link>

          {/* Desktop nav */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* (Sign In CTA intentionally omitted during Cashfree review window.) */}

          {/* Mobile menu trigger */}
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden p-2 rounded-md text-slate-700 hover:bg-slate-100"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t py-3 space-y-1" style={{ borderColor: "rgba(30,58,95,0.08)" }}>
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2 text-sm font-medium text-slate-700 rounded-md hover:bg-slate-50"
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
