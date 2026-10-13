import Image from "next/image";

type Tile = { src: string; label: string };

const TILES: Tile[] = [
  { src: "/images/whoweare/wwa-medical.jpg", label: "Medical Camps" },
  { src: "/images/whoweare/wwa-tree.jpg", label: "Tree Plantation" },
  { src: "/images/whoweare/wwa-youth.jpg", label: "Youth Leadership" },
  { src: "/images/whoweare/wwa-community.jpg", label: "Community Service" },
];

/**
 * Opening story — the live About page's first two paragraphs, verbatim, set as
 * an editorial lead (drop cap) beside the 2×2 activity collage. MASK DUET: the
 * text column wipes in from the right, the collage from the left, so the two
 * halves of the spread reveal toward each other.
 */
export function AboutStory() {
  return (
    <section className="bg-paper py-24 lg:py-32">
      <div className="container-rotary grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left — the live copy (mask-right, the duet's text half) */}
        <div data-animate="mask-right" data-animate-duration="1.1">
          <div className="rule-gold" aria-hidden />
          <p className="eyebrow mt-3.5">About Us</p>
          <p className="mt-7 text-[17px] leading-relaxed text-ink/85 first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:font-display first-letter:text-6xl first-letter:font-[560] first-letter:leading-[0.8] first-letter:text-navy-950 sm:text-lg">
            Welcome to Rotary Clubs in the zones, where service,
            diversity, and community spirit converge to make a lasting impact on our
            region and beyond. With a
            rich history dating back several decades, Rotary has become an integral
            part of the social fabric across these nations, embodying the values of
            unity, service, and humanitarianism.
          </p>
          <p className="mt-8 border-t border-navy-950/10 pt-8 text-[15px] leading-relaxed text-ink/70">
            Rotary Clubs in these zones are dynamic hubs of activity, bringing together
            passionate individuals from various walks of life&mdash;business leaders,
            professionals, educators, and community builders&mdash;all united by a
            shared commitment to making a positive difference. Our clubs are vibrant
            microcosms that reflect the cultural tapestry of our diverse region,
            fostering a sense of belonging and camaraderie among members.
          </p>
        </div>

        {/* Right — 2×2 activity collage (mask, the duet's image half) */}
        <div data-animate="mask" data-animate-duration="1.1">
          <div className="grid grid-cols-2 gap-4 sm:gap-5">
            {TILES.map(({ src, label }) => (
              <figure
                key={label}
                className="media-grade relative aspect-[4/3] rounded-xl ring-1 ring-navy-950/10"
              >
                <Image
                  src={src}
                  alt={label}
                  fill
                  sizes="(max-width: 1024px) 45vw, 22vw"
                  className="object-cover"
                />
                <figcaption className="chip absolute bottom-3 left-3">{label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
