/**
 * Closing invitation — the live About page's sixth, seventh and eighth
 * paragraphs, staged as a quiet porcelain panel (the footer's CTA band
 * carries the loud finale).
 */
export function JoinBand() {
  return (
    <section className="bg-paper pb-24 pt-6 lg:pb-32">
      <div className="container-rotary">
        <div
          className="rounded-3xl bg-porcelain px-6 py-14 sm:px-12 lg:px-16 lg:py-16"
          data-animate="up"
        >
          <div className="max-w-3xl">
            <div className="rule-gold" aria-hidden />
            <p className="eyebrow mt-3.5">Join Us</p>
            <h2 className="mt-6 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
              Together, let&apos;s{" "}
              <em className="accent-serif text-accent-gold">Rotary!</em>
            </h2>
            <p className="mt-7 text-[15px] leading-relaxed text-ink/75 sm:text-base">
              Join us on this journey of service and fellowship. Whether you are an
              experienced professional, a community leader, or someone eager to make a
              positive impact, Rotary Clubs in the zones welcome you to be
              a part of our transformative initiatives that shape a better future for
              all.
            </p>
            <p className="mt-5 text-[15px] leading-relaxed text-ink/75 sm:text-base">
              Discover the joy of service, the strength of community, and the boundless
              potential for positive change with Rotary Clubs in the zones.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-5 border-t border-navy-950/10 pt-8">
              <p className="text-[15px] font-medium tracking-tight text-navy-950">
                Come, together let&rsquo;s make the world a better place.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
