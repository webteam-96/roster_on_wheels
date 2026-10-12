import Image from "next/image";
import Link from "next/link";
import { Calendar, MapPin, ArrowRight } from "lucide-react";

/**
 * Home "International Upcoming Event" — light-register feature card:
 * parallax photo left (glass date badge + event lockup live on the dark
 * photo half), serif mixed-case title and CTAs right.
 */
export function HighlightCards() {
  return (
    <section className="bg-paper pb-24 pt-6 lg:pb-32">
      <div className="container-rotary">
        <div data-animate="up" className="card overflow-hidden rounded-[24px] lg:grid lg:grid-cols-[1.1fr_1fr]">
          {/* Photo — parallax under the media grade */}
          <div className="media-grade relative min-h-[300px] lg:min-h-[480px]">
            <Image
              src="/images/event-colombo-hd.jpg"
              alt="Colombo skyline at night — Sri Lanka Rotary Institute 2026 host city"
              fill
              sizes="(max-width: 1024px) 100vw, 55vw"
              data-parallax="0.1"
              className="scale-[1.12] object-cover"
            />
            {/* Glass date badge */}
            <span className="glass-dark absolute left-5 top-5 inline-flex items-center gap-2 px-4 py-2 text-[12px] font-semibold text-cream">
              <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-gold" aria-hidden />
              18&ndash;20 December 2026
            </span>
            <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/srilanka-institute-2026.png"
                alt=""
                aria-hidden
                className="h-auto w-[150px]"
              />
              <p className="microlabel-on-photo">Colombo &middot; Sri Lanka</p>
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-12">
            <span data-animate="rule" className="rule-gold" />
            <p data-animate="up" className="eyebrow mt-4">
              International Upcoming Event
            </p>
            <h2
              data-animate="up"
              data-animate-delay="0.08"
              className="mt-5 font-display text-display-2 font-[450] leading-[1.08] tracking-[-0.02em] text-navy-950"
            >
              Sri Lanka Rotary Institute 2026
            </h2>

            <p
              data-animate="up"
              data-animate-delay="0.14"
              className="mt-6 flex items-start gap-2 text-[14px] leading-relaxed text-muted"
            >
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold-deep" aria-hidden />
              <span>
                City of Dreams &ndash; 88/1/5, Justice Akbar Mawatha, Colombo 00200, Sri Lanka
              </span>
            </p>

            <div
              data-animate="up"
              data-animate-delay="0.2"
              className="mt-9 flex flex-wrap items-center gap-3.5"
            >
              <Link
                href="https://club.example.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary group"
              >
                Register Now
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
              <Link href="/events" className="btn-ghost">
                View More Events
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
