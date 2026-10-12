import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { SpotlightCard } from "@/components/motion/SpotlightCard";
import { eventSlug, type EventItem } from "./data";

/**
 * Refined past-event card: graded photo, .figure date, serif mixed-case
 * title, venue. The whole card is one link — finished at rest, no hover
 * required. Enters via LEDGER SWEEP (data-animate="left" inside a stagger
 * group, 0.35s utility pacing).
 */
export function EventCard({ event }: { event: EventItem }) {
  const href = `/past-events/${eventSlug(event)}`;
  return (
    <article
      data-animate="left"
      data-animate-duration="0.35"
      className="card card-hover group h-full overflow-hidden rounded-2xl"
    >
      <Link
        href={href}
        className="flex h-full flex-col rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
      >
        <div className="media-grade aspect-[16/9] w-full flex-shrink-0">
          <Image
            src={event.image}
            alt={event.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col p-5">
          <p className="figure text-[12px] text-muted">{event.date}</p>
          <h3 className="mt-2 font-display text-lg font-[450] leading-snug tracking-[-0.01em] text-navy-950">
            {event.title}
          </h3>
          <p className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug text-muted">
            <MapPin className="mt-px h-4 w-4 flex-shrink-0 text-gold-deep" />
            <span>{event.venue}</span>
          </p>
          <p className="mt-auto flex items-center gap-2 pt-5 text-[13px] font-semibold text-gold-deep">
            View highlights
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </p>
        </div>
      </Link>
    </article>
  );
}

/**
 * Flagship feature card — spans the full 12 columns with a 16:7 graded
 * photo. TILT garnish (featured cards only) + auto-sheen on touch.
 */
export function FlagshipCard({ event }: { event: EventItem }) {
  const href = `/past-events/${eventSlug(event)}`;
  return (
    <SpotlightCard
      as="article"
      tilt
      color="251, 180, 32"
      data-animate="up"
      data-animate-duration="0.7"
      className="card overflow-hidden rounded-3xl"
    >
      <Link
        href={href}
        className="group flex h-full flex-col rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
      >
        <div className="media-grade aspect-[16/9] w-full sm:aspect-[16/7]">
          <Image
            src={event.image}
            alt={event.title}
            fill
            priority
            sizes="(max-width: 1200px) 100vw, 1200px"
            className="object-cover"
          />
        </div>
        <div className="flex flex-col justify-between gap-6 p-6 sm:flex-row sm:items-end lg:p-8">
          <div>
            <p className="eyebrow">Flagship — Rotary Institute</p>
            <h2 className="mt-3 max-w-2xl font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
              {event.title}
            </h2>
            <p className="mt-3 flex items-start gap-1.5 text-[14px] leading-snug text-muted">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold-deep" />
              <span>{event.venue}</span>
            </p>
          </div>
          <div className="flex flex-none flex-col items-start gap-2 sm:items-end">
            <p className="figure text-[15px] text-navy-950">{event.date}</p>
            <p className="flex items-center gap-2 text-[13px] font-semibold text-gold-deep">
              View highlights
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </p>
          </div>
        </div>
      </Link>
    </SpotlightCard>
  );
}
