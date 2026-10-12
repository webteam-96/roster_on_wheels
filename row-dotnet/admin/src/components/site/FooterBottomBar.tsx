import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** Minimal darkest bottom strip: ownership line + policy links + support contacts (all from the brand). */
export function FooterBottomBar() {
  const owner = BRAND.legalName || BRAND.productName;
  return (
    <div className="relative border-t border-cream/[0.08] bg-midnight">
      <div className="container-rotary flex flex-col items-center justify-between gap-5 py-6 text-center lg:flex-row lg:text-left">
        <div>
          <p className="text-xs leading-relaxed text-cream/45">
            © {new Date().getFullYear()} {owner}. {BRAND.shortName} — {BRAND.productName}.
          </p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-cream/50 lg:justify-start">
            <Link href="/privacy-policy" className="transition-colors hover:text-cream">
              Privacy Policy
            </Link>
            <span className="text-cream/20" aria-hidden>
              •
            </span>
            <Link href="/terms-and-conditions" className="transition-colors hover:text-cream">
              Terms and Conditions
            </Link>
          </p>
        </div>

        {(BRAND.supportEmail || BRAND.supportPhone) && (
          <p className="text-xs text-cream/60">
            {BRAND.supportPhone && <a href={`tel:${BRAND.supportPhone.replace(/\s/g, "")}`} className="hover:text-cream">{BRAND.supportPhone}</a>}
            {BRAND.supportPhone && BRAND.supportEmail && <span className="mx-2 text-cream/20">•</span>}
            {BRAND.supportEmail && <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-cream">{BRAND.supportEmail}</a>}
          </p>
        )}
      </div>
    </div>
  );
}
