import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ButtonGroup } from "@/components/pages/past-events/parts";
import { MahabsAccordion } from "@/components/pages/past-events/MahabsCard";
import { EventCard } from "@/components/pages/past-events/EventCard";
import { EVENTS, eventSlug, getEventBySlug } from "@/components/pages/past-events/data";

export function generateStaticParams() {
  return EVENTS.map((e) => ({ slug: eventSlug(e) }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const event = getEventBySlug(params.slug);
  if (!event) return { title: "Event | ROW" };
  return {
    title: `${event.title} | ROW`,
    description: `Highlights, recordings and photos from ${event.title} — ${event.date}, ${event.venue}.`,
  };
}

export default function EventDetailPage({ params }: { params: { slug: string } }) {
  const event = getEventBySlug(params.slug);
  if (!event) notFound();

  const isMahabs = Array.isArray(event.days);
  const idx = EVENTS.findIndex((e) => eventSlug(e) === params.slug);
  // "More from the archive" — the next three events, wrapping around.
  const others = [1, 2, 3].map((o) => EVENTS[(idx + o) % EVENTS.length]);

  return (
    <>
      {/* Image-led header — graded 16:6 photo with a glass title panel */}
      <section className="relative">
        <div className="container-wide pt-6 lg:pt-8">
          <Link
            href="/past-events"
            className="group inline-flex min-h-11 items-center gap-2 rounded-full text-sm font-semibold text-muted transition-colors hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
            Back to past events
          </Link>
          <div
            data-animate="mask"
            data-animate-duration="1.1"
            className="media-grade mt-5 aspect-[16/9] w-full rounded-2xl sm:aspect-[16/7] lg:aspect-[16/6]"
          >
            <Image
              src={event.image}
              alt={event.title}
              fill
              priority
              sizes="(max-width: 1480px) 100vw, 1480px"
              className="object-cover"
            />
          </div>
        </div>
        <div className="container-rotary">
          <div
            data-animate="up"
            data-animate-duration="1.1"
            data-animate-delay="0.15"
            className="glass-dark relative z-10 -mt-12 p-6 sm:-mt-16 sm:p-8 lg:-mt-24 lg:p-10"
          >
            <div data-animate="rule" className="rule-gold" />
            <p className="microlabel-on-dark mt-3.5">Past Zonal Event</p>
            <h1
              data-split
              className="mt-4 max-w-4xl font-display text-display-2 font-[450] tracking-[-0.02em] text-cream"
            >
              {event.title}
            </h1>
            <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-2 text-[14px] text-cream/70">
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 flex-shrink-0 text-gold" />
                <span className="figure">{event.date}</span>
              </span>
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 flex-shrink-0 text-gold" />
                {event.venue}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Watch & relive — media affordances as ledger rows */}
      <section className="bg-paper py-14 lg:py-20">
        <div className="container-rotary">
          <div className="max-w-3xl">
            <div data-animate="rule" className="rule-gold" />
            <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
              Watch &amp; Relive
            </p>
            <h2
              data-animate="up"
              data-animate-duration="0.7"
              className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
            >
              Recordings &amp; <em className="accent-serif text-accent-gold">galleries</em>
            </h2>
            <p
              data-animate="up"
              data-animate-duration="0.7"
              className="mt-3 text-[15px] leading-relaxed text-muted"
            >
              {isMahabs
                ? "Session recordings from all three days, plus the TRF seminar and dinner — hosted on the event's YouTube channel."
                : "Every recording and photo gallery from this event, on its original platform."}
            </p>
            <div className="mt-8">
              {isMahabs ? (
                <MahabsAccordion days={event.days!} trf={event.trf!} />
              ) : (
                <ButtonGroup buttons={event.buttons ?? []} />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Other events rail — reuses the archive card */}
      <section className="bg-paper pb-20 lg:pb-24">
        <div className="container-rotary">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div data-animate="rule" className="rule-gold" />
              <h2
                data-animate="up"
                data-animate-duration="0.7"
                className="mt-3.5 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
              >
                More from the archive
              </h2>
            </div>
            <Link
              href="/past-events"
              data-animate="up"
              data-animate-duration="0.7"
              className="group inline-flex min-h-11 items-center gap-2 rounded-full text-sm font-semibold text-gold-deep transition-colors hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2"
            >
              All events
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
          <div data-animate-stagger="left" className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((e) => (
              <EventCard key={e.title} event={e} />
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
