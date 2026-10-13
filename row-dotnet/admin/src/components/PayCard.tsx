"use client";

/**
 * Shared building blocks for the public (no-login) /pay/* pages.
 * Keeps the wallet top-up page and the club-website page visually identical:
 * same card shell, same reassurance rail, same support details.
 */

import { Mail, Phone, ShieldCheck, Zap } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { getActiveBrand, telHref } from "@/lib/brand";

/** Real support details — these mirror the help line in PayPageShell. */
/** First support phone of the instance brand ("" when none is configured). */
export function supportPhone(): string {
  return getActiveBrand().support.phones[0] ?? "";
}

/** Card with a navy icon chip, title and optional one-line subtitle. */
export function PayCard({
  icon: Icon, title, subtitle, children, className = "",
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title?: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      {title && (
        <div className="mb-4 flex items-start gap-3">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#17458F] text-white">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold leading-tight text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

/** The two reassurance rows that sit under a payment summary. */
export function PayTrustRows({ activationNote }: { activationNote: string }) {
  return (
    <div className="mt-5 space-y-3.5 border-t border-slate-200 pt-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <div className="text-[13px] font-semibold text-slate-800">100% secure payments</div>
          <p className="text-[12px] text-slate-500">Your payment is encrypted and handled by Razorpay.</p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[#F7A81B]" />
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Instant activation</div>
          <p className="text-[12px] text-slate-500">{activationNote}</p>
        </div>
      </div>
    </div>
  );
}

/** Support contact card for the right rail. */
export function PayHelpCard() {
  const { email, phones } = useBrand().support;
  const phone = phones[0] ?? "";
  return (
    <PayCard title="Need help?">
      <p className="text-[13px] text-slate-500">Contact our support team for any assistance.</p>
      <div className="mt-3.5 space-y-2.5">
        {email && <a href={`mailto:${email}`} className="flex items-center gap-3 text-[13px] text-slate-700 hover:text-[#17458F]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#17458F]">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 truncate">{email}</span>
        </a>}
        {phone && <a href={telHref(phone)} className="flex items-center gap-3 text-[13px] text-slate-700 hover:text-[#17458F]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#17458F]">
            <Phone className="h-3.5 w-3.5" />
          </span>
          <span>{phone}</span>
        </a>}
      </div>
    </PayCard>
  );
}

/** Benefit list used by the "Why …?" rail card. */
export function PayBenefits({ items }: { items: readonly { icon: React.ComponentType<{ className?: string }>; text: string }[] }) {
  return (
    <ul className="space-y-3.5">
      {items.map(({ icon: Bi, text }) => (
        <li key={text} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#17458F]">
            <Bi className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px] leading-snug text-slate-600">{text}</span>
        </li>
      ))}
    </ul>
  );
}
