import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import PageFx from "@/components/PageFx";
import Logo from "@/components/Logo";
import Arrow from "@/components/Arrow";
import { DemoButton, Scribble, Section, Lead, Stats } from "@/components/kit";
import { PhoneFrame } from "@/components/art";

// Every visible word on this page is from "ROW Website Content V2 Updated.docx", Page 01 (Home), except the three
// demo card lines the client supplied separately (AGENDA) and the made-up member names on the wheel (SEATS).

export const metadata: Metadata = {
  title: "Roster On Wheels | Rotary Club and District Management Tool",
  description:
    "Roster On Wheels (ROW) is a simple club and district management tool for Rotary: member app, club website, dues and events. USD 10 per member a year.",
};

// Club dots around the district in the District teams picture
const HUB_NODES = [[72, 50], [248, 50], [50, 124], [270, 124], [112, 172], [208, 172]];

// Each doc line starts with its audience: shown as the card title, the rest of the sentence below it.
const AUDIENCES: { who: string; rest: string; c: string; art: ReactNode }[] = [
  {
    who: "Members",
    rest: "update their own profile, find clubs and fellow Rotarians, and explore projects from other clubs",
    c: "sky",
    art: (
      <svg viewBox="0 0 320 200">
        <g transform="translate(110 30) scale(.5)"><PhoneFrame x={0} y={0} screen="#fff" /></g>
        <circle cx="160" cy="78" r="19" fill="#F7A81B" />
        <circle cx="160" cy="72" r="6.5" fill="#fff" />
        <path d="M148.5 89c2.2-6 6.6-8.6 11.5-8.6s9.3 2.6 11.5 8.6" fill="#fff" />
        <text x="160" y="115" fill="#1B2C42" fontSize="9" fontWeight="700" fontFamily="var(--font-display)" textAnchor="middle">Anil Mehta</text>
        <text x="160" y="127" fill="#1B2C42" fillOpacity=".6" fontSize="7" fontWeight="500" fontFamily="var(--font-display)" textAnchor="middle">Treasurer</text>
        <rect x="130" y="142" width="60" height="22" rx="11" fill="#EDF4FB" />
        <circle cx="143" cy="152.5" r="4.5" fill="none" stroke="#17458F" strokeWidth="2.2" />
        <path d="M146.4 156l3.2 3.2" stroke="#17458F" strokeWidth="2.2" strokeLinecap="round" />
        <text x="155" y="155.5" fill="#1B2C42" fillOpacity=".55" fontSize="7" fontWeight="600" fontFamily="var(--font-display)">Find</text>
        <g transform="translate(28 58)">
          <rect y="4" width="76" height="46" rx="13" fill="#1B2C42" opacity=".1" />
          <rect width="76" height="46" rx="13" fill="#fff" />
          <circle cx="22" cy="23" r="11" fill="#17458F" />
          <circle cx="22" cy="23" r="4.8" fill="none" stroke="#F7A81B" strokeWidth="2.6" />
          <text x="40" y="21" fill="#1B2C42" fontSize="7.5" fontWeight="700" fontFamily="var(--font-display)">My club</text>
          <text x="40" y="31" fill="#1B2C42" fillOpacity=".6" fontSize="6" fontWeight="500" fontFamily="var(--font-display)">Thane Hills</text>
        </g>
        <g transform="translate(214 104)">
          <rect y="4" width="78" height="46" rx="13" fill="#1B2C42" opacity=".1" />
          <rect width="78" height="46" rx="13" fill="#fff" />
          <rect x="11" y="11" width="24" height="24" rx="8" fill="#0067C8" />
          <path d="M17.5 23.5l3.6 3.6 7-7.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <text x="44" y="21" fill="#1B2C42" fontSize="7.5" fontWeight="700" fontFamily="var(--font-display)">Saved</text>
          <text x="44" y="31" fill="#1B2C42" fillOpacity=".6" fontSize="6" fontWeight="500" fontFamily="var(--font-display)">Profile</text>
        </g>
      </svg>
    ),
  },
  {
    who: "Club officers",
    rest: "keep club records, collect dues, keep members updated and submit monthly reports to the district",
    c: "lilac",
    art: (
      <svg viewBox="0 0 320 200">
        <g transform="translate(110 30) scale(.5)"><PhoneFrame x={0} y={0} screen="#fff" /></g>
        {[["Monthly report", "Sent to district"], ["Dues collected", "28 of 30"], ["Attendance", "32 present"]].map(([a, b], i) => (
          <g key={i} transform={`translate(0 ${i * 38})`}>
            <circle cx="125" cy="78" r="8" fill={i === 1 ? "#F7A81B" : "#17458F"} />
            <path d="M121.4 78.2l2.6 2.6 4.8-5.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="138" y="77" fill="#1B2C42" fontSize="7.5" fontWeight="700" fontFamily="var(--font-display)">{a}</text>
            <text x="138" y="87.5" fill="#1B2C42" fillOpacity=".6" fontSize="6" fontWeight="500" fontFamily="var(--font-display)">{b}</text>
          </g>
        ))}
        <circle cx="232" cy="160" r="25" fill="#F7A81B" stroke="#fff" strokeWidth="6" />
        <circle cx="232" cy="160" r="11.5" fill="none" stroke="#fff" strokeWidth="3" opacity=".85" />
        <path d="M236 44l40-16-14 38-7-14z" fill="#fff" stroke="#1B2C42" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M255 52l21-24" stroke="#1B2C42" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M228 60c-12 8-22 10-34 8" fill="none" stroke="#1B2C42" strokeWidth="2.2" strokeDasharray="2 6" strokeLinecap="round" opacity=".5" />
      </svg>
    ),
  },
  {
    who: "District teams",
    rest: "review every club's monthly report, run district projects and events, and collect district dues from clubs",
    c: "azure",
    art: (
      <svg viewBox="0 0 320 200">
        {HUB_NODES.map(([x, y], i) => (
          <path key={i} d={`M160 102L${x} ${y}`} stroke="#fff" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" opacity=".6" />
        ))}
        {HUB_NODES.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="15" fill="#17458F" stroke="#fff" strokeWidth="3" />
            <circle cx={x} cy={y} r="5.5" fill={i % 3 === 1 ? "#F7A81B" : "#fff"} />
          </g>
        ))}
        <circle cx="160" cy="102" r="44" fill="#fff" opacity=".12" />
        <circle cx="160" cy="102" r="31" fill="#fff" />
        <circle cx="160" cy="102" r="13.5" fill="none" stroke="#F7A81B" strokeWidth="6.5" />
      </svg>
    ),
  },
];

