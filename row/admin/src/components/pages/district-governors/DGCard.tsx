"use client";

import { useState } from "react";
import Image from "next/image";
import { Mail, Phone } from "@/components/icons";
import type { Governor } from "./data";

const PREFIX = /^(Dr|PRID|PDG|PP|Rtn|Mr|Mrs|Ms|RID|Sir)\.?$/i;
function initials(name: string): string {
  const words = name.replace(/["'()]/g, "").split(/\s+/).filter((w) => w && !PREFIX.test(w));
  const letters = words.map((w) => w.replace(/[^A-Za-z]/g, "")).filter(Boolean);
  if (!letters.length) return "R";
  return (letters[0][0] + (letters.length > 1 ? letters[letters.length - 1][0] : "")).toUpperCase();
}

const ICON_BTN =
  "flex h-10 w-10 items-center justify-center rounded-full text-ink/60 ring-1 ring-navy-950/15 transition-colors duration-200 hover:bg-gold hover:text-midnight hover:ring-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark";

/**
 * LEDGER ROW for one District Governor: the district number IS the numeral
 * (.figure), graded portrait with initials fallback, serif name, one
 * icon-only contact row on the right. Rows sweep in at 0.35s.
 */
export function DGCard({ dg }: { dg: Governor }) {
  const [err, setErr] = useState(false);

  return (
    <article data-animate="left" data-animate-duration="0.35" className="ledger-row">
      <div className="flex items-center gap-3.5 px-2 py-3.5 sm:gap-6 sm:px-3">
        <p className="figure w-12 shrink-0 text-lg leading-none text-navy-950 sm:w-16 sm:text-xl">
          {dg.district}
        </p>

        <div className="media-grade h-14 w-14 shrink-0 rounded-full bg-porcelain ring-1 ring-navy-950/10">
          {dg.photo && !err ? (
            <Image
              src={dg.photo}
              alt={`${dg.name}: District Governor, RI District ${dg.district}`}
              fill
              sizes="56px"
              onError={() => setErr(true)}
              className="object-cover object-top"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-full w-full items-center justify-center text-[13px] font-semibold text-navy-900"
            >
              {initials(dg.name)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[16px] font-[560] leading-snug tracking-[-0.01em] text-navy-950 sm:text-[17px]">
            {dg.name}
          </h3>
          <p className="mt-0.5 text-[12.5px] font-medium text-muted sm:text-[13px]">
            District Governor · RI District <span className="figure">{dg.district}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {dg.mobile && (
            <a
              href={`tel:${dg.mobile}`}
              aria-label={`Call ${dg.name}: ${dg.mobile}`}
              title={dg.mobile}
              className={ICON_BTN}
            >
              <Phone className="h-4 w-4" aria-hidden />
            </a>
          )}
          {dg.email && (
            <a
              href={`mailto:${dg.email}`}
              aria-label={`Email ${dg.name}: ${dg.email}`}
              title={dg.email}
              className={ICON_BTN}
            >
              <Mail className="h-4 w-4" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
