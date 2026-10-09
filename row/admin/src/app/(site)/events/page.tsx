import type { Metadata } from "next";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { UpcomingEventCard } from "@/components/pages/events/UpcomingEventCard";
import { UPCOMING_EVENTS } from "@/components/pages/events/data";

export const metadata: Metadata = {
  title: "Upcoming Events | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Institutes, summits and conclaves coming up across Rotary Zones 4, 5, 6, 7 & 8 — dates, venues and how to register.",
};

export default function EventsPage() {
  return (
    <>
      <PageBanner
        eyebrow="What's next"
        subtitle="Institutes, summits and conclaves coming up across the zones — save the dates and register."
      >
        Upcoming <span className="text-gold">Events</span>
      </PageBanner>

      <section className="bg-paper py-16 lg:py-20">
        <div className="container-rotary">
          {UPCOMING_EVENTS.length > 0 ? (
            <div
              data-animate-stagger="left"
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {UPCOMING_EVENTS.map((e) => (
                <UpcomingEventCard key={e.title} event={e} />
              ))}
            </div>
          ) : (
            <div className="mx-auto max-w-xl rounded-2xl bg-porcelain px-6 py-14 text-center">
              <p className="font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
                No events scheduled yet
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Check back soon — new institutes and summits are added here as they&apos;re announced.
              </p>
            </div>
          )}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
