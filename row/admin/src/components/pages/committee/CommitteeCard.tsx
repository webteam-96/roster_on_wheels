import Image from "next/image";
import { ShieldCheck } from "lucide-react";

export type Member = {
  /** Kept for data fidelity with rotaryindia.org/committee.aspx (unrendered). */
  n: string;
  /** Displayed name, verbatim from rotaryindia.org/committee.aspx. */
  name: string;
  /** Image alt text (kept from the live page). */
  alt: string;
  /** Primary role/designation line, verbatim. */
  role: string;
  /** Advisors' second designation line, e.g. "(2026-30)". */
  roleNote?: string;
  /** Committee members' district line, e.g. "(District 3291)". */
  district?: string;
  variant: "advisor" | "member";
  photo: string;
};

/** Refined portrait card: graded photo, serif name, Inter role — finished at
 *  rest with zero hover. No contact affordances: the source data publishes
 *  none, and dead icons would be false affordances. */
export function CommitteeCard({ m }: { m: Member }) {
  return (
    <div data-animate="up" className="card flex flex-col overflow-hidden">
      <div className="media-grade aspect-[4/5] w-full bg-paper-200">
        <Image
          src={m.photo}
          alt={m.alt}
          fill
          sizes="(min-width: 1024px) 20vw, (min-width: 640px) 30vw, 45vw"
          className="object-cover object-top"
        />
      </div>

      <div className="flex flex-1 flex-col p-4 pb-5">
        <h3 className="font-display text-[17px] font-[450] leading-snug tracking-tight text-navy-950">
          {m.name}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {m.role}
          {m.roleNote && <span className="block text-ink/50">{m.roleNote}</span>}
        </p>

        <div className="mt-auto pt-4">
          {m.variant === "advisor" ? (
            <span className="chip-gold">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Advisor
            </span>
          ) : (
            <span className="chip figure">{m.district}</span>
          )}
        </div>
      </div>
    </div>
  );
}
