import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import PageFx from "@/components/PageFx";
import { ArtCards, CardGrid, DemoButton, PageHero, Scribble, Section } from "@/components/kit";
import { Avatar, C, Card, Club, ICON, IconTile, Lines, PhoneFrame, Tick, Txt } from "@/components/art";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Rotary District Management Software | Roster On Wheels",
  description:
    "ROW helps Rotary districts manage the directory, committee, Assistant Governors, club monthly reports, projects, events, citation and district dues.",
};

/* Hero hub spokes: card labels from this page, fanned on an arc (--x) around the District Governor. */
const SPOKES: [string, string, string, ReactNode][] = [
  ["District Committee", "0", "azure", ICON.people],
  ["Assistant Governors", ".55", "marigold", ICON.badge],
  ["Club Monthly Reports", ".88", "mint", ICON.clipboard],
  ["District Projects", "1", "azure", ICON.heart],
  ["District Events", ".88", "mint", ICON.calendar],
  ["Announcements", ".55", "marigold", ICON.megaphone],
  ["District Dues Collection", "0", "azure", ICON.card],
];

/* ---------- Card pictures (text-free, the home page's card style) ---------- */

// Club Monthly Reports: clubs send their reports in, the district reviews them
const reportsArt = (
  <svg viewBox="0 0 320 200">
    <path d="M94 72c10 0 12 8 18 12M100 130c8 0 8-10 12-14" fill="none" stroke={C.ink} strokeWidth="2.2" strokeDasharray="2 6" strokeLinecap="round" opacity=".5" />
    <Card x={14} y={52} w={84} h={40}><Club x={18} y={20} r={10} /><Lines x={32} y={11} w={26} t="Ambarnath" t2="East" size={8} /></Card>
    <Card x={20} y={110} w={84} h={40}><Club x={18} y={20} r={10} /><Lines x={32} y={11} w={24} t="Dombivli" t2="East" size={8} /></Card>
    <Card x={112} y={26} w={128} h={200} r={16}>
      <Txt x={16} y={26} t="October report" size={10} fill={C.azure} />
      {[[56, C.azure, "Meetings", "4 held"], [90, C.marigold, "Projects", "2 running"], [124, C.mint, "TRF giving", "USD 1,000"]].map(([y, c, a, b]) => (
        <g key={String(y)}>
          <Tick x={26} y={Number(y)} r={9} fill={String(c)} />
          <Lines x={42} y={Number(y) - 7} w={60} t={String(a)} t2={String(b)} />
        </g>
      ))}
    </Card>
    <circle cx="246" cy="116" r="26" fill="#fff" fillOpacity=".4" stroke={C.ink} strokeWidth="5" />
    <path d="M265 135l18 18" stroke={C.ink} strokeWidth="8" strokeLinecap="round" />
  </svg>
);

// District Citation: a rosette, the criteria ticked off and the points filling up
const citationArt = (
  <svg viewBox="0 0 320 200">
    <path d="M84 118 70 168l14-8 9 14 11-48Z" fill={C.coral} />
    <path d="M116 118l14 50-14-8-9 14-11-48Z" fill={C.coral} />
    <circle cx="100" cy="94" r="40" fill={C.marigold} stroke="#fff" strokeWidth="6" />
    <circle cx="100" cy="94" r="27" fill="none" stroke="#fff" strokeWidth="3" opacity=".8" />
    <path d="M100 76 104.4 86.9 116.2 87.7 107.1 95.3 110 106.8 100 100.5 90 106.8 92.9 95.3 83.8 87.7 95.6 86.9Z" fill="#fff" />
    <Card x={164} y={42} w={130} h={120}>
      {[[24, C.mint, "Membership growth"], [50, C.mint, "Service projects"], [76, C.lilac, "Foundation giving"]].map(([y, c, t]) => (
        <g key={String(y)}>
          <Tick x={20} y={Number(y)} r={8} fill={String(c)} />
          <Lines x={34} y={Number(y) - 4} w={60} t={String(t)} size={8.5} />
        </g>
      ))}
      <rect x="14" y="98" width="102" height="10" rx="5" fill={C.cream2} />
      <rect x="14" y="98" width="72" height="10" rx="5" fill={C.marigold} />
    </Card>
  </svg>
);

