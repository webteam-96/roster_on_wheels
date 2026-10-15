import type { Metadata } from "next";
import PageFx from "@/components/PageFx";
import Logo from "@/components/Logo";
import { PhoneFrame, Txt } from "@/components/art";
import { DemoButton, Lead, PageHero, Scribble, Section, Stats } from "@/components/kit";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "About Roster On Wheels | Built for Rotarians",
  description:
    "Roster On Wheels began as a digital club roster made by Rotarians, for Rotarians. Today it serves 200,000+ members in 5,000+ clubs across 50+ districts.",
};

/* Hero: the printed roster book turns into the ROW app. The rows on the right-hand page lift off and fly into the
   phone's directory, the loose note with a phone number goes in last, then the book shuts. lib/row-fx.js plays it
   once (data-book-app); this markup is its last frame. Decorative, no text. */
const TILT = -8; // the book's tilt, degrees
const BOOK = [158, 314]; // the open book's centre
const PAGE_ROWS = [-44, -14, 16, 46]; // row centres down a page
const APP_ROWS = [["coral", "Anil Mehta", "President"], ["mint", "Priya Sharma", "Secretary"], ["lilac", "Rahul Desai", "Treasurer"], ["azure", "Sneha Kulkarni", "Member"], ["marigold", "Vikram Joshi", "Member"]] as const;
// the printed roster: left page, then the right page (whose rows fly into the phone)
const LEFT = [["Arjun Nair", "98200 41557"], ["Kavita Rao", "98192 30411"], ["Sanjay Gupta", "98213 77820"], ["Meera Iyer", "98677 15234"]];
const RIGHT = [["Anil Mehta", "98200 11223"], ["Priya Sharma", "98199 40566"], ["Rahul Desai", "98201 77314"], ["Sneha Kulkarni", "98330 21908"]];

/** Where a point on the open book's page lands in the picture: "x y" */
function onBook(lx: number, ly: number) {
  const a = (TILT * Math.PI) / 180;
  return `${(BOOK[0] + lx * Math.cos(a) - ly * Math.sin(a)).toFixed(1)} ${(BOOK[1] + lx * Math.sin(a) + ly * Math.cos(a)).toFixed(1)}`;
}

