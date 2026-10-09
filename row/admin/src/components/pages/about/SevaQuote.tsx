/**
 * Our ethos — the live About page's fourth paragraph, verbatim, staged as the
 * page's Fraunces pull-quote moment: generous whitespace, one italic accent.
 */
export function SevaQuote() {
  return (
    <section className="bg-paper py-28 lg:py-40">
      <div className="container-rotary">
        <div className="mx-auto max-w-4xl text-center">
          <div data-animate="rule" className="rule-gold mx-auto" aria-hidden />
          <p className="eyebrow mt-4" data-animate="up" data-animate-duration="0.7">
            Our Ethos
          </p>
          <blockquote
            data-animate="up"
            data-animate-duration="1.1"
            className="mt-8 font-display text-heading font-[340] tracking-[-0.02em] text-navy-950"
          >
            The ethos of Rotary in our regions is deeply rooted in the spirit of{" "}
            <em className="accent-serif text-accent-gold">
              &#39;Seva Parmo Dharma&#39;
            </em>
            &mdash;service is the highest form of virtue.
          </blockquote>
          <p
            data-animate="up"
            data-animate-duration="0.7"
            className="mx-auto mt-10 max-w-2xl text-[15px] leading-relaxed text-ink/70 sm:text-base"
          >
            Our commitment to Service Above Self is evident in the numerous local and
            international projects undertaken by Rotary Clubs across these nations.
          </p>
        </div>
      </div>
    </section>
  );
}
