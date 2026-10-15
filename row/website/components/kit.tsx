// Shared building blocks for the inner pages, in the Fellowship design language.
// Every piece of visible text comes in through props, verbatim from the content doc.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import Arrow from "./Arrow";
import { DEMO_HREF, DEMO_LABEL } from "@/lib/site";

export const COLORS = ["sky", "lilac", "marigold", "mint", "coral", "cream2"] as const;
const ICON_C = ["marigold", "mint", "coral", "azure"] as const; // card icon tiles
const STEP_C = ["azure", "mint", "marigold", "coral"] as const; // step icon tiles, clear of the number circles' colours
export type Tone = "sky" | "lilac" | "marigold" | "mint" | "coral" | "cream2" | "ink" | "azure";

export function DemoButton({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <span className="magnet" data-magnet>
      <Link className={`btn btn--primary btn--${size}`} href={DEMO_HREF}>
        {DEMO_LABEL}
        <Arrow />
      </Link>
    </span>
  );
}

/** Hand-drawn pen line under (or around) a phrase in a heading. */
export function Scribble({ children, kind = "under" }: { children: ReactNode; kind?: "under" | "circle" }) {
  return (
    <span className="scribble-wrap">
      {children}
      {kind === "under" ? (
        <svg className="scribble scribble--under" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M3 15.5c38-6 96-9.5 160-9 46 .4 92 2.6 134 6.5M24 20.5c62-4.6 140-6 238-2.5" />
        </svg>
      ) : (
        <svg className="scribble scribble--circle" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M152 9C120 1 62 2 31 14 7 24 2 46 22 60c26 18 98 20 141 8 30-8 41-28 29-42-12-14-52-22-98-19" />
        </svg>
      )}
    </span>
  );
}

/** Page opener: the doc's H1, its intro paragraph, the demo button and an optional visual. */
export function PageHero({ title, intro, visual }: { title: ReactNode; intro?: ReactNode; visual?: ReactNode }) {
  return (
    <section className={`phero${visual ? " phero--visual" : ""}`} aria-labelledby="page-title">
      <div className="container phero__inner">
        <div className="phero__copy">
          <h1 className="phero__title" id="page-title">{title}</h1>
          {intro ? <p className="phero__intro" data-intro>{intro}</p> : null}
          <div className="hero__ctas" data-intro>
            <DemoButton />
          </div>
        </div>
        {visual ? <div className="phero__visual" data-intro>{visual}</div> : null}
      </div>
    </section>
  );
}