function BookToApp() {
  return (
    <svg className={s.art} viewBox="0 0 520 480" aria-hidden="true" data-book-app>
      <defs>
        <filter id="book-app-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="16" stdDeviation="13" floodColor="#1B2C42" floodOpacity=".3" />
        </filter>
        <filter id="book-app-lift" x="-20%" y="-60%" width="140%" height="260%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#1B2C42" floodOpacity=".3" />
        </filter>
      </defs>
      <circle className={s.disc} cx="262" cy="244" r="214" />
      <circle className={s.dots} cx="262" cy="244" r="190" />

      {/* The printed roster book. The shut book slides toward the middle (data-book-shift). */}
      <g filter="url(#book-app-shadow)" transform="translate(30 4)" data-book-shift>
        <g transform={`translate(${BOOK.join(" ")}) rotate(${TILT})`}>
          <rect className={s.board} x="-142" y="-96" width="146" height="192" rx="14" />
          <rect className={s.edge} x="-136" y="-88" width="136" height="178" rx="4" />
          <path className={s.page} d="M-2-84C-40-92-96-90-132-84V84C-96 78-40 80-2 88Z" />
          <Txt x={-116} y={-63} t="Club Roster 2025" size={8.5} fill="#17458F" />
          {PAGE_ROWS.map((y, i) => (
            <g key={y}>
              <circle className={s.photo} cx="-112" cy={y} r="8.5" />
              <Txt x={-98} y={y - 1} t={LEFT[i][0]} size={7.5} />
              <Txt x={-98} y={y + 8} t={LEFT[i][1]} size={6.5} weight={500} op={0.6} />
            </g>
          ))}
          {/* a number that changed after the book was printed */}
          <path className={s.pen} d="M-101 22.5-55 20.5M-50 23c2-5 4 2 6-1s4 3 6 0 4 2 6 0" />
          <g data-book-right>
            <rect className={s.board} x="-4" y="-96" width="146" height="192" rx="14" />
            <rect className={s.edge} x="0" y="-88" width="136" height="178" rx="4" />
            <path className={s.page} d="M2-84C40-92 96-90 132-84V84C96 78 40 80 2 88Z" />
            <Txt x={16} y={-63} t="Members" size={8.5} fill="#17458F" />
          </g>
          <path className={s.ribbon} d="M-17 70h10v54l-5-6.5-5 6.5z" />
          <g data-book-cover>
            <rect className={s.board} x="-142" y="-96" width="146" height="192" rx="14" />
            <path className={s.hinge} d="M-12-88V88" />
            <rect className={s.label} x="-114" y="-56" width="88" height="48" rx="9" />
            <Txt x={-70} y={-34} t="Club Roster" size={11} anchor="middle" />
            <Txt x={-70} y={-20} t="2025–26" size={8} anchor="middle" weight={600} op={0.6} />
            <circle className={s.emblem} cx="-70" cy="40" r="15" />
          </g>
        </g>
      </g>

      {/* From the page to the phone */}
      <path className={s.arrow} d="M178 206C186 154 236 136 282 150" data-arrow />
      <path className={s.arrow} d="M272.8 139.4 282 150 268.5 153.6" data-arrow />

      {/* The ROW app: the member directory */}
      <g filter="url(#book-app-shadow)" data-phone>
        <PhoneFrame x={290} y={40} />
        <Txt x={316} y={72} t="9:41" size={9} />
        <path className={s.signal} d="M446 72v-3M451 72v-6M456 72v-9" />
        <Txt x={314} y={105} t="Directory" size={15} />
        <rect className={s.field} x="312" y="116" width="156" height="30" rx="11" />
        <Txt x={324} y={134} t="Search members" size={8.5} weight={500} op={0.5} />
        <path className={s.lens} d="M453.4 133.4 458 138M455 129.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z" />
        {APP_ROWS.map(([c, name, role], i) => {
          const y = 158 + i * 54;
          return (
            <g key={c} data-app-row>
              <rect className={s.row} x="312" y={y} width="156" height="46" rx="13" />
              <circle className={s.avatar} data-c={c} cx="334" cy={y + 23} r="13" data-pop />
              <Txt x={355} y={y + 21} t={name} size={9.5} />
              <Txt x={355} y={y + 33} t={role} size={7.5} weight={500} op={0.6} />
              <g transform={`translate(450 ${y + 23})`}>
                <g data-pop>
                  <circle className={s.call} r="11" />
                  <path className={s.glyph} d="M-1.5-5.7h3a1.8 1.8 0 0 1 1.8 1.8v7.8a1.8 1.8 0 0 1-1.8 1.8h-3a1.8 1.8 0 0 1-1.8-1.8v-7.8a1.8 1.8 0 0 1 1.8-1.8ZM-1.2 3.3h2.4" />
                </g>
              </g>
            </g>
          );
        })}
      </g>
      <g data-tick>
        <circle className={s.tick} cx="486" cy="50" r="18" />
        <path className={s.tickMark} d="M478.5 50.5l5 5 9-10" />
      </g>

      {/* The page rows and the note that fly into the phone: drawn round 0 0, placed and shown by lib/row-fx.js */}
      {PAGE_ROWS.map((y, i) => (
        <g key={y} className={s.flyer} data-strip data-at={`${onBook(67.5, y)} ${TILT}`}>
          <rect className={s.paper} x="-56" y="-13" width="112" height="26" rx="7" />
          <circle className={s.photo} cx="-44" cy="0" r="8.5" />
          <Txt x={-30} y={-1} t={RIGHT[i][0]} size={7.5} />
          <Txt x={-30} y={8} t={RIGHT[i][1]} size={6.5} weight={500} op={0.6} />
        </g>
      ))}
      <g className={s.flyer} data-note data-at="58 234 10">
        <path className={s.note} d="M-22-22h44v30L8 22h-30Z" />
        <path className={s.fold} d="M22 8 8 22V8Z" />
        <path className={s.pen} d="M-14-8c3-4 5 3 8 0s5 3 8 0 5 3 8 0M-14 4c3-4 5 3 8 0s5 3 8 0" />
      </g>
    </svg>
  );
}