/** "Anil Mehta" -> "AM", "RC Thane Hills" -> "TH": first and last word, the club prefix left out */
const initials = (name: string) => {
  const w = name.replace(/^RC /, "").split(" ");
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
};

// Made-up members for the hero wheel and phone (the client asked for random names, not a real club's members)
const SEATS = [
  "Anil Mehta", "Priya Sharma", "Rahul Desai", "Sneha Kulkarni", "Vikram Joshi", "Neha Patil", "Arjun Nair", "Kavita Rao",
  "Sanjay Gupta", "Meera Iyer", "Rohan Shah", "Pooja Menon", "Amit Verma", "Anjali Deshpande", "Suresh Pillai", "Divya Kapoor",
];

// Hero wheel seats: [colour, email, WhatsApp]
const WHEEL: [string, string, string][] = [
  ["coral", "shared", "hidden"], ["sky", "shared", "shared"], ["ink", "hidden", "shared"], ["mint", "shared", "shared"],
  ["lilac", "shared", "hidden"], ["azure", "hidden", "hidden"], ["cream", "shared", "shared"], ["coral", "shared", "hidden"],
  ["mint", "shared", "hidden"], ["sky", "hidden", "shared"], ["lilac", "shared", "shared"], ["ink", "shared", "hidden"],
  ["coral", "shared", "hidden"], ["azure", "hidden", "shared"], ["mint", "shared", "hidden"], ["lilac", "shared", "shared"],
];

const CLUB = [
  "Directory, Board of Directors and past presidents",
  "Meetings, attendance and Avenues of Service projects",
  "Events, announcements and newsletters through the app and WhatsApp",
  "Club dues collection, monthly reports and your club website",
];

