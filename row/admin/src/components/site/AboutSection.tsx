import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/motion/SpotlightCard";

const POINTS = [
  "We connect passionate individuals",
  "We collaborate for meaningful projects",
  "We create sustainable solutions",
];

/**
 * Home "About" — true bento on a 12-col grid: 7×2 photo anchor (tilt),
 * 5×2 porcelain number tile, mixed-size satellites. BENTO CASCADE via
 * authored data-animate-delay per tile (anchor always first).
 */
export function AboutSection() {
  return (
    <section className="relative overflow-hidden bg-paper py-24 lg:py-32">
      <div className="container-rotary relative">
        {/* Header */}
        <div className="mb-12 max-w-3xl">
          <span data-animate="rule" className="rule-gold" />
          <p data-animate="up" className="eyebrow mt-4">
            Who We Are
          </p>
          <h2
            data-animate="up"
            data-animate-delay="0.08"
            className="mt-5 font-display text-display-2 font-[450] tracking-[-0.02em] text-navy-950"
          >
            One network. <em className="accent-serif text-accent-gold">Five nations.</em>
          </h2>
        </div>

        {/* Bento — 12-col, mixed radii, no two adjacent tiles the same size */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
          {/* Anchor — 7×2 photo */}
          <SpotlightCard
            tilt
            data-animate="up"
            className="media-grade min-h-[320px] rounded-[24px] ring-1 ring-navy-950/10 sm:col-span-2 lg:col-span-7 lg:row-span-2 lg:min-h-[520px]"
          >
            <Image
              src="/images/about-hero.jpg"
              alt="Rotarians serving their community"
              fill
              sizes="(max-width: 1024px) 100vw, 58vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-midnight/70 via-transparent to-transparent" />
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-4">
              <p className="font-display text-xl font-[450] leading-tight text-cream sm:text-2xl">
                United in service.
                <br />
                Driven by impact.
              </p>
              <span className="chip-gold flex-shrink-0">Since 1920</span>
            </div>
          </SpotlightCard>

          {/* Number tile — 5×2 on porcelain, gold-deep figure */}
          <div
            data-animate="up"
            data-animate-delay="0.06"
            className="flex flex-col rounded-[24px] bg-porcelain p-7 ring-1 ring-navy-950/[0.06] lg:col-span-5 lg:row-span-2 lg:p-9"
          >
            <p className="text-[15px] leading-relaxed text-ink/75 sm:text-base">
              We are a vibrant network of Rotary Clubs across Zones 4, 5, 6, 7 &amp; 8.
              Rooted in the spirit of &ldquo;Service Above Self&rdquo;,
              we bring together leaders, professionals, and community members to connect
              passion with purpose.
            </p>
            <div className="mt-auto pt-10">
              <p className="microlabel">Serving communities since</p>
              <p className="figure mt-2 font-display text-giant font-[340] leading-none text-gold-deep">
                1920
              </p>
            </div>
            <div className="mt-9">
              <Link href="/about-us" className="btn-primary group">
                Know More About Rotary
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>

          {/* Satellite — three commitments, 4-col */}
          <div
            data-animate="up"
            data-animate-delay="0.12"
            className="card rounded-2xl p-6 lg:col-span-4"
          >
            <ul>
              {POINTS.map((p, i) => (
                <li
                  key={p}
                  className={
                    "flex items-center gap-3 py-3.5" + (i > 0 ? " border-t border-navy-950/10" : "")
                  }
                >
                  <span className="block h-px w-4 flex-shrink-0 bg-gold" aria-hidden />
                  <span className="text-[14px] font-medium text-navy-950">{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Satellite — bare pull-quote on porcelain, 5-col */}
          <div
            data-animate="up"
            data-animate-delay="0.09"
            className="rounded-2xl bg-porcelain p-7 lg:col-span-5"
          >
            <p className="font-display text-xl font-[450] leading-snug tracking-[-0.01em] text-navy-950">
              &ldquo;Service Above Self&rdquo; isn&apos;t a slogan &mdash; it&apos;s how lasting
              change gets built, one community at a time.
            </p>
            <p className="microlabel mt-5">The Rotary Motto</p>
          </div>

          {/* Satellite — photo, 3-col */}
          <div
            data-animate="up"
            data-animate-delay="0.15"
            className="media-grade min-h-[200px] rounded-2xl ring-1 ring-navy-950/10 lg:col-span-3"
          >
            <Image
              src="/images/whoweare/wwa-community.jpg"
              alt="Community service in action"
              fill
              sizes="(max-width: 1024px) 100vw, 25vw"
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
