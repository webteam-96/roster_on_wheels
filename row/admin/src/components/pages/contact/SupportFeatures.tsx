import { Headset, Clock, Users } from "@/components/icons";

const FEATURES = [
  {
    Icon: Headset,
    title: "Dedicated Support",
    desc: "We are here to assist you with your queries.",
  },
  {
    Icon: Clock,
    title: "Timely Assistance",
    desc: "Quick response during working hours.",
  },
  {
    Icon: Users,
    title: "Reliable Service",
    desc: "Committed to helping Rotary community always.",
  },
];

/** Quiet porcelain trust cards below the channels — SETTLE stagger, finished
 *  at rest with zero hover. */
export function SupportFeatures() {
  return (
    <div data-animate-stagger="up" className="grid gap-5 md:grid-cols-3">
      {FEATURES.map(({ Icon, title, desc }) => (
        <div
          key={title}
          data-animate="up"
          data-animate-duration="0.7"
          className="rounded-2xl bg-porcelain p-6 ring-1 ring-navy-950/[0.06] sm:p-7"
        >
          <Icon className="h-5 w-5 text-gold-deep" strokeWidth={1.75} aria-hidden />
          <h3 className="mt-4 font-display text-lg font-[450] tracking-tight text-navy-950">
            {title}
          </h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{desc}</p>
        </div>
      ))}
    </div>
  );
}