/** One doc H2 section. Give `c` for a rounded colour panel; leave it out for a plain cream section. */
export function Section({
  id, title, c, aside, children, className = "",
}: { id: string; title: ReactNode; c?: Tone; aside?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section id={id} className={`psec${c ? " panel" : ""}${aside ? " psec--split" : ""} ${className}`.trim()} data-c={c} aria-labelledby={`${id}-title`}>
      <div className="container psec__inner">
        <div className="psec__main">
          <h2 className="h2" id={`${id}-title`} data-split>{title}</h2>
          {children}
        </div>
        {aside ? <div className="psec__aside" data-reveal="fade">{aside}</div> : null}
      </div>
    </section>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="lead-p" data-reveal>{children}</p>;
}

/** A doc list as colour tiles. "Label: rest" lines become a tile title plus body, split at the first colon.
    `icons` (24-unit line icons, one per line) put an icon tile on each card. */
export function CardGrid({ items, cols = 3, icons }: { items: string[]; cols?: 2 | 3 | 4; icons?: ReactNode[] }) {
  return (
    <ul className="kgrid" data-cols={cols}>
      {items.map((line, i) => {
        const at = line.indexOf(": ");
        const title = at > 0 ? line.slice(0, at) : null;
        const body = at > 0 ? line.slice(at + 2) : line;
        return (
          <li key={i} className="kcard" data-c={COLORS[i % COLORS.length]} data-reveal style={{ "--tilt": `${i % 2 ? 1.2 : -1.2}deg` } as CSSProperties}>
            {icons?.[i] ? (
              <span className="kcard__icon" data-c={ICON_C[i % ICON_C.length]} aria-hidden="true">
                <svg viewBox="0 0 24 24">{icons[i]}</svg>
              </span>
            ) : null}
            {title ? (
              <>
                <h3 className="kcard__t">{title}</h3>
                <p className="kcard__b">{body}</p>
              </>
            ) : (
              <p className="kcard__solo">{body}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Doc "Label: rest" lines as the home page's picture cards: a text-free picture in a colour well, the label, then
    the rest. Two cards lie picture-beside-words on wide screens. */
export function ArtCards({ items, cols = 3 }: { items: { line: string; c: Tone; art: ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <ul className="aud" data-cols={cols}>
      {items.map(({ line, c, art }) => {
        const at = line.indexOf(": ");
        return (
          <li key={line} className="aud__card" data-reveal>
            <div className="aud__art" data-c={c} aria-hidden="true">{art}</div>
            <div className="aud__words">
              <h3 className="aud__t">{line.slice(0, at)}</h3>
              <p className="aud__b">{line.slice(at + 2)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Ordered doc steps. The numbers come from CSS counters, not from the copy. "Title. Rest" splits at the first full stop when `lead` is set. */
export function Steps({ items, lead = false, icons }: { items: string[]; lead?: boolean; icons?: ReactNode[] }) {
  return (
    <ol className="ksteps">
      {items.map((line, i) => {
        const at = lead ? line.indexOf(". ") : -1;
        return (
          <li key={i} className="kstep" data-reveal>
            {icons?.[i] ? (
              <span className="kstep__icon" data-c={STEP_C[i % STEP_C.length]} aria-hidden="true">
                <svg viewBox="0 0 24 24">{icons[i]}</svg>
              </span>
            ) : null}
            {at > 0 ? (
              <p><strong className="kstep__t">{line.slice(0, at + 1)}</strong> {line.slice(at + 2)}</p>
            ) : (
              <p>{line}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A doc table. The first column is the row header; `highlight` marks one column (ROW in the comparison). */
export function Table({ head, rows, highlight, label }: { head: string[]; rows: string[][]; highlight?: number; label: string }) {
  return (
    <div className="ktable" data-reveal>
      <div className="ktable__scroll" role="region" aria-label={label} tabIndex={0}>
        <table data-cols={head.length}>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col" className={i === highlight ? "is-hl" : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) =>
                  ci === 0 ? (
                    <th key={ci} scope="row">{cell}</th>
                  ) : (
                    <td key={ci} className={ci === highlight ? "is-hl" : undefined}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Doc questions and answers as the Fellowship accordion. Questions keep their heading level. */
export function Faq({ items, idPrefix, level = 3 }: { items: { q: string; a: string }[]; idPrefix: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="faq__list" data-faq>
      {items.map((it, i) => (
        // one shared name: the browser keeps a single answer open at a time
        <details key={i} className="faq__item" id={`${idPrefix}-${i + 1}`} name={idPrefix}>
          <summary className="faq__q">
            <H className="faq__h">{it.q}</H>
            <span className="faq__icon" aria-hidden="true"><i /><i /></span>
          </summary>
          <div className="faq__a"><p>{it.a}</p></div>
        </details>
      ))}
    </div>
  );
}

/** The number row: a ROW wheel per item; the wheels roll in and the numbers count up once when they come into view. */
export function Stats({ items, label }: { items: { value: string; label: string }[]; label?: string }) {
  return (
    <section className="proof" aria-label={label} data-proof>
      <div className="container">
        <ul className="proof__list">
          {items.map((it, i) => {
            const m = it.value.match(/^([\d,]+)(.*)$/);
            const n = m ? m[1].replace(/,/g, "") : "";
            const suffix = m ? m[2] : "";
            return (
              <li key={i} className="stat">
                <span className="stat__wheel" aria-hidden="true" />
                <span className="stat__num" data-final={it.value}>
                  <span data-count={n} data-suffix={suffix}>{it.value}</span>
                </span>
                <span className="stat__label">{it.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="knote" data-reveal>{children}</p>;
}
