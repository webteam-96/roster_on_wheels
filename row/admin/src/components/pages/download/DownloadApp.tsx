import {
  ArrowUpRight,
  Bell,
  MapPin,
  Play,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import Image from "next/image";
import { AppleIcon } from "@/components/icons/SocialIcons";
import { PageBanner } from "@/components/site/PageBanner";

// Official store listings (final links supplied by the client).
const STORE_LINKS = {
  googlePlay: process.env.NEXT_PUBLIC_ANDROID_APP_URL ?? "",
  appStore: process.env.NEXT_PUBLIC_IOS_APP_URL ?? "",
};

const FEATURES = [
  {
    Icon: Users,
    title: "Club & District Directory",
    desc: "Every club and district across the zones — officers, contacts and meeting details in one place.",
  },
  {
    Icon: Search,
    title: "Find Any Rotarian",
    desc: "Search members by name or classification and connect in seconds, wherever they serve.",
  },
  {
    Icon: Bell,
    title: "Events & Announcements",
    desc: "Zone institutes, district conferences and club programmes — with announcements delivered as they happen.",
  },
  {
    Icon: MapPin,
    title: "Nearest Club Finder",
    desc: "Travelling? Use your location to find the closest club and make up a meeting anywhere in the zones.",
  },
  {
    Icon: ShieldCheck,
    title: "Secure Member Login",
    desc: "Sign in with your mobile number, validated by your own club — members only, no passwords to remember.",
  },
  {
    Icon: Smartphone,
    title: "Light & Fast",
    desc: "Built for everyday use on Android and iOS — quick to install, easy on data, simple to navigate.",
  },
];

/** From store to signed-in — the numbered ledger under the hero. */
const STEPS = [
  {
    n: "01",
    title: "Install the app",
    desc: "Free on Google Play and the App Store — a light download on any phone.",
  },
  {
    n: "02",
    title: "Verify your number",
    desc: "Sign in with the mobile number your club has on record — no passwords.",
  },
  {
    n: "03",
    title: "Explore the zones",
    desc: "The full directory, events and announcements — with you everywhere.",
  },
];

export function DownloadApp() {
  return (
    <>
      {/* Standard split-serif banner — the shared page-header voice */}
      <PageBanner
        eyebrow="Member Centre"
        subtitle="Carry ROW in your pocket — the directory, events and every club connection, wherever service takes you."
      >
        Download the <span className="text-gold">app</span>
      </PageBanner>

      {/* Bento showcase — kept as a component, now below the banner */}
      <section className="bg-paper py-6 lg:py-8">
        <div className="container-wide">
          <div
            data-animate-stagger="up"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12"
          >
            {/* Headline tile — 7 cols on sky */}
            <div
              data-animate="up"
              className="flex flex-col justify-center rounded-[24px] bg-[#E3EEFA] p-7 sm:col-span-2 sm:p-10 lg:col-span-7 lg:p-14"
            >
              <p className="eyebrow">Member Centre</p>
              {/* h2 — the PageBanner above owns the page's one h1 */}
              <h2 className="mt-5 font-sans text-[clamp(2.1rem,4vw,3.4rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-navy-950">
                Download the <span className="text-azure">app</span>
              </h2>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink/75 sm:text-base">
                Carry ROW in your pocket — the directory,
                events and every club connection, wherever service takes you.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={STORE_LINKS.googlePlay}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary group"
                >
                  <Play className="h-4 w-4" fill="currentColor" aria-hidden />
                  Google Play
                  <ArrowUpRight
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden
                  />
                </a>
                <a
                  href={STORE_LINKS.appStore}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost group"
                >
                  <AppleIcon className="h-4 w-4" aria-hidden />
                  App Store
                  <ArrowUpRight
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden
                  />
                </a>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-2.5">
                <span className="chip figure">Android 5.0+</span>
                <span className="chip figure">iOS 13+</span>
                <span className="chip-gold">Free for members</span>
              </div>
              <p className="microlabel mt-4">
                Login requires a mobile number validated by your club
              </p>
            </div>

            {/* Phone tile — 5 cols; the cut-out mockup floats on a light sky panel */}
            <div
              data-animate="up"
              className="relative flex items-center justify-center overflow-hidden rounded-[24px] bg-[#E3EEFA] p-6 sm:col-span-2 lg:col-span-5 lg:p-8"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60 blur-3xl"
              />
              <Image
                src="/images/download-app-phone.png"
                alt="The ROW app home screen on a phone"
                width={608}
                height={942}
                sizes="(max-width: 1024px) 90vw, 40vw"
                className="relative h-auto w-full max-w-[300px] object-contain [filter:drop-shadow(0_22px_38px_rgba(2,6,23,0.28))]"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Copy + numbered install ledger */}
      <section className="bg-paper py-20 lg:py-28">
        <div className="container-rotary">
          <div className="max-w-2xl">
            <div data-animate="rule" className="rule-gold" />
            <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
              The Official App
            </p>
            <h2
              data-animate="up"
              data-animate-duration="0.7"
              className="mt-4 font-display text-heading font-[450] tracking-tight text-navy-950"
            >
              The whole zone, in your pocket
            </h2>
            <p
              data-animate="up"
              data-animate-duration="0.7"
              data-animate-delay="0.1"
              className="mt-5 text-base leading-relaxed text-ink/70 sm:text-[17px]"
            >
              One tap to every club, every district and every Rotarian across the zones. Look up a member on the way to a meeting, find the
              nearest club in a new city, and never miss an announcement again.
            </p>
          </div>

          {/* From store to signed-in — numbered ledger, LEDGER SWEEP */}
          <div
            data-animate-stagger="left"
            className="mt-16 border-t border-navy-950/[0.10] lg:mt-20"
          >
            {STEPS.map((s) => (
              <div
                key={s.n}
                data-animate="left"
                data-animate-duration="0.35"
                className="ledger-row grid items-baseline gap-x-8 gap-y-1 py-5 sm:grid-cols-[3.5rem_1fr_2fr]"
              >
                <span className="figure text-lg text-gold-deep">{s.n}</span>
                <h3 className="font-display text-lg font-[450] tracking-tight text-navy-950">
                  {s.title}
                </h3>
                <p className="text-[14px] leading-relaxed text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-porcelain py-20 lg:py-28">
        <div className="container-rotary">
          <div className="max-w-2xl">
            <div data-animate="rule" className="rule-gold" />
            <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
              What&apos;s Inside
            </p>
            <h2
              data-animate="up"
              data-animate-duration="0.7"
              className="mt-4 font-display text-heading font-[450] tracking-tight text-navy-950"
            >
              Built for Rotarians on the move
            </h2>
            <p
              data-animate="up"
              data-animate-duration="0.7"
              data-animate-delay="0.1"
              className="mt-4 text-[15px] leading-relaxed text-ink/70 sm:text-base"
            >
              Everything a member reaches for between meetings — searchable, secure and
              a tap away.
            </p>
          </div>

          <div
            data-animate-stagger="up"
            className="mt-12 grid gap-5 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3"
          >
            {FEATURES.map(({ Icon, title, desc }) => (
              <div
                key={title}
                data-animate="up"
                data-animate-duration="0.7"
                className="card p-6 lg:p-7"
              >
                <Icon className="h-5 w-5 text-gold-deep" strokeWidth={1.75} aria-hidden />
                <h3 className="mt-4 font-display text-lg font-[450] tracking-tight text-navy-950">
                  {title}
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