/* A person in a round avatar, drawn round 0 0 for a 30-unit circle (the home page's member figure) */
const PERSON = (
  <>
    <circle className={s.personHead} cy="-9.5" r="10.3" />
    <path className={s.personHead} d="M-18.2 17.4c3.5-9.5 10.4-13.6 18.2-13.6s14.7 4.1 18.2 13.6Z" />
  </>
);
const at = (r: number, deg: number, cx: number, cy: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
};

/* The team behind ROW: the team round the ROW logo, twelve gold dots for twelve years, and two cards for what the
   team does (builds the app, supports the clubs). lib/row-fx.js builds it once in view (data-build, data-in = start
   in seconds). Decorative, no text. */
const TEAM = ["azure", "marigold", "mint", "coral", "lilac", "azure"]; // round the orbit from the top

function TeamArt() {
  return (
    <div className={s.team} data-build>
      <svg viewBox="0 0 480 420" aria-hidden="true">
        <circle className={s.teamDisc} cx="240" cy="210" r="150" />
        <circle className={s.orbit} cx="240" cy="210" r="150" />
        <circle className={s.plateShade} cx="240" cy="216" r="80" />
        <circle className={s.plate} cx="240" cy="210" r="80" />
        {Array.from({ length: 12 }, (_, k) => (
          <g key={k} transform={`translate(${at(103, k * 30 - 90, 240, 210)})`}>
            <circle className={s.year} r="5" data-in={(0.2 + k * 0.06).toFixed(2)} />
          </g>
        ))}
        {TEAM.map((c, k) => (
          <g key={k} transform={`translate(${at(150, k * 60 - 90, 240, 210)})`}>
            <g data-c={c} data-in={(0.5 + k * 0.1).toFixed(2)}>
              <circle className={s.member} r="30" />
              {PERSON}
            </g>
          </g>
        ))}
        {/* builds the app */}
        <g transform="translate(362 182)">
          <g data-in="1.2">
            <rect className={s.cardShade} y="5" width="116" height="56" rx="16" />
            <rect className={s.card} width="116" height="56" rx="16" />
            <g data-c="azure">
              <rect className={s.tile} x="12" y="12" width="32" height="32" rx="10" />
              <path className={s.tileIcon} d="M23.5 23 19 28l4.5 5M32.5 23 37 28l-4.5 5M29.8 21l-3.6 14" />
            </g>
            <Txt x={54} y={27} t="Builds" size={10} />
            <Txt x={54} y={40} t="the app" size={8} weight={500} op={0.6} />
          </g>
        </g>
        {/* supports the clubs */}
        <g transform="translate(2 182)">
          <g data-in="1.32">
            <rect className={s.cardShade} y="5" width="116" height="56" rx="16" />
            <rect className={s.card} width="116" height="56" rx="16" />
            <g data-c="marigold">
              <rect className={s.tile} x="12" y="12" width="32" height="32" rx="10" />
              <path className={s.tileIcon} d="M20 30v-3a8 8 0 0 1 16 0v3M18.5 30H23v6h-2.5a2 2 0 0 1-2-2ZM37.5 30H33v6h2.5a2 2 0 0 0 2-2ZM36 36c0 2-1.6 3.5-3.6 3.5h-2.9" />
            </g>
            <Txt x={54} y={27} t="Supports" size={10} />
            <Txt x={54} y={40} t="every club" size={8} weight={500} op={0.6} />
          </g>
        </g>
      </svg>
      <span className={s.teamLogo}><Logo /></span>
    </div>
  );
}

/* What we believe: club work ticked off quickly (a short checklist and a stopwatch) leaves more time for service
   (the heart, with the people it serves). Built once in view like the team picture. Decorative, no text. */
const CHECKS = [[168, "Attendance marked", "mint"], [214, "Dues reminder sent", "marigold"], [260, "Report submitted", "mint"]] as const;
const SERVED = [[338, 278, "coral"], [368, 285, "sky"], [398, 278, "mint"]] as const;

