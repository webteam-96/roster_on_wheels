import Image from "next/image";
import Link from "next/link";
import { MapPin, ArrowRight } from "@/components/icons";
import type { UpcomingEvent } from "./data";

/**
 * Upcoming-event card: graded photo with a glass date badge, serif title,
 * venue and an optional Register CTA. Mirrors the archive EventCard styling
 * but points outward to registration rather than an archive detail page.
 */
export function UpcomingEventCard({ event }: { event: UpcomingEvent }) {
  return (
    <article
      data-animate="left"
      data-animate-duration="0.35"
      className="card group flex h-full flex-col overflow-hidden rounded-2xl"
    >
      <div className="media-grade relative aspect-[16/9] w-full flex-shrink-0">
        <Image
          src={event.image}
          alt={event.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover"
        />
        <span className="glass-dark absolute left-4 top-4 inline-flex flex-col items-center px-3 py-2 text-cream">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gold">
            {event.badge.month}
          </span>
          <span className="figure text-lg leading-none">{event.badge.day}</span>
        </span>
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
        {event.description && (
          <p className="mt-3 text-[13px] leading-relaxed text-muted">{event.description}</p>
        )}
        {event.registerUrl && (
          <Link
            href={event.registerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary group mt-auto self-start"
          >
            Register
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        )}
      </div>
    </article>
  );
}
