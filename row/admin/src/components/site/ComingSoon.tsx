import Link from "next/link";
import { ArrowUpRight, Hourglass } from "@/components/icons";
import { PageBanner } from "@/components/site/PageBanner";
import { PageFooter } from "@/components/site/PageFooter";

/** Reusable placeholder page: one quiet porcelain panel, serif heading,
 *  three useful interim links. */
export function ComingSoon({
  title,
  accent,
  message,
  hideLinks = false,
}: {
  title: string;
  accent?: string;
  message?: string;
  hideLinks?: boolean;
}) {
  return (
    <>
      <PageBanner eyebrow="Under Construction" subtitle="This section is on its way.">
        {title}
        {accent && <span className="text-gold"> {accent}</span>}
      </PageBanner>

      <section className="bg-paper py-20 lg:py-28">
        <div className="container-rotary">
          <div
            data-animate="up"
            className="mx-auto flex max-w-2xl flex-col items-center rounded-2xl bg-porcelain px-6 py-14 text-center ring-1 ring-navy-950/[0.06] sm:px-12"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 ring-1 ring-gold/30">
              <Hourglass className="h-6 w-6 text-gold-deep" strokeWidth={1.75} />
            </span>

            <h2 className="mt-7 font-display text-heading font-[450] tracking-tight text-navy-950">
              Coming <em className="accent-serif text-accent-gold">soon</em>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              {message ??
                `The ${title}${accent ? " " + accent : ""} section is under construction. We're working hard to bring it to you. Please check back soon.`}
            </p>

            {!hideLinks && (
              <>
                <p className="microlabel mt-10">In the meantime</p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <Link href="/download" className="btn-ghost">
                    Download App
                  </Link>
                  <Link href="/websites" className="btn-ghost">
                    Find a Club Website
                  </Link>
                  <Link
                    href={process.env.NEXT_PUBLIC_PORTAL_ORIGIN || "/"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost group"
                  >
                    ROW
                    <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <PageFooter />
    </>
  );
}
