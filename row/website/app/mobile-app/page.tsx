import type { Metadata } from "next";
import PageFx from "@/components/PageFx";
import Logo from "@/components/Logo";
import { ArtCards, Lead, PageHero, Scribble, Section } from "@/components/kit";
import { Avatar, C, Card, Club, ICON, IconTile, Lines, PhoneFrame, Tick, Txt } from "@/components/art";
import { APP_STORE, GOOGLE_PLAY } from "@/lib/site";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "ROW Mobile App for Rotarians | Club Roster on Your Phone",
  description:
    "The ROW app puts your Rotary club on your phone. Find a Rotarian, find a club, see events and projects, and update your profile. Android and iPhone.",
};

// Every visible word below is verbatim from the V2 content doc's Mobile App page, including the words inside the mock-ups.

const TICK = "M5 12.5l4.5 4.5L19 7.5";

/* Hero: Find a Rotarian on a Royal Blue wheel. The search filters are the doc's own words (name, classification,
   keyword) and the results arrive one by one (data-build, lib/row-fx.js). */
const FILTERS = ["name", "classification", "keyword"];
const RESULTS = [["coral", "Anil Mehta", "Architect"], ["sky", "Priya Sharma", "Doctor"], ["mint", "Rahul Desai", "Lawyer"], ["lilac", "Sneha Kulkarni", "Teacher"]];
const directory = (
  <div className={s.stage}>
    <div className={`phone ${s.app}`} aria-hidden="true" data-build>
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
          <span className="phone__app">Find a Rotarian</span>
        </div>
        <div className="field">
          <span className="field__input">
            <span className="sample__meta">Search by name, classification or keyword</span>
          </span>
          <svg className="field__icon" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
        </div>
        <ul className={s.filters}>
          {FILTERS.map((f, i) => (
            <li key={f} className={i === 0 ? s.on : undefined} data-in={(0.2 + i * 0.1).toFixed(2)}>{f}</li>
          ))}
        </ul>
        <ul className={s.results}>
          {RESULTS.map(([c, name, job], i) => (
            <li key={c} data-in={(0.55 + i * 0.14).toFixed(2)} data-in-move="0 16">
              <span className="mono" data-c={c}>{name.split(" ").map((w) => w[0]).join("")}</span>
              <span className={s.who}>
                <span className="sample__name">{name}</span>
                <span className="sample__meta">{job}</span>
              </span>
              <span className={s.call}><svg className="ico" viewBox="0 0 24 24">{ICON.phone}</svg></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);

/* ---------- Member features: card pictures (text-free, the home page's card style) ---------- */

// Profile Management: your own profile, the pencil to edit it, saved
const profileArt = (
  <svg viewBox="0 0 320 200">
    <Card x={92} y={22} w={136} h={182} r={18}>
      <Avatar x={68} y={42} r={22} />
      <g transform="translate(88 60)">
        <circle r="11" fill={C.mint} stroke="#fff" strokeWidth="3" />
        <g transform="translate(-6.5 -6.5) scale(.54)" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{ICON.pencil}</g>
      </g>
      <Txt x={68} y={83} t="Neha Patil" size={10} anchor="middle" />
      <Txt x={68} y={95} t="Chartered Accountant" size={7} anchor="middle" weight={500} op={0.6} />
      {[[106, "neha@example.com"], [130, "+91 98201 55123"]].map(([y, t]) => (
        <g key={String(y)}>
          <rect x="16" y={Number(y)} width="104" height="18" rx="7" fill={C.cream2} />
          <Txt x={24} y={Number(y) + 12} t={String(t)} size={7.5} weight={500} op={0.7} />
        </g>
      ))}
      <rect x="16" y="154" width="104" height="20" rx="10" fill={C.azure} />
    </Card>
    <Card x={236} y={60} w={62} h={38}>
      <Tick x={19} y={19} r={9} fill={C.mint} />
      <Txt x={32} y={22} t="Saved" size={8} />
    </Card>
  </svg>
);

// Club Finder: clubs on a map, a search, and the club found with a button to connect
const finderArt = (
  <svg viewBox="0 0 320 200">
    <path d="M-10 146C60 122 92 164 162 138s108-30 168-6M72-10c12 60-22 112 8 220M226-10c-22 52 30 122 0 220" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" opacity=".5" />
    {[[86, 100, false], [168, 84, true], [246, 112, false]].map(([x, y, on]) => (
      <g key={String(x)} transform={`translate(${x} ${y})`}>
        <path d="M0 24S-17 7-17-4a17 17 0 0 1 34 0C17 7 0 24 0 24Z" fill={on ? C.marigold : "#fff"} />
        <Club x={0} y={-4} r={9} />
      </g>
    ))}
    <Card x={60} y={20} w={200} h={36} r={18}>
      <g transform="translate(14 8) scale(.84)" fill="none" stroke={C.ink} strokeOpacity=".6" strokeWidth="2.4" strokeLinecap="round">{ICON.search}</g>
      <Txt x={42} y={21} t="Clubs near Thane" size={9} weight={500} op={0.6} />
    </Card>
    <Card x={146} y={140} w={156} h={46}>
      <Club x={24} y={23} r={12} />
      <Lines x={44} y={14} w={58} t="RC Thane Hills" t2="2.1 km away" size={9} />
      <g transform="translate(132 23)">
        <circle r="12" fill={C.mint} />
        <g transform="translate(-7 -7) scale(.58)" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{ICON.arrow}</g>
      </g>
    </Card>
  </svg>
);

// Find a Rotarian: the magnifier finds one Rotarian among many
const findArt = (
  <svg viewBox="0 0 320 200">
    <Avatar x={62} y={72} r={20} fill={C.sky} glyph={C.ink} ring="#fff" />
    <Avatar x={92} y={146} r={18} fill={C.lilac} glyph={C.ink} ring="#fff" />
    <Avatar x={258} y={66} r={18} fill={C.sky} glyph={C.ink} ring="#fff" />
    <Avatar x={240} y={148} r={20} fill={C.lilac} glyph={C.ink} ring="#fff" />
    <circle cx="160" cy="92" r="52" fill="#fff" stroke={C.ink} strokeWidth="7" />
    <Avatar x={160} y={92} r={33} fill={C.azure} />
    <path d="M198 130l26 26" stroke={C.ink} strokeWidth="13" strokeLinecap="round" />
    <Tick x={200} y={54} r={13} fill={C.mint} />
  </svg>
);

// Search Projects: other clubs' projects, each with a way to take part
const projectsArt = (
  <svg viewBox="0 0 320 200">
    {[[44, 40, -5, ICON.heart, "Blood camp", "RC Kalyan"], [180, 32, 5, ICON.plus, "Clean water", "RC Thane Uptown"]].map(([x, y, rot, icon, t, t2], i) => (
      <g key={i} transform={`rotate(${rot} ${Number(x) + 48} ${Number(y) + 64})`}>
        <Card x={Number(x)} y={Number(y)} w={96} h={128} r={14}>
          <rect x="8" y="8" width="80" height="52" rx="9" fill={C.sky} />
          <path d="M14 56 34 34 48 48 60 38 82 56Z" fill={C.azure} opacity=".5" />
          <circle cx="68" cy="22" r="6" fill={C.marigold} />
          <Lines x={10} y={72} w={62} t={String(t)} t2={String(t2)} size={9} />
          <g transform="translate(74 106)">
            <circle r="13" fill={C.marigold} />
            <g transform="translate(-7.5 -7.5) scale(.62)" fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{icon}</g>
          </g>
        </Card>
      </g>
    ))}
    <circle cx="158" cy="152" r="22" fill="#fff" stroke={C.ink} strokeWidth="6" />
    <path d="M174 168l16 16" stroke={C.ink} strokeWidth="9" strokeLinecap="round" />
  </svg>
);

/* Your club on your phone: each line's icon, and the same six on the app’s home screen (data-build) */
const LINES = [
  ["The club directory, with one tap to call, message or email a member", "azure", ICON.people],
  ["Upcoming meetings and events", "marigold", ICON.calendar],
  ["Announcements and newsletters", "mint", ICON.megaphone],
  ["Birthday and anniversary greetings", "coral", ICON.gift],
  ["Dues payment", "lilac", ICON.receipt],
  ["Event registration", "sky", ICON.clipboard],
] as const;
const TILE_AT = [[72, 108, 74], [154, 108, 74], [72, 188, 74], [154, 188, 74], [72, 268, 74], [154, 268, 74]]; // x, y, width
const ON_C: Record<string, string> = { azure: C.white, mint: C.white };
const homeArt = (
  <svg className={s.home} viewBox="0 0 300 420" aria-hidden="true" data-build>
    <circle cx="150" cy="210" r="150" fill="#fff" opacity=".45" />
    <PhoneFrame x={50} y={10} />
    <Avatar x={88} y={74} r={16} fill={C.coral} glyph={C.ink} />
    <Lines x={112} y={66} w={60} t="Hello, Anil" t2="RC Thane Hills" size={10} />
    <Club x={212} y={74} r={12} />
    {LINES.map(([, c, icon], i) => {
      const label = ["Directory", "Meetings", "News", "Greetings", "Dues", "Register"][i];
      const [x, y, w] = TILE_AT[i];
      return (
        <g key={c} data-in={(0.25 + i * 0.14).toFixed(2)}>
          <rect x={x} y={y + 3} width={w} height="74" rx="18" fill={C.ink} opacity=".08" />
          <rect x={x} y={y} width={w} height="74" rx="18" fill="#fff" />
          <IconTile x={x + 12} y={y + 12} size={30} fill={C[c]} stroke={ON_C[c] ?? C.ink}>{icon}</IconTile>
          <Txt x={x + 12} y={y + 62} t={label} size={10} />
          {w > 100 ? <Lines x={x + 54} y={y + 16} w={60} t="42 members" t2="Call or message" size={9} /> : null}
        </g>
      );
    })}
    <path d="M57.5 352h185v25a25.5 25.5 0 0 1-25.5 25.5H83a25.5 25.5 0 0 1-25.5-25.5Z" fill="#fff" />
    {[100, 133, 167, 200].map((x, i) => <circle key={x} cx={x} cy="377" r="6" fill={i ? "#D5DEE8" : C.azure} />)}
  </svg>
);

/* Simple for every age: three big, plain menu rows. Text-free. */
const MENU = [
  { c: "azure", w: "My profile", icon: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5a7 7 0 0 1 14 0" /></> },
  { c: "marigold", w: "Find a Rotarian", icon: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></> },
  { c: "mint", w: "Events", icon: <><rect x="4" y="5.5" width="16" height="14" rx="3" /><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4" /></> },
];
const menu = (
  <div className={s.menu}>
    {MENU.map(({ c, w, icon }) => (
      <span key={c} className={s.menuRow}>
        <span className={s.menuIcon} data-c={c}>
          <svg className="ico" viewBox="0 0 24 24">{icon}</svg>
        </span>
        <span className="sample__name">{w}</span>
        <svg className={s.chev} viewBox="0 0 24 24">
          <path d="M9.5 6l6 6-6 6" />
        </svg>
      </span>
    ))}
  </div>
);

/* No password to remember: an address in, a one-time code typed, you are in. Text-free. */
const code = (
  <div className={s.otpCard}>
    <span className={s.otpField}>
      <svg className="ico" viewBox="0 0 24 24">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
        <path d="M4.5 7l7.5 6 7.5-6" />
      </svg>
      <span className="sample__meta">neha@example.com</span>
    </span>
    <span className={s.otp}>
      {["4", "8", "2", "7", "1", "9"].map((d, i) => <i key={i}>{d}</i>)}
    </span>
    <span className={s.ok}>
      <svg className="ico" viewBox="0 0 24 24"><path d={TICK} /></svg>
    </span>
  </div>
);

/* Your details stay private: the home page's directory card. lib/row-fx.js flips its switch (data-tile="dir" on the panel). */
const privacy = (
  <div className={`mini-card ${s.dir}`}>
    <div className="mini-card__head">
      <span className="mono" data-c="lilac">NP</span>
      <span className="mini-card__who">
        <span className="sample__name">Neha Patil</span>
        <span className="sample__meta">RC Thane Downtown</span>
      </span>
    </div>
    <div className="mini-row">
      <span>email</span>
      <span className="mini-row__v">
        <svg className="ico" viewBox="0 0 24 24"><path d={TICK} /></svg>
      </span>
    </div>
    <div className="mini-row">
      <span>phone number</span>
      <span className="mini-row__v demo-dir__phone">
        <span className="demo-dir__on" data-d="on">
          <svg className="ico" viewBox="0 0 24 24"><path d={TICK} /></svg>
        </span>
        <span className="demo-dir__off" data-d="off">
          <svg className="ico" viewBox="0 0 24 24">
            <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
          </svg>
        </span>
      </span>
    </div>
    <div className="mini-toggle">
      <span className="sample__meta">Show my phone number</span>
      <span className="switch" data-d="switch">
        <span className="switch__knob" data-d="knob" />
      </span>
    </div>
  </div>
);

// The Android and iPhone section is hidden for now (client's request); true shows it again
const SHOW_STORES = false;

/* Android and iPhone: ROW opening on an Android phone, and signing in with a one-time code on an iPhone (the code's
   dots fill in, data-build). Text-free; the logo is the supplied image laid over the first screen. */
const bothArt = (
  <div className={s.both} data-build>
    <svg viewBox="0 0 480 420" aria-hidden="true">
      <circle cx="240" cy="212" r="196" fill="#fff" opacity=".1" />
      <g transform="rotate(-7 165 215)">
        <rect x="75" y="45" width="180" height="340" rx="24" fill={C.ink} />
        <rect x="82" y="52" width="166" height="326" rx="18" fill="#F7F9FC" />
        <circle cx="165" cy="67" r="5" fill={C.ink} />
        <rect x="125" y="270" width="80" height="6" rx="3" fill={C.cream2} />
        <rect x="125" y="270" width="44" height="6" rx="3" fill={C.azure} />
      </g>
      <g transform="rotate(6 320 210)">
        <rect x="230" y="40" width="180" height="340" rx="36" fill={C.ink} />
        <rect x="238" y="48" width="164" height="324" rx="29" fill="#F7F9FC" />
        <rect x="290" y="58" width="60" height="16" rx="8" fill={C.ink} />
        <Avatar x={320} y={124} r={22} />
        <Txt x={320} y={164} t="Welcome back" size={9} anchor="middle" />
        <Txt x={320} y={176} t="Enter your code" size={7} anchor="middle" weight={500} op={0.6} />
        {Array.from({ length: 6 }, (_, i) => (
          <g key={i}>
            <rect x={245 + i * 25} y="196" width="20" height="26" rx="6" fill="#fff" stroke={C.ink} strokeOpacity=".15" strokeWidth="1.5" />
            <g transform={`translate(${255 + i * 25} 209)`}>
              <circle r="3.6" fill={C.ink} data-in={(0.5 + i * 0.12).toFixed(2)} />
            </g>
          </g>
        ))}
        <rect x="254" y="244" width="132" height="34" rx="17" fill={C.azure} />
        <g transform="translate(398 78)">
          <g data-in="1.35">
            <circle r="16" fill={C.mint} stroke="#fff" strokeWidth="4" />
            <path d="M-6.5.5l4.2 4.2 8.2-8.6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      </g>
      <g transform="translate(240 356)">
        <g data-in="0.25">
          <circle r="30" fill={C.marigold} stroke="#fff" strokeWidth="6" />
          <path d="M0-12V10M-9 2l9 9 9-9" fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
    <span className={s.bootLogo}><Logo /></span>
  </div>
);

const TRIO = [
  { id: "simple-for-every-age", title: "Simple for every age", text: "Simple menus and plain words make the app easy for Rotarians of every age.", tone: s.sky, visual: menu },
  { id: "no-password-to-remember", title: "No password to remember", text: "Enter your email address or mobile number and ROW sends you a one-time code. Type in the code and you are in.", tone: s.warm, visual: code },
  { id: "your-details-stay-private", title: "Your details stay private", text: "You decide whether your phone number and email can be seen.", tone: s.lilac, visual: privacy, tile: "dir" },
];

export default function MobileAppPage() {
  return (
    <>
      <PageHero
        title={<>Your Rotary club, always <Scribble>in your pocket</Scribble></>}
        intro="The ROW mobile app replaces the printed club roster. Every member can find a fellow Rotarian, see what is happening in the club and stay connected, right from their phone."
        visual={directory}
      />

      <Section id="member-features" title="Member features">
        <ArtCards
          cols={4}
          items={[
            { line: "Profile Management: update your own profile anytime, right from the app", c: "sky", art: profileArt },
            { line: "Club Finder: find any Rotary club and connect with it easily", c: "lilac", art: finderArt },
            { line: "Find a Rotarian: search for Rotarians by name, classification or keyword to network and work together", c: "marigold", art: findArt },
            { line: "Search Projects: explore projects run by other clubs and find ways to take part", c: "mint", art: projectsArt },
          ]}
        />
      </Section>

      <Section id="your-club-on-your-phone" title="Your club on your phone" c="sky" aside={homeArt} className={s.onPhone}>
        <ul className={s.checks}>
          {LINES.map(([line, c, icon]) => (
            <li key={line} data-reveal>
              <span className={s.lineIcon} data-c={c} aria-hidden="true"><svg viewBox="0 0 24 24">{icon}</svg></span>
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <div className={`container ${s.trio}`}>
        {TRIO.map((t) => (
          <section key={t.id} id={t.id} className={s.card} aria-labelledby={`${t.id}-title`} data-reveal data-tile={t.tile}>
            <div className={`${s.well} ${t.tone}`} aria-hidden="true">{t.visual}</div>
            <h2 id={`${t.id}-title`}>{t.title}</h2>
            <p>{t.text}</p>
          </section>
        ))}
      </div>

      {/* Hidden for now at the client's request, not removed: set SHOW_STORES to true to bring it back. */}
      {SHOW_STORES ? (
        <Section id="android-and-iphone" title="Android and iPhone" c="marigold" aside={bothArt} className={s.stores2}>
          <Lead>Download ROW free from Google Play or the App Store. Your club needs a ROW subscription for you to sign in.</Lead>
          <div className={s.stores} data-reveal>
            <a className={s.store} href={GOOGLE_PLAY} target="_blank" rel="noopener noreferrer">
              <svg className={s.play} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.6 19 12 7 19.4Z" />
              </svg>
              Google Play
            </a>
            <a className={s.store} href={APP_STORE} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 7.6c-1.2-.9-2.6-1.3-3.9-1.1C5.6 6.9 4 9.1 4 12.1c0 3.9 2.4 8.4 4.9 8.4 1 0 1.7-.6 3.1-.6s2.1.6 3.1.6c2.5 0 4.9-4.5 4.9-8.4 0-3-1.6-5.2-4.1-5.6-1.3-.2-2.7.2-3.9 1.1Z" />
                <path d="M12.2 6.2c0-2 1.4-3.6 3.4-3.9.1 2-1.3 3.7-3.4 3.9Z" />
              </svg>
              App Store
            </a>
          </div>
        </Section>
      ) : null}
      <PageFx />
    </>
  );
}
