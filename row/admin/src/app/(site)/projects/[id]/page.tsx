import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "@/components/icons";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Filmstrip } from "@/components/motion/Filmstrip";
import { CardMedia } from "@/components/pages/projects/CardMedia";
import { fmt, niceDate, parseTime, titleCase } from "@/components/pages/projects/shared";
import { formatMoney, getCurrencySymbol } from "@/lib/currency";
import { photoUrl, shareImageUrl, type Project } from "@/lib/projectsApi";
import { getProjectDetail } from "@/lib/projectsBrowse";

/** ?yearId= from the card link — ids repeat across year tables, so without it
 *  the API can resolve to a different year's project with the same id. */
function parseYearId(searchParams: { yearId?: string }): number | undefined {
  const n = Number(searchParams.yearId);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Same 200-char word-boundary rule the share API uses for `summary`, so the unfurl
 *  blurb and the text a member copies from the share sheet read identically. */
function shareSummary(description: string | null): string {
  const s = (description ?? "").replace(/\\n|\\r/g, " ").replace(/\s+/g, " ").trim();
  if (s.length <= 200) return s;
  const cut = s.slice(0, 200);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { yearId?: string };
}): Promise<Metadata> {
  const id = Number(params.id);
  const yearId = parseYearId(searchParams);
  const data = await getProjectDetail(id, yearId);
  const title = data?.project.title?.trim();
  const pageTitle = title ? `${title} | Rotary Projects` : "Project | ROW";
  if (!data) return { title: pageTitle };

  // OpenGraph / Twitter tags point at the API-generated 1200x630 card, so a link pasted
  // into messaging and social app unfurls with a preview instead of a bare URL.
  const p = data.project;
  const club = p.clubName?.trim();
  const byline = [club ? `Rotary Club of ${club}` : null, p.districtNumber ? `RI District ${p.districtNumber}` : null]
    .filter(Boolean)
    .join(" | ");
  const summary = shareSummary(p.description);
  const description = summary || byline || undefined;
  const ogTitle = title || "Rotary service project";
  const image = shareImageUrl(id, yearId);

  return {
    title: pageTitle,
    description,
    openGraph: {
      type: "article",
      title: ogTitle,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: ogTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [image],
    },
  };
}

