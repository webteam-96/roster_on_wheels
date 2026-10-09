import type { Metadata } from "next";
import { MapPin, ArrowUpRight } from "lucide-react";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ContactChannels } from "@/components/pages/contact/ContactChannels";
import { SupportFeatures } from "@/components/pages/contact/SupportFeatures";

export const metadata: Metadata = {
  title: "Contact Us | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "We are here to help you. Reach out to us for any queries or support.",
};

// Honest maps link — a real Google Maps search, never a fake embed.
const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent("Rotary International Zones 4 5 6 7 8 India");

export default function ContactUsPage() {
  return (
    <>
      <PageBanner
        eyebrow="Get in Touch"
        subtitle="One call or email away, every working day — for membership, events and anything in between."
      >
        Contact <span className="text-gold">Us</span>
      </PageBanner>

      <section className="bg-paper py-20 lg:py-28">
        <div className="container-rotary">
          <div className="grid gap-12 lg:grid-cols-[3fr_2fr] lg:gap-16">
            {/* Channels ledger */}
            <div>
              <div data-animate="rule" className="rule-gold" />
              <h2
                data-animate="up"
                data-animate-duration="0.7"
                className="mt-3.5 font-display text-heading font-[450] tracking-tight text-navy-950"
              >
                Reach the team directly
              </h2>
              <div className="mt-8">
                <ContactChannels />
              </div>
            </div>

            {/* Quiet address card — no street address is published, so this
                stays an honest pointer to Google Maps, never a fake embed. */}
            <div
              data-animate="up"
              data-animate-duration="0.7"
              data-animate-delay="0.1"
              className="h-fit rounded-2xl bg-porcelain p-7 ring-1 ring-navy-950/[0.06] lg:mt-12"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold/15 ring-1 ring-gold/30">
                <MapPin className="h-5 w-5 text-gold-deep" strokeWidth={1.75} aria-hidden />
              </span>
              <h3 className="mt-5 font-display text-lg font-[450] tracking-tight text-navy-950">
                Rotary International
                <br />
                Zones 4, 5, 6, 7 &amp; 8
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                Serving clubs and districts across Zones 4, 5, 6, 7 &amp; 8.
              </p>
              <a
                href={MAPS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost group mt-6"
              >
                Open in Google Maps
                <ArrowUpRight
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden
                />
              </a>
            </div>
          </div>

          <div className="mt-16 lg:mt-20">
            <SupportFeatures />
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
