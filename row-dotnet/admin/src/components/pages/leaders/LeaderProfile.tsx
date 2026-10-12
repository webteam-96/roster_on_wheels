import Image from "next/image";
import { FileDown, MapPin, Play } from "lucide-react";
import type { LeaderProfileData } from "./data";

/**
 * Long-read chapter for one leader: sticky identity column (graded portrait,
 * serif name, verbatim roles, quiet document links) beside the full biography
 * at a 68ch reading measure with a Fraunces lede. The section id feeds the
 * page's ChapterRail scroll-spy.
 */
export function LeaderProfile({ leader, id }: { leader: LeaderProfileData; id: string }) {
  const { name, nick, roles, zone, photo, biodata, video, bio } = leader;

  return (
    <section
      id={id}
      aria-label={name}
      className="scroll-mt-28 border-t border-navy-950/10 pt-12 first:border-t-0 first:pt-0 lg:pt-14 first:lg:pt-0"
    >
      <div className="grid gap-8 lg:grid-cols-[260px,minmax(0,1fr)] lg:gap-12">
        {/* Identity column */}
        <div>
          <div className="lg:sticky lg:top-24">
            <div
              data-animate="mask"
              className="media-grade aspect-[4/5] w-full max-w-[260px] rounded-2xl bg-porcelain ring-1 ring-navy-950/10"
            >
              <Image
                src={photo}
                alt={name}
                fill
                sizes="(min-width: 1024px) 260px, (min-width: 640px) 40vw, 80vw"
                className="object-cover object-top"
              />
            </div>

            <h3 className="mt-6 font-display text-2xl font-[560] leading-tight tracking-[-0.01em] text-navy-950">
              {name}
              {nick && (
                <span className="accent-serif mt-1 block text-lg text-accent-gold">{nick}</span>
              )}
            </h3>

            <div className="mt-2.5 space-y-1">
              {roles.map((role, i) => (
                <p
                  key={role}
                  className={
                    i === 0
                      ? "text-[13.5px] font-semibold leading-snug text-navy-900"
                      : "text-[13px] font-medium leading-snug text-muted"
                  }
                >
                  {role}
                </p>
              ))}
            </div>

            {zone && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
                <MapPin aria-hidden className="h-3.5 w-3.5 text-gold-deep" />
                {zone}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5 border-t border-navy-950/10 pt-5">
              {biodata && (
                <a
                  href={biodata}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-sm text-[13px] font-semibold text-gold-deep transition-colors duration-200 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
                >
                  <FileDown aria-hidden className="h-4 w-4" />
                  Biodata (PDF)
                </a>
              )}
              {video && (
                <a
                  href={video}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-sm text-[13px] font-semibold text-navy-900 transition-colors duration-200 hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
                >
                  <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
                  Video introduction
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Biography — 68ch measure, Fraunces lede on the opening paragraph */}
        <div
          data-animate="up"
          data-animate-duration="0.7"
          className="prose-measure space-y-4 text-ink/75 [&>p:first-of-type]:font-display [&>p:first-of-type]:text-[1.35rem] [&>p:first-of-type]:font-[450] [&>p:first-of-type]:leading-[1.5] [&>p:first-of-type]:tracking-[-0.01em] [&>p:first-of-type]:text-navy-950 [&_b]:font-semibold [&_b]:text-navy-900"
        >
          {bio}
        </div>
      </div>
    </section>
  );
}