/** First paragraph as a serif lede when it's lede-sized; otherwise no lede. */
function splitLede(text: string): [string | null, string] {
  const i = text.indexOf("\n");
  if (i > 40 && i <= 260) return [text.slice(0, i).trim(), text.slice(i).trim()];
  return [null, text];
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { yearId?: string };
}) {
  const id = Number(params.id);
  // One fetch only: speculative "related projects" lookups multiply upstream
  // calls during render and keep the response stream open when the API is
  // slow or down — the explore band below links into the hub instead.
  const data = Number.isFinite(id) ? await getProjectDetail(id, parseYearId(searchParams)) : null;
  if (!data) notFound();
  const p: Project = data.project;
  const photos = data.photos ?? [];
  const date = niceDate(parseTime(p.projectDate));
  const primary = photos.find((ph) => ph.isPrimary) ?? photos[0] ?? null;
  const area = p.areaOfFocus?.trim() || null;

  /* NUMBER ROW — the three persuasive figures, one ruled ledger row.
     Cost carries the project's OWN currency (the brand's when unset); the counter
     animates the full amount, matching the People/Man-hours cells beside it. */
  const costSymbol = getCurrencySymbol(p.currency);
  const numberRow = [
    p.projectCost != null && {
      label: "Project cost",
      display: formatMoney(p.projectCost, p.currency),
      target: p.projectCost,
      decimals: 0,
      prefix: costSymbol.length > 1 ? `${costSymbol} ` : costSymbol,
      suffix: "",
    },
    p.directBeneficiaries != null && {
      label: "People served",
      display: fmt(p.directBeneficiaries),
      target: p.directBeneficiaries,
      decimals: 0,
      prefix: "",
      suffix: "",
    },
    p.manHours != null && {
      label: "Volunteer man-hours",
      display: fmt(p.manHours),
      target: p.manHours,
      decimals: 0,
      prefix: "",
      suffix: "",
    },
  ].filter(Boolean) as {
    label: string;
    display: string;
    target: number;
    decimals: number;
    prefix: string;
    suffix: string;
  }[];

  /* Margin-note pull-stats beside the description */
  const notes = [
    p.rotariansInvolved != null && {
      label: "Rotarians involved",
      value: fmt(p.rotariansInvolved),
      figure: true,
    },
    date && { label: "Completed", value: date, figure: true },
    p.funding && { label: "Funding", value: p.funding, figure: false },
    p.location &&{ label: "Location", value: p.location, figure: false },
  ].filter(Boolean) as { label: string; value: string; figure: boolean }[];

  const [lede, body] = p.description ? splitLede(p.description) : [null, ""];

  const meta = (
    <>
      {p.clubName && <span>{p.clubName}</span>}
      {p.clubRotaryId && <span className="figure">({p.clubRotaryId})</span>}
      {p.districtNumber && (
        <span>
          RID <span className="figure">{p.districtNumber}</span>
        </span>
      )}
      {p.zoneName && <span>{p.zoneName}</span>}
      {date && <span className="figure">{date}</span>}
    </>
  );


  return (
    <>
      {primary ? (
        /* ——— Image-led header: graded 16:6 hero + pulled-up dark-glass title panel ——— */
        <section className="relative bg-paper">
          <CardMedia
            src={photoUrl(primary.imagePath)}
            alt={primary.description || titleCase(p.title)}
            keepFrame
            eager
            className="media-grade aspect-[4/3] sm:aspect-[16/8] lg:aspect-[16/6]"
          />
          <div className="container-rotary">
            <div
              data-animate="up"
              data-animate-duration="1.1"
              className="glass-dark relative z-10 -mt-20 max-w-3xl p-6 sm:-mt-24 sm:p-8"
            >
              <Link
                href="/projects"
                className="microlabel-on-dark group inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <ArrowLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
                All projects
              </Link>
              {area && (
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
                  {titleCase(area)}
                </p>
              )}
              <h1
                data-split
                className="mt-3 font-display text-display-2 font-[450] tracking-[-0.02em] text-cream"
              >
                {titleCase(p.title) || "Untitled Project"}
              </h1>
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-cream/70">
                {meta}
              </p>
            </div>
          </div>
        </section>
      ) : (
        /* ——— Text header — a first-class path, in the split-hero language ——— */
        <section className="relative overflow-hidden bg-porcelain bg-glow-warm-light">
          <div className="container-rotary py-14 lg:py-20">
            <Link
              data-animate="up"
              data-animate-duration="0.7"
              href="/projects"
              className="microlabel group inline-flex min-h-11 items-center gap-1.5 !text-ink/60 transition-colors hover:!text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <ArrowLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
              All projects
            </Link>
            <div data-animate="rule" className="rule-gold mt-6" />
            {area && (
              <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
                {titleCase(area)}
              </p>
            )}
            <h1
              data-split
              className="mt-5 max-w-4xl font-display text-display-2 font-[450] tracking-[-0.02em] text-navy-950"
            >
              {titleCase(p.title) || "Untitled Project"}
            </h1>
            <p
              data-animate="up"
              data-animate-duration="0.7"
              data-animate-delay="0.1"
              className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-muted"
            >
              {meta}
            </p>
          </div>
        </section>
      )}

      {/* ——— NUMBER ROW — giant gold figures on one ruled ledger row ——— */}
      {numberRow.length > 0 && (
        <section className="bg-paper pt-12 lg:pt-16">
          <div className="container-rotary">
            <div
              data-animate="up"
              data-animate-duration="0.7"
              className="grid grid-cols-1 divide-y divide-navy-950/10 border-y border-navy-950/10 sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0"
            >
              {numberRow.map((s) => (
                <div key={s.label} className="py-7 sm:px-10 sm:py-9 sm:first:pl-0">
                  <p
                    className="figure text-[clamp(2.5rem,5.5vw,4rem)] leading-none text-gold-deep"
                    data-counter={s.target}
                    data-counter-prefix={s.prefix}
                    data-counter-suffix={s.suffix}
                    data-counter-decimals={s.decimals}
                  >
                    {s.display}
                  </p>
                  <p className="microlabel mt-3">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ——— Overview — 68ch reading measure + margin-note pull-stats ——— */}
      {(p.description || notes.length > 0) && (
        <section className="bg-paper py-14 lg:py-20">
          <div className="container-rotary lg:grid lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-16">
            <div>
              <div data-animate="rule" className="rule-gold" />
              <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
                Overview
              </p>
              <h2
                data-animate="up"
                data-animate-duration="0.7"
                className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
              >
                About this project
              </h2>
              {lede && (
                <p
                  data-animate="up"
                  data-animate-duration="0.7"
                  className="mt-7 max-w-[68ch] font-display text-[1.35rem] font-[450] leading-[1.45] text-navy-900"
                >
                  {lede}
                </p>
              )}
              {body && (
                <p
                  data-animate="up"
                  data-animate-duration="0.7"
                  className="mt-6 max-w-[68ch] whitespace-pre-line text-[17px] leading-[1.65] text-ink/80"
                >
                  {body}
                </p>
              )}
            </div>

            {notes.length > 0 && (
              <aside className="mt-12 lg:mt-0" data-animate="up" data-animate-duration="0.7">
                {notes.map((n) => (
                  <div key={n.label} className="border-t border-navy-950/10 py-4">
                    <p className="microlabel">{n.label}</p>
                    <p
                      className={
                        "mt-1 font-medium text-ink " +
                        (n.figure ? "figure text-[15px]" : "text-[14px]")
                      }
                    >
                      {n.value}
                    </p>
                  </div>
                ))}
              </aside>
            )}
          </div>
        </section>
      )}

      {/* ——— Gallery — filmstrip scrub feeding the lightbox ——— */}
      {photos.length > 1 && (
        <section className="bg-paper pb-16 lg:pb-24">
          <div className="container-rotary">
            <div data-animate="rule" className="rule-gold" />
            <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
              Gallery
            </p>
            <h2
              data-animate="up"
              data-animate-duration="0.7"
              className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
            >
              From the field{" "}
              <span className="figure align-middle text-base text-muted">({photos.length})</span>
            </h2>
            <Filmstrip
              className="mt-8"
              images={photos.map((ph) => ({
                src: photoUrl(ph.imagePath),
                caption: ph.description || undefined,
              }))}
            />
          </div>
        </section>
      )}

      {/* ——— Explore more — fetch-free links into the hub ——— */}
      <section className="bg-paper pb-24 lg:pb-28">
        <div className="container-rotary">
          <div className="flex flex-wrap items-center justify-between gap-6 border-t border-navy-950/10 pt-10">
            <h2
              data-animate="up"
              data-animate-duration="0.7"
              className="font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
            >
              Explore more service work
            </h2>
            <div
              data-animate="up"
              data-animate-duration="0.7"
              data-animate-delay="0.08"
              className="flex flex-wrap items-center gap-3"
            >
              {area && (
                <Link href={`/projects?area=${encodeURIComponent(area)}`} className="btn-ghost">
                  More in {titleCase(area)}
                </Link>
              )}
              <Link
                href="/projects"
                className="group inline-flex min-h-11 items-center gap-1.5 px-2 text-[13px] font-semibold text-gold-deep transition-colors hover:text-gold-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                All projects
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
