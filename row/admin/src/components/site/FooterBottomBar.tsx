import Link from "next/link";
import Image from "next/image";
import { MessageCircle } from "lucide-react";

/** Minimal darkest bottom strip: ownership text + Kaizen / Official Licensee / WhatsApp. */
export function FooterBottomBar() {
  return (
    <div className="relative border-t border-cream/[0.08] bg-midnight">
      <div className="container-rotary flex flex-col items-center justify-between gap-5 py-6 text-center lg:flex-row lg:text-left">
        <div>
          <p className="text-xs leading-relaxed text-cream/45">
            <Link
              href="https://rizones45678.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-gold/90 underline-offset-2 hover:underline"
            >
              Rizones 4, 5, 6, 7 &amp; 8
            </Link>{" "}
            Website is owned by ROTARY NEWS TRUST (
            <Link
              href="https://www.rotarynewsonline.org"
              className="text-gold/80 underline-offset-2 hover:underline"
            >
              www.rotarynewsonline.org
            </Link>
            ). Developed and maintained by Kaizen Infotech Solutions Pvt. Ltd.
          </p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-cream/50 lg:justify-start">
            <a
              href="/pdf/privacy-policy.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-cream"
            >
              Privacy Policy (PDF)
            </a>
            <span className="text-cream/20" aria-hidden>
              •
            </span>
            <a
              href="/pdf/refund-policy.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-cream"
            >
              Refund Policy (PDF)
            </a>
            <span className="text-cream/20" aria-hidden>
              •
            </span>
            <a
              href="/pdf/terms-of-service.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-cream"
            >
              Terms of Service (PDF)
            </a>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5">
          <Link
            href="https://www.kaizeninfotech.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Image
              src="/images/kaizen-white.png"
              alt="Kaizen Infotech Solutions Pvt. Ltd."
              width={602}
              height={367}
              className="h-10 w-auto opacity-75 transition-opacity duration-300 hover:opacity-100"
            />
          </Link>
          <Link
            href="https://rosteronwheels.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Image
              src="/images/rotary-licensee-white.png"
              alt="Rotary Official Licensee"
              width={120}
              height={79}
              className="h-11 w-auto opacity-75 transition-opacity duration-300 hover:opacity-100"
            />
          </Link>
          <Link
            href="https://wa.me/919320039555"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-cream/80 ring-1 ring-cream/15 transition-all duration-300 hover:bg-[#25D366] hover:text-white hover:ring-[#25D366] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp Us
          </Link>
        </div>
      </div>
    </div>
  );
}
