"use client";

import Link from "next/link";
import { useBrand } from "@/contexts/BrandContext";
import { telHref } from "@/lib/brand";

/** Minimal darkest bottom strip: ownership line, policy links and support contacts, all from the instance brand. */
export function FooterBottomBar() {
  const brand = useBrand();
  const { legalName, email, phones } = brand.support;
  const phone = phones[0] ?? "";
  return (
    <div className="relative border-t border-cream/[0.08] bg-midnight">
      <div className="container-rotary flex flex-col items-center justify-between gap-5 py-6 text-center lg:flex-row lg:text-left">
        <div>
          <p className="text-xs leading-relaxed text-cream/45">
            © {new Date().getFullYear()} {legalName || brand.productName}. {brand.shortName} — {brand.productName}.
          </p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-cream/50 lg:justify-start">
            <Link href={brand.legal.privacyUrl} className="transition-colors hover:text-cream">
              Privacy Policy
            </Link>
            <span className="text-cream/20" aria-hidden>
              •
            </span>
            <Link href={brand.legal.termsUrl} className="transition-colors hover:text-cream">
              Terms and Conditions
            </Link>
            {brand.legal.cookiesUrl && (
              <>
                <span className="text-cream/20" aria-hidden>
                  •
                </span>
                <Link href={brand.legal.cookiesUrl} className="transition-colors hover:text-cream">
                  Cookies
                </Link>
              </>
            )}
          </p>
        </div>

        {(email || phone) && (
          <p className="text-xs text-cream/60">
            {phone && <a href={telHref(phone)} className="hover:text-cream">{phone}</a>}
            {phone && email && <span className="mx-2 text-cream/20">•</span>}
            {email && <a href={`mailto:${email}`} className="hover:text-cream">{email}</a>}
          </p>
        )}
      </div>
    </div>
  );
}