const DISTRICT = [
  "District directory and District Committee",
  "Club monthly reports and district citation",
  "District projects, events and announcements",
  "District dues collection and your district website",
];

// The club console sketch: one row per CLUB line, same order (directory, meetings, messages, dues)
const CONSOLE_ROWS: { c: string; label: string; icon: ReactNode }[] = [
  { c: "sky", label: "Directory", icon: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15.5 6.4a3 3 0 0 1 0 5.6M17.6 14.6c1.6.6 2.6 2.1 2.9 4.4" /></> },
  { c: "lilac", label: "Meetings", icon: <><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></> },
  { c: "coral", label: "Announcements", icon: <><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M17 9.5a3.5 3.5 0 0 1 0 5" /></> },
  { c: "mint", label: "Club dues", icon: <><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" /><path d="M9 8.5h6M9 12h6" /></> },
];

// What the yearly fee includes (from the price paragraph), with an icon each
const INCLUDED: [string, ReactNode][] = [
  ["ROW Mobile App", <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>],
  ["Integrated Club Website", <><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" /></>],
  ["Club Dues Collection Tool", <><rect x="3.5" y="6.5" width="17" height="12.5" rx="2.5" /><path d="M3.5 10.5h17M7 15h3" /></>],
  ["Events Module", <><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>],
];

const PRICE_C = ["azure", "mint", "marigold", "sky"];

// What the free demo covers: lines the client supplied for this card (not in the content doc), each with an icon
const AGENDA: [string, string, ReactNode][] = [
  ["See your club in ROW", "azure", <><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M8 20.5h8M12 16.5v4M10.5 8.3v4.4l3.8-2.2z" /></>],
  ["Try the member app", "marigold", <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>],
  ["Ask us anything", "mint", <><path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" /><path d="M10 9.2a2 2 0 1 1 2.7 1.9c-.4.2-.7.6-.7 1.1M12 14h.01" /></>],
];

const LANGS = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Japanese", "Korean"];
// a person in each chat avatar (the home page's member figure)
const PERSON = (
  <svg viewBox="-19 -19 38 38" aria-hidden="true">
    <circle cy="-6" r="6.5" />
    <path d="M-11.5 11c2.2-6 6.6-8.6 11.5-8.6s9.3 2.6 11.5 8.6Z" />
  </svg>
);
const BUBBLE_C = ["coral", "marigold", "lilac", "mint"];

const ROW_MARK = (
  <svg viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="9.5" fill="none" stroke="#F7A81B" strokeWidth="4.5" />
  </svg>
);

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

const ARROWS_BOTH = (
  <svg className="sync__dir" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h15M15 4.5l4 4-4 4M20 15.5H5M9 11.5l-4 4 4 4" /></svg>
);

// District hub: District 3142 clubs [fan offset, colour, club]
const HUB_CLUBS: [string, string, string][] = [
  ["0", "coral", "RC Thane Hills"], [".55", "sky", "RC Ambarnath East"], [".86", "lilac", "RC Hiranandani Estate"], ["1", "mint", "RC Dombivli East"],
  ["1", "lilac", "RC Kalyan Riverside"], [".86", "coral", "RC Navi Mumbai Sunrise"], [".55", "mint", "RC Thane Downtown"], ["0", "sky", "RC Thane Uptown"],
];

// What comes in from My Rotary ("Your members, board and club details come in from My Rotary.")
const SYNC_ROWS: [string, string][] = [["members", "Members"], ["board", "Board"], ["club", "Club details"]];

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="ticks" data-reveal>
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}

/** The doc's "Read more →" button; the section heading tells screen readers where it goes. */
function ReadMore({ href, by }: { href: string; by: string }) {
  return (
    <div data-reveal>
      <span className="magnet" data-magnet>
        <Link className="btn btn--primary btn--lg" href={href} aria-describedby={by}>
          Read more
          <Arrow />
        </Link>
      </span>
    </div>
  );
}

export default function Home() {
  const [leadEmail, leadWa] = WHEEL[0].slice(1);
  return (
    <>
{/* ============ 1. HERO ============ */}
<section className="hero" id="top" aria-labelledby="hero-title">
  <div className="hero__inner container">
    <div className="hero__copy">
      <h1 className="hero__title" id="hero-title">
        The <Scribble>simple</Scribble> way to run your Rotary club and district
      </h1>
      <p className="hero__intro" data-intro>Roster On Wheels (ROW) is a club management and district management tool built only for Rotary. Members get a mobile app with the club roster, events and news. Club and district leaders get one easy place for members, meetings, projects, dues, reports and their website.</p>
      <p className="hero__intro" data-intro>No more printed rosters, scattered spreadsheets or chasing people for updates. Everything your club needs is in one place, and it is simple enough for every Rotarian to use.</p>
      <div className="hero__ctas" data-intro>
        <DemoButton />
      </div>
    </div>
    <div className="hero__visual" data-hero-visual>
      {/* Phone: the ROW member app directory, showing whoever sits under the marker (the slider's value text carries the same state) */}
      <div className="phone" data-intro aria-hidden="true">
        <div className="phone__screen">
          <div className="phone__status">
            <span className="phone__time" />
            <span className="phone__island" />
            <span className="phone__sig">
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="phone__bar">
            <span className="phone__app">Directory</span>
          </div>
          <div className="field">
            <span className="field__input">
              <span className="sample__meta">Search members</span>
            </span>
            {" "}
            <svg className="field__icon" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
          </div>
          <div className="profile" data-profile>
            <span className="profile__avatar" data-c="coral" data-p-avatar data-sample>{initials(SEATS[0])}</span>
            <span className="profile__name is-text" data-p-name data-sample>{SEATS[0]}</span>
            <div className="profile__actions">
              <span className="pbtn" data-state="shared" data-p-act-email>Email</span>
              {" "}
              <span className="pbtn" data-state="hidden" data-p-act-wa>WhatsApp</span>
            </div>
          </div>
          <div className="phone__tabs"><i /><i /><i /><i /></div>
        </div>
      </div>
      <p className="vh" aria-live="polite" data-wheel-status />
      <div className="wheel-arc">
        <div className="wheel-stage">
          <div className="wheel" id="roster-wheel" tabIndex={0} role="slider" aria-label="Spin the roster" aria-valuemin={1} aria-valuemax={16} aria-valuenow={1} aria-valuetext={`${SEATS[0]}. Email ${leadEmail}, WhatsApp ${leadWa}.`} data-wheel>
            {WHEEL.map(([c, email, wa], i) => {
              const name = SEATS[i];
              return (
                <span key={i} className="wheel__avatar" style={{ "--i": String(i) } as CSSProperties} data-c={c} data-email={email} data-wa={wa} data-name={name} data-initials={initials(name)}>
                  <span className="wheel__face" data-sample>{initials(name)}</span>
                </span>
              );
            })}
          </div>
          <div className="wheel-hub" aria-hidden="true"><Logo /></div>
          <div className="wheel-marker" aria-hidden="true">
            <span className="wheel-marker__pin" data-marker-pin>
              <svg viewBox="0 0 44 44">
                <path d="M38 22c0-7-5-13-12-14L6 22l20 14c7-1 12-7 12-14z" />
                <circle cx="26" cy="22" r="4.5" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

{/* ============ 2. NUMBERS ============ */}
<Stats items={[{ value: "50+", label: "Districts" }, { value: "5,000+", label: "Clubs" }, { value: "200,000+", label: "Members" }]} />

{/* ============ 3. ONE APP ============ */}
<Section id="one-app" title="One app for members, clubs and districts">
  <ul className="aud">
    {AUDIENCES.map((a) => (
      <li key={a.who} className="aud__card" data-reveal>
        <div className="aud__art" data-c={a.c} aria-hidden="true">{a.art}</div>
        <h3 className="aud__t">{a.who}</h3>
        <p className="aud__b">{a.rest}</p>
      </li>
    ))}
  </ul>
</Section>

{/* ============ 4. CLUB MANAGEMENT ============ */}
<Section
  id="club-management"
  c="sky"
  title="Club Management"
  aside={
    <div className="console" aria-hidden="true">
      <div className="console__bar">
        {ROW_MARK}
        <span className="console__club" data-sample>Rotary Club of Thane Hills</span>
      </div>
      <ul className="console__rows">
        {CONSOLE_ROWS.map((r) => (
          <li key={r.label} className="console__row" data-c={r.c}>
            <span className="console__icon"><svg viewBox="0 0 24 24">{r.icon}</svg></span>
            <span className="console__lines"><span className="console__title">{r.label}</span></span>
            <span className="console__tick">{CHECK}</span>
          </li>
        ))}
      </ul>
    </div>
  }
>
  <Lead>Run your whole club from one place. Keep the member list and Board of Directors up to date, record meetings, attendance and service projects, collect dues with automatic receipts, and send the monthly report to the district in minutes.</Lead>
  <Ticks items={CLUB} />
  <ReadMore href="/club-management" by="club-management-title" />
</Section>

{/* ============ 5. DISTRICT MANAGEMENT ============ */}
<section className="districts" id="district-management" aria-labelledby="district-management-title">
  <div className="container districts__grid districts__grid--flip">
    <div className="districts__copy">
      <h2 className="h2" id="district-management-title" data-split>District Management</h2>
      <p className="lead-p" data-reveal>See and support every club in your district from one screen. Review club monthly reports, assign Assistant Governors, run district projects and events, and collect district dues from clubs.</p>
      <Ticks items={DISTRICT} />
      <ReadMore href="/district-management" by="district-management-title" />
    </div>
    <div className="hub" aria-hidden="true" data-hub>
      <svg className="hub__threads" data-hub-svg />
      <div className="hub__core hub__core--logo" data-hub-core>
        <Logo />
      </div>
      <ul className="hub__clubs">
        {HUB_CLUBS.map(([x, c, club]) => (
          <li key={club} className="club" style={{ "--x": x } as CSSProperties} data-c={c}>
            <span className="club__dot" data-sample>{initials(club)}</span>
            <span className="club__text">
              <span className="club__name" data-sample>{club}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  </div>
</section>

{/* ============ 6. CONNECTED TO MY ROTARY ============ */}
<section className="what panel" id="my-rotary" aria-labelledby="my-rotary-title">
  <div className="container what__grid">
    <div className="what__copy">
      <h2 className="h2" id="my-rotary-title" data-split>Connected to My Rotary</h2>
      <p className="lead-p" data-reveal>Your member list comes straight from My Rotary, so nobody types it in twice.</p>
    </div>
    <div className="sync" data-sync data-reveal>
      <div className="sync__stage" aria-hidden="true" data-sync-stage>
        <svg className="sync__arcs" data-sync-svg>
          <defs>
            <marker id="sync-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M1.5 1.5 7 5l-5.5 3.5" />
            </marker>
          </defs>
          <path className="sync__arc" data-arc="in" markerEnd="url(#sync-head)" />
          <path className="sync__arc" data-arc="out" markerEnd="url(#sync-head)" />
        </svg>
        <div className="sync-card" data-card="ri">
          <div className="sync-card__head">
            <span className="sync-card__icon">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
              </svg>
            </span>
            <span className="sync-card__title">My Rotary</span>
          </div>
          <ul className="sync-card__rows">
            {SYNC_ROWS.map(([k, label]) => (
              <li key={k} data-row={k}><span>{label}</span><span className="sync-card__state">{CHECK}</span></li>
            ))}
          </ul>
        </div>
        <p className="sync__label"><span>{ARROWS_BOTH}</span></p>
        <div className="sync-card sync-card--row" data-card="row">
          <div className="sync-card__head">
            <span className="sync-card__icon sync-card__icon--row">{ROW_MARK}</span>
            <span className="sync-card__title">ROW</span>
          </div>
          <ul className="sync-card__rows">
            {SYNC_ROWS.map(([k, label]) => (
              <li key={k} data-row={k}><span>{label}</span><span className="sync-card__state">{CHECK}</span></li>
            ))}
          </ul>
        </div>
        <div className="postcard" data-postcard="in">
          <span className="postcard__stamp" />
          <span className="postcard__type" data-pc-type>Members</span>
          <span className="postcard__text" />
        </div>
        <div className="postcard postcard--out" data-postcard="out">
          <span className="postcard__stamp" />
          <span className="postcard__type" data-pc-type>Board</span>
          <span className="postcard__text" />
        </div>
      </div>
    </div>
  </div>
</section>

{/* ============ 7. LANGUAGES ============ */}
<section className="langs panel" id="languages" aria-labelledby="languages-title">
  <div className="container langs__grid">
    <div className="langs__copy">
      <h2 className="h2" id="languages-title" data-split>In 8 languages</h2>
      <p className="lead-p" data-reveal>English, Spanish, French, German, Italian, Portuguese, Japanese and Korean.</p>
    </div>
    <div className="chat" data-chat>
      <ul className="chat__list" aria-hidden="true">
        {LANGS.map((l, i) => (
          <li key={l} className={`bubble${i % 2 ? " bubble--r" : ""}`} data-c={BUBBLE_C[i % 4]}>
            <span className="bubble__who">{PERSON}</span>
            <span className="bubble__body">
              <span className="bubble__text">{l}</span>
              <span className="bubble__dots"><i /><i /><i /></span>
            </span>
          </li>
        ))}
      </ul>
      <button className="motion-toggle" type="button" data-motion-toggle aria-label="Pause the animation">
        <svg className="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12" /></svg>
        <svg className="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
      </button>
    </div>
  </div>
</section>

{/* ============ 8. PRICE ============ */}
<section className="pband" id="price" aria-labelledby="price-title">
  <div className="container">
    <div className="pband__head">
      <h2 className="h2" id="price-title" data-split>USD 10 per member, per year, <Scribble>for everything</Scribble></h2>
      <p className="lead-p" data-reveal>One simple yearly fee gives your club the ROW Mobile App, an Integrated Club Website, the Club Dues Collection Tool and the Events Module. A club of 30 members pays USD 300 a year.</p>
    </div>
    {/* A price tag on a string, beside what the fee includes (both repeat the paragraph above, so hidden from screen readers) */}
    <div className="pdeal" data-reveal aria-hidden="true">
      <div className="ptag">
        <svg viewBox="0 0 400 244">
          <path className="ptag__body" d="M92 10H370q22 0 22 22V212q0 22-22 22H92q-12 0-21-8L14 138q-8-16 0-32L71 18q9-8 21-8Z" />
          <circle className="ptag__hole" cx="56" cy="122" r="11" />
          <path className="ptag__string" d="M56 122C30 102 10 60 30 6" />
          <text className="ptag__cur" x="124" y="100">USD</text>
          <text className="ptag__num" x="202" y="172">10</text>
          <text className="ptag__per" x="124" y="212">per member, per year</text>
        </svg>
      </div>
      <ul className="pdeal__items">
        {INCLUDED.map(([t, icon], i) => (
          <li key={t} data-c={PRICE_C[i]}><span className="pdeal__icon"><svg viewBox="0 0 24 24">{icon}</svg></span>{t}</li>
        ))}
      </ul>
    </div>
  </div>
</section>

{/* ============ 9. DEMO ============ */}
<section className="demo panel" id="demo" aria-labelledby="demo-title">
  <div className="container demo__grid">
    <div className="demo__copy">
      <h2 className="demo__title" id="demo-title" data-split>
        See ROW for <Scribble kind="circle">yourself</Scribble>
      </h2>
      <p className="lead-p" data-reveal>Book a free demo and we will show you ROW working for a club like yours.</p>
      <div className="demo__ctas" data-reveal>
        <DemoButton />
      </div>
    </div>
    <div className="agenda" data-reveal="fade">
      <div className="agenda__logo" aria-hidden="true"><Logo /></div>
      <ol className="agenda__list">
        {AGENDA.map(([t, c, icon]) => (
          <li key={t}>
            <span className="agenda__n" data-c={c} aria-hidden="true"><svg viewBox="0 0 24 24">{icon}</svg></span>
            {t}
          </li>
        ))}
      </ol>
    </div>
  </div>
</section>
      <PageFx />
    </>
  );
}