function BelieveArt() {
  return (
    <svg className={s.believe} viewBox="0 0 480 400" aria-hidden="true" data-build>
      <rect className={s.cardShadeDark} x="26" y="102" width="200" height="204" rx="24" />
      <rect className={s.card} x="26" y="94" width="200" height="204" rx="24" />
      <Txt x={50} y={132} t="Club work this week" size={12} />
      {CHECKS.map(([y, w, c], i) => (
        <g key={y}>
          <g transform={`translate(64 ${y})`}>
            <g data-c={c} data-in={(0.35 + i * 0.14).toFixed(2)}>
              <circle className={s.check} r="13" />
              <path className={s.checkMark} d="M-5.5.5l3.6 3.6 7-7.4" />
            </g>
          </g>
          <Txt x={88} y={y + 1} t={w} size={10} />
          <Txt x={88} y={y + 13} t="2 minutes" size={8} weight={500} op={0.55} />
        </g>
      ))}
      <g transform="translate(216 100)">
        <g data-in="0.15">
          <circle className={s.watch} r="30" />
          <path className={s.watchIcon} d="M12 3A12 12 0 1 1-12 3 12 12 0 0 1 12 3ZM-3.5-13.5h7M0-13.5V-9M0 3v-7M9.5-7.5 12-10" />
        </g>
      </g>
      <path className={s.arrow} d="M238 204C252 188 268 188 284 196" data-in-draw="0.85" />
      <path className={s.arrow} d="M278.3 186.6 284 196 273.1 197" data-in-draw="1.15" />
      <circle className={s.halo} cx="368" cy="196" r="100" />
      <circle className={s.plate} cx="368" cy="196" r="74" />
      <g transform="translate(368 199)">
        <g data-in="1.3">
          <path className={s.heart} d="M0 30C-30 10-38-4-38-16c0-12 9-20 20-20 9 0 15 5 18 12 3-7 9-12 18-12 11 0 20 8 20 20 0 12-8 26-38 46Z" />
          <path className={s.shine} d="M-24-18c0-4 3-7 7-7" />
        </g>
      </g>
      {SERVED.map(([x, y, c], i) => (
        <g key={c} transform={`translate(${x} ${y})`}>
          <g data-c={c} data-in={(1.6 + i * 0.1).toFixed(2)}>
            <circle className={`${s.member} ${s.memberSm}`} r="18" />
            <g transform="scale(.6)">{PERSON}</g>
          </g>
        </g>
      ))}
      <path className={s.arrow} d="M411 121.5 419 107.7M433.9 140.7 446.1 130.4M448.8 166.6 463.9 161.1" data-in-draw="1.9" />
    </svg>
  );
}

export default function AboutUs() {
  return (
    <>
      <PageHero
        title={<>Built for Rotarians, by people who <Scribble>know Rotary</Scribble></>}
        intro="Roster On Wheels began with a simple idea: a digital club roster, made for Rotarians by Rotarians. No more printed roster books, no more lost phone numbers."
        visual={<BookToApp />}
      />

      <Section id="where-we-are-today" title="Where we are today" className={`${s.statement} ${s.today}`}>
        <Lead>
          ROW is now a full club management and district management tool, used by more than 200,000 members in over 5,000 clubs across 50+ districts.
        </Lead>
        {/* Sticker values and labels: the meta description's own words, which also name the region. */}
        <Stats
          label="200,000+ members in 5,000+ clubs across 50+ districts"
          items={[
            { value: "200,000+", label: "members" },
            { value: "5,000+", label: "clubs" },
            { value: "50+", label: "districts" },
          ]}
        />
      </Section>

      <Section id="the-team-behind-row" title="The team behind ROW" c="sky" className={s.statement} aside={<TeamArt />}>
        <Lead>
          ROW is built and supported by Kaizen Infotech Solutions Pvt. Ltd., a software company in Thane, India. Our team has worked with Rotary clubs and districts for over twelve years.
        </Lead>
      </Section>

      <Section id="what-we-believe" title="What we believe" c="marigold" className={`${s.statement} ${s.flip}`} aside={<BelieveArt />}>
        <Lead>Rotarians give their time to serve others. Club work should be quick and simple, so more of that time goes to service.</Lead>
        <div className={`hero__ctas ${s.cta}`} data-reveal>
          <DemoButton />
        </div>
      </Section>

      <PageFx />
    </>
  );
}