// Reports: a dashboard of bars, a trend line and a share
const statsArt = (
  <svg viewBox="0 0 320 200">
    <Card x={40} y={28} w={240} h={200} r={16}>
      <Lines x={18} y={18} w={72} t="Club activity" t2="July – December" size={10} />
      {[[22, 64, C.azure], [48, 92, C.mint], [74, 52, C.marigold], [100, 100, C.azure], [126, 78, C.mint]].map(([x, h, c]) => (
        <rect key={x} x={Number(x)} y={162 - Number(h)} width="18" height={Number(h)} rx="5" fill={String(c)} />
      ))}
      <path d="M31 112 57 84 83 122 109 70 135 96" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {[[31, 112], [57, 84], [83, 122], [109, 70], [135, 96]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4" fill="#fff" stroke={C.ink} strokeWidth="2.5" />)}
      <circle cx="196" cy="98" r="26" fill="none" stroke={C.cream2} strokeWidth="12" />
      <circle cx="196" cy="98" r="26" fill="none" stroke={C.azure} strokeWidth="12" strokeDasharray="98 66" transform="rotate(-90 196 98)" />
      <circle cx="196" cy="98" r="26" fill="none" stroke={C.marigold} strokeWidth="12" strokeDasharray="40 124" strokeDashoffset="-98" transform="rotate(-90 196 98)" />
      <Txt x={196} y={146} t="60% projects" size={8} anchor="middle" weight={600} op={0.6} />
    </Card>
  </svg>
);

// District Projects: the district's service projects, each with its progress, and a button to start a new one
const projectsArt = (
  <svg viewBox="0 0 320 200">
    <Card x={58} y={28} w={204} h={200} r={16}>
      <Txt x={18} y={26} t="District projects" size={10} />
      {[[42, C.coral, ICON.heart, 116, 0.7, "Blood donation camp"], [86, C.sky, ICON.drop, 104, 0.45, "Clean water for schools"], [130, C.marigold, ICON.tree, 124, 0.85, "Tree plantation"]].map(([y, c, icon, w, p, name], i) => (
        <g key={i}>
          <IconTile x={16} y={Number(y)} size={32} fill={String(c)} stroke={C.ink}>{icon}</IconTile>
          <Txt x={58} y={Number(y) + 12} t={String(name)} size={9} />
          <rect x="58" y={Number(y) + 19} width={Number(w)} height="7" rx="3.5" fill={C.cream2} />
          <rect x="58" y={Number(y) + 19} width={Number(w) * Number(p)} height="7" rx="3.5" fill={C.azure} />
        </g>
      ))}
    </Card>
    <g transform="translate(262 36)">
      <circle r="20" fill={C.marigold} stroke="#fff" strokeWidth="5" />
      <path d="M0-8v16M-8 0h16" stroke={C.ink} strokeWidth="3.2" strokeLinecap="round" />
    </g>
  </svg>
);

// District Events: a calendar with the event's day marked, and the people coming
const eventsArt = (
  <svg viewBox="0 0 320 200">
    <Card x={78} y={30} w={164} h={152} r={16}>
      <path d="M0 16A16 16 0 0 1 16 0h132a16 16 0 0 1 16 16v20H0Z" fill={C.azure} />
      <rect x="40" y="-8" width="7" height="18" rx="3.5" fill={C.ink} />
      <rect x="117" y="-8" width="7" height="18" rx="3.5" fill={C.ink} />
      {Array.from({ length: 15 }, (_, i) => {
        const x = 16 + (i % 5) * 28;
        const y = 50 + Math.floor(i / 5) * 30;
        return i === 8 ? (
          <g key={i}>
            <rect x={x} y={y} width="20" height="20" rx="6" fill={C.azure} />
            <path d={`M${x + 5.5} ${y + 10.5}l3 3 6-6.5`} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : (
          <g key={i}>
            <rect x={x} y={y} width="20" height="20" rx="6" fill={C.cream2} />
            <Txt x={x + 10} y={y + 13.5} t={String(i + 6)} size={8} anchor="middle" weight={600} op={0.7} />
          </g>
        );
      })}
      <Txt x={82} y={23} t="November 2026" size={10} fill="#fff" anchor="middle" />
    </Card>
    <Avatar x={238} y={170} r={16} fill={C.coral} glyph={C.ink} ring="#fff" />
    <Avatar x={262} y={176} r={16} fill={C.mint} ring="#fff" />
    <Avatar x={286} y={170} r={16} fill={C.lilac} glyph={C.ink} ring="#fff" />
  </svg>
);

/* Keeping the district informed: the three messages land on a phone, one after another (data-build, lib/row-fx.js).
   Text-free. */
const NOTES = [
  { y: 112, c: C.marigold, icon: ICON.calendar, w: 92, t: "District Assembly", t2: "Saturday, 14 Nov · 10 am" },
  { y: 182, c: C.coral, icon: ICON.megaphone, w: 80, t: "Message from the DG", t2: "New district projects" },
  { y: 252, c: C.mint, icon: ICON.gift, w: 100, t: "Happy birthday, Neha!", t2: "RC Thane Downtown" },
];
const informedArt = (
  <svg className={styles.informed} viewBox="0 0 340 420" aria-hidden="true" data-build>
    <circle cx="170" cy="210" r="170" fill="#fff" opacity=".1" />
    <PhoneFrame x={70} y={10} screen={C.sky} />
    <rect x="130" y="64" width="80" height="18" rx="9" fill="#fff" opacity=".9" />
    <Txt x={170} y={77} t="9:41" size={13} anchor="middle" />
    <Txt x={170} y={95} t="Tuesday, 10 November" size={7.5} anchor="middle" weight={600} op={0.6} />
    {NOTES.map((n, i) => (
      <g key={n.y} data-in={(0.3 + i * 0.35).toFixed(2)} data-in-move="40 0">
        <Card x={56} y={n.y} w={228} h={56} r={16}>
          <IconTile x={12} y={12} size={32} fill={n.c} stroke={n.c === C.mint ? "#fff" : C.ink}>{n.icon}</IconTile>
          <Lines x={56} y={17} w={n.w} t={n.t} t2={n.t2} size={10} />
          <path d="M196 28.5l3.5 3.5 7-7.5M203 32l7-7.5" fill="none" stroke={C.mint} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </Card>
      </g>
    ))}
  </svg>
);

/* District dues: receipts print one after another, each stamped paid, and the report bars rise
   (data-build, lib/row-fx.js). The only words are the doc's own: "online" and "offline". */
const TEETH = "l-10 8-10-8-10 8-10-8-10 8-10-8-10 8-10-8-10 8-10-8-10 8-10-8";
const RECEIPTS = [
  { x: 40, way: "online", club: "Thane Hills", amt: "USD 500" },
  { x: 160, way: "offline", club: "Ambarnath E.", amt: "USD 750" },
  { x: 280, way: "online", club: "Thane Uptown", amt: "USD 400" },
];
const duesArt = (
  <div className={styles.dues}>
    <svg viewBox="0 0 440 410" aria-hidden="true" data-build>
      <defs>
        <clipPath id="dues-slot"><rect x="0" y="70" width="440" height="340" /></clipPath>
      </defs>
      <g clipPath="url(#dues-slot)">
        {RECEIPTS.map((r, i) => (
          <g key={r.x} transform={`translate(${r.x} 70)`}>
            <g data-in={(0.2 + i * 0.3).toFixed(2)} data-in-move="0 -190">
              <path d={`M0 0h120v170${TEETH}V0Z`} fill="#fff" />
              <Club x={22} y={28} r={10} />
              <Lines x={38} y={21} w={62} t={r.club} t2="District dues" size={9} />
              <path d="M12 56h96" stroke={C.ink} strokeOpacity=".2" strokeWidth="2" strokeDasharray="3 4" />
              <Txt x={14} y={82} t={r.amt} size={14} />
              <rect x="14" y="94" width="64" height="22" rx="11" fill={r.way === "online" ? C.sky : "#FDE7B8"} />
              <text className={styles.way} x="46" y="109">{r.way}</text>
              <Txt x={14} y={136} t="12 Oct 2026" size={8} weight={500} op={0.55} />
            </g>
          </g>
        ))}
      </g>
      {RECEIPTS.map((r, i) => (
        <g key={r.x} transform={`translate(${r.x + 92} 206) rotate(-12)`}>
          <g data-in={(1.05 + i * 0.22).toFixed(2)}>
            <circle r="20" fill={C.mint} stroke="#fff" strokeWidth="4" />
            <path d="M-8 .5l5 5 11-11.5" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      ))}
      <rect x="20" y="28" width="400" height="52" rx="22" fill="#2A3F5C" />
      <rect x="36" y="64" width="368" height="9" rx="4.5" fill="#0B1626" />
      <circle cx="396" cy="46" r="6" fill={C.marigold} />
      <Txt x={40} y={50} t="Receipts" size={11} fill="#fff" op={0.75} />
      <Card x={108} y={286} w={224} h={104} r={18}>
        <IconTile x={16} y={16} size={30} fill={C.marigold} stroke={C.ink}>{ICON.chart}</IconTile>
        <Lines x={56} y={20} w={70} t="Dues collected" size={10} />
        {[18, 30, 24, 40, 34, 48].map((h, i) => (
          <g key={i} transform={`translate(${60 + i * 24} 92)`}>
            <rect data-in={(1.75 + i * 0.08).toFixed(2)} data-in-grow="" y={-h} width="14" height={h} rx="4" fill={i % 2 ? C.mint : C.azure} />
          </g>
        ))}
      </Card>
    </svg>
  </div>
);

export default function DistrictManagement() {
  return (
    <>
      <PageHero
        title={<>District management for District Governors and <Scribble>their teams</Scribble></>}
        intro="ROW lets the District Governor and the district team see and support every club from one place. Reports, projects, events, messages and dues are all together, so nothing gets lost in emails and spreadsheets."
        visual={
          /* The district hub scene (lib/row-fx.js: data-hub): threads run from the core and each spoke switches on. */
          <div className={`hub ${styles.heroHub}`} aria-hidden="true" data-hub>
            <svg className="hub__threads" data-hub-svg />
            <div className="hub__core" data-hub-core>
              <svg className="hub__mark" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="9.5" fill="none" stroke="#F7A81B" strokeWidth="4.5" />
              </svg>
              {" "}
              <span className="hub__name">District Governor</span>
            </div>
            <ul className="hub__clubs">
              {SPOKES.map(([label, x, c, icon]) => (
                <li key={label} className="club" style={{ "--x": x } as CSSProperties} data-c={c}>
                  <span className="club__dot"><svg viewBox="0 0 24 24">{icon}</svg></span>
                  <span className="club__text">
                    <span className="club__name">{label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <Section id="people-and-structure" title="People and structure">
        <CardGrid
          items={[
            "District Directory: see contact details for every member in the district",
            "District Committee: manage and update your District Committee members",
            "Assistant Governors: assign Assistant Governors to clubs for better coordination and support",
          ]}
        />
      </Section>

      <Section id="following-every-club" c="sky" title="Following every club">
        <ArtCards
          items={[
            { line: "Club Monthly Reports: review every club's monthly report to follow projects, meetings, Rotary Foundation contributions and membership changes", c: "lilac", art: reportsArt },
            { line: "District Citation: set the criteria for citation points so clubs can take part and earn points", c: "azure", art: citationArt },
            { line: "Reports: create detailed reports on district and club activity to support better decisions", c: "sky", art: statsArt },
          ]}
        />
      </Section>

      <Section id="projects-and-events" title="Projects and events">
        <ArtCards
          cols={2}
          items={[
            { line: "District Projects: create and manage all district projects in one place", c: "mint", art: projectsArt },
            { line: "District Events: create and manage district events", c: "marigold", art: eventsArt },
          ]}
        />
      </Section>

      <Section
        id="keeping-the-district-informed"
        c="marigold"
        title={<>Keeping the district <Scribble>informed</Scribble></>}
        aside={informedArt}
        className={styles.split}
      >
        <CardGrid
          icons={[ICON.calendar, ICON.megaphone, ICON.gift]}
          items={[
            "Event Notifications: tell members about upcoming district events through the app and WhatsApp",
            "Announcements: share important district news with all members through the app and WhatsApp",
            "Greetings: send personal birthday and anniversary wishes to district members automatically",
          ]}
        />
      </Section>

      <Section
        id="district-dues-and-website"
        className={styles.duesSection}
        title="District dues and website"
        aside={duesArt}
      >
        <CardGrid
          cols={2}
          items={[
            "District Dues Collection: collect district dues from clubs with automatic reminders and several payment methods, online or offline. Receipts are created automatically and reports update on their own",
            "District Website Management: update your district website's banners, advertisements, social media links and more",
          ]}
        />
        <div className={`hero__ctas ${styles.cta}`} data-reveal>
          <DemoButton />
        </div>
      </Section>
      <PageFx />
    </>
  );
}
