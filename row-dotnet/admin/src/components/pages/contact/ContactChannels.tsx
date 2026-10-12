"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";

/* Verbatim contact data from the live site — do not edit. */
const EMAIL = "support@example.org";
const PHONE_NUMBERS = ["", ""];

/** Mon–Fri 10:00–18:30 IST — the helpline hours published on the live site. */
function isOpenNowIST(): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday");
  const minutes = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day);
  return weekday && minutes >= 10 * 60 && minutes < 18 * 60 + 30;
}

/** Live open/closed chip — computed client-side so it's never a stale claim. */
function OpenChip() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setOpen(isOpenNowIST());
    const t = setInterval(() => setOpen(isOpenNowIST()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (open === null) return null;
  return open ? (
    <span className="chip-gold">Open now</span>
  ) : (
    <span className="chip !text-muted">Closed now</span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex h-10 w-10 items-center justify-center rounded-full text-ink/50 ring-1 ring-navy-950/15 transition-colors duration-200 hover:bg-porcelain hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
    >
      {copied ? (
        <Check className="h-4 w-4 text-gold-deep" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

function ChannelRow({
  label,
  value,
  figure,
  note,
  href,
  hrefLabel,
  chip,
}: {
  label: string;
  value: string;
  /** Phone numbers and times wear .figure so digits never jitter. */
  figure?: boolean;
  note?: string;
  href?: string;
  hrefLabel?: string;
  chip?: React.ReactNode;
}) {
  return (
    <div
      data-animate="left"
      data-animate-duration="0.35"
      className="ledger-row flex flex-wrap items-center gap-x-6 gap-y-3 py-5"
    >
      <div className="min-w-0 flex-1">
        <p className="microlabel">{label}</p>
        <p
          className={
            "mt-1.5 break-all text-[17px] text-navy-950 " +
            (figure ? "figure" : "font-semibold")
          }
        >
          {value}
        </p>
        {note && <p className="mt-1 text-[13px] leading-relaxed text-muted">{note}</p>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {chip}
        <CopyButton value={value} label={label} />
        {href && (
          <a
            href={href}
            aria-label={hrefLabel}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-midnight transition-colors duration-200 hover:bg-gold-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2"
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

/** Contact channels as ledger rows — copy-to-clipboard beside each, and a
 *  live open/closed chip on the helpline hours. LEDGER SWEEP reveal. */
export function ContactChannels() {
  return (
    <div data-animate-stagger="left" className="border-t border-navy-950/[0.10]">
      <ChannelRow
        label="Email"
        value={EMAIL}
        note="We usually reply within 24 hours."
        href={`mailto:${EMAIL}`}
        hrefLabel={`Email ${EMAIL}`}
      />
      {PHONE_NUMBERS.map((num, i) => (
        <ChannelRow
          key={num}
          label={i === 0 ? "Helpline" : "Helpline (alternate)"}
          value={num}
          figure
          href={`tel:${num.replace(/\s+/g, "")}`}
          hrefLabel={`Call ${num}`}
        />
      ))}
      <ChannelRow
        label="Helpline hours"
        value="Mon – Fri, 10:00 – 18:30 IST"
        figure
        note="Closed on weekends and public holidays — email us instead."
        chip={<OpenChip />}
      />
    </div>
  );
}
