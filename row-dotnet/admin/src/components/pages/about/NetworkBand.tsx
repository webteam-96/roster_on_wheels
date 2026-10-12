/**
 * Our network — the live About page's fifth paragraph, verbatim, staged as the
 * page body's ONE midnight band with crisp edges. The two inline figures stay
 * wired to the GSAP count-up, set in gold — free on midnight (9.4:1).
 */
export function NetworkBand() {
  return (
    <section>
      <div className="relative overflow-hidden bg-midnight bg-glow-warm text-cream">
        <div className="container-rotary py-14 lg:py-20">
          <div className="max-w-3xl">
            <div data-animate="rule" className="rule-gold" aria-hidden />
            <p className="eyebrow-light mt-3.5" data-animate="up" data-animate-duration="0.7">
              Our Network
            </p>
            <p
              className="mt-7 text-[17px] leading-relaxed text-cream/85 sm:text-lg"
              data-animate="up"
            >
              As part of Rotary International, the approximately{" "}
              <span className="figure text-gold" data-counter="180000">
                1,80,000
              </span>{" "}
              Rotarians spread across over{" "}
              <span className="figure text-gold" data-counter="4500">
                4,500
              </span>{" "}
              clubs in these zones form a formidable force for positive change. These
              clubs provide a platform for collaboration, networking, and exchange of
              ideas. With clubs spanning urban centers, rural communities, and everything
              in between, we offer a unique opportunity for individuals to connect,
              engage, and contribute to meaningful projects that align with their
              passions and expertise.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
