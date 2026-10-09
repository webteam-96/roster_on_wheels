import { cn } from "@/lib/utils";

/**
 * SPLIT SERIF HERO for inner pages: 60/40 asymmetric grid on a quiet
 * porcelain wash. Left: gold hairline draw + eyebrow, Fraunces display-2 H1
 * (word-mask serif rise via data-split — the ONE split heading per page),
 * one-line standfirst, optional breadcrumb + tabs. Right: optional
 * `rightSlot` (portrait cluster, live count, phone mock…) — hidden on mobile.
 *
 * Backward compatible: pass the accent word as <span className="text-gold">
 * inside children — it renders contrast-safe deep gold in the serif italic
 * accent voice (see .banner-title in globals.css).
 */
export function PageBanner({
  eyebrow,
  subtitle,
  breadcrumb,
  tone = "navy",
  tabs,
  rightSlot,
  children,
}: {
  eyebrow?: string;
  subtitle?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  /** Kept for compatibility; both tones render the light treatment. */
  tone?: "navy" | "royal";
  tabs?: React.ReactNode;
  /** Rendered in the right 40% column at lg+ (hidden on mobile). */
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // Plain string concat, not cn() — tailwind-merge can't classify the custom
    // bg utilities and would drop one of the pair.
    <section
      className={
        "relative overflow-hidden bg-porcelain bg-glow-warm-light" +
        (tone === "royal" ? " bg-glow-royal" : "")
      }
    >
      <div className="container-rotary relative py-10 lg:py-16">
        <div
          className={cn(
            "grid items-center gap-10",
            rightSlot && "lg:grid-cols-[3fr_2fr]"
          )}
        >
          <div className="text-left">
            <div data-animate="rule" className="rule-gold" />
            {eyebrow && (
              <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
                {eyebrow}
              </p>
            )}
            <h1
              data-split
              className="banner-title mt-5 font-display text-display-2 font-[450] tracking-[-0.02em] text-navy-950"
            >
              {children}
            </h1>
            {breadcrumb && (
              <nav
                data-animate="up"
                data-animate-duration="0.7"
                className="microlabel mt-5 !text-ink/50"
                aria-label="Breadcrumb"
              >
                {breadcrumb}
              </nav>
            )}
            {subtitle && (
              <p
                data-animate="up"
                data-animate-duration="0.7"
                data-animate-delay="0.1"
                className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted"
              >
                {subtitle}
              </p>
            )}
          </div>

          {rightSlot && (
            <div data-animate="in" data-animate-delay="0.25" className="hidden lg:block">
              {rightSlot}
            </div>
          )}
        </div>

        {tabs && (
          <div data-animate="up" data-animate-delay="0.15" className="mt-9">
            {tabs}
          </div>
        )}
      </div>
    </section>
  );
}
