import Image from "next/image";

const TICKER = [
  "Service Above Self",
  "Uniting Clubs",
  "Inspiring Leaders",
  "Transforming Lives",
  "One Fellowship",
];

/** The four zone figures — count up live inside the azure tile. */
const IMPACT = [
  { count: 180000, suffix: "+", label: "Rotarians" },
  { count: 4500, suffix: "+", label: "Clubs" },
  { count: 44, suffix: "", label: "Districts" },
  { count: 5, suffix: "", label: "Nations" },
];

/**
 * MISSION-CONTROL banner — the About page opens on a kinetic bento: headline
 * on a sky tile, the region photo, live count-up figures (azure tile), a gold
 * join tile, and a five-nations ticker strip underneath. No dark scrims.
 */
export function AboutBento() {
  return (
    <section className="bg-paper pb-6 pt-6 lg:pt-8">
      <div className="container-wide">
        <div
          data-animate-stagger="up"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12"
        >
          {/* Headline tile — 7×2 on sky */}
          <div
            data-animate="up"
            className="flex flex-col justify-center rounded-[24px] bg-[#E3EEFA] p-7 sm:col-span-2 sm:p-10 lg:col-span-7 lg:row-span-2 lg:p-14"
          >
            <p className="eyebrow">About Us · Since 1920</p>
            {/* h2 — the PageBanner above owns the page's one h1 */}
            <h2 className="mt-5 font-sans text-[clamp(2.1rem,4vw,3.4rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-navy-950">
              About Rotary Clubs in{" "}
              <span className="text-azure">Zones 4,&nbsp;5,&nbsp;6,&nbsp;7&nbsp;&amp;&nbsp;8</span>
            </h2>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink/75 sm:text-base">
              Service, diversity and community spirit — uniting clubs, inspiring
              leaders, transforming lives.
            </p>
          </div>

          {/* Region photo tile — 5×1 */}
          <div
            data-animate="up"
            className="media-grade relative min-h-[260px] rounded-[24px] ring-1 ring-navy-950/10 sm:col-span-2 lg:col-span-5"
          >
            <Image
              src="/images/about-hero.jpg"
              alt="Rotary volunteers preparing food and supplies for community distribution"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 40vw"
              className="object-cover"
            />
          </div>

          {/* Impact figures tile — 3×1 on azure */}
          <div
            data-animate="up"
            className="grid grid-cols-2 content-center gap-x-4 gap-y-5 rounded-[24px] bg-azure p-6 text-white lg:col-span-5 lg:p-7"
          >
            {IMPACT.map((s) => (
              <div key={s.label}>
                <p
                  data-counter={s.count}
                  data-counter-suffix={s.suffix}
                  className="figure text-[clamp(1.4rem,1.8vw,1.8rem)] leading-none"
                >
                  {s.count.toLocaleString("en-IN")}
                  {s.suffix}
                </p>
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                  {s.label}
                </p>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Five-nations ticker — full-bleed strip across the whole page */}
      <div
        data-animate="up"
        className="ticker mt-4 bg-midnight py-3 text-cream/85"
      >
        <div>
          {[0, 1].map((copy) => (
            <span key={copy} aria-hidden={copy === 1} className="flex items-center">
              {TICKER.map((n) => (
                <span key={n} className="flex items-center">
                  <span className="px-5 text-[11.5px] font-semibold uppercase tracking-[0.22em]">
                    {n}
                  </span>
                  <span aria-hidden className="text-gold">
                    ✦
                  </span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
