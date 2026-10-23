import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import PageFx from "@/components/PageFx";
import Logo from "@/components/Logo";
import { ICON } from "@/components/art";
import { CardGrid, DemoButton, Lead, PageHero, Scribble, Section } from "@/components/kit";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Rotary Club Management Tool and App | Roster On Wheels",
  description:
    "Manage your Rotary club with ROW: directory, board, meetings, attendance, projects, dues, monthly reports, Foundation giving and your club website.",
};

// Every visible word below is verbatim from the V2 content doc's Club Management page, including the words inside the mock-ups.

function Check({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Lock() {
  return (
    <svg className="ico" viewBox="0 0 24 24">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

/* Hero: the district hub scene (lib/row-fx.js: data-hub), its threads running from the ROW logo to the intro's own words */
const HUB: [string, string, string, ReactNode][] = [
  ["members", "0", "coral", ICON.people],
  ["meetings", ".55", "sky", ICON.calendar],
  ["projects", ".86", "mint", ICON.heart],
  ["money", "1", "marigold", ICON.card],
  ["messages", ".86", "lilac", ICON.chat],
  ["reports", ".55", "azure", ICON.chart],
  ["website", "0", "coral", ICON.browser],
];

const hub = (
  <div className={`hub ${styles.heroHub}`} aria-hidden="true" data-hub>
    <svg className="hub__threads" data-hub-svg />
    <div className="hub__core hub__core--logo" data-hub-core>
      <Logo />
    </div>
    <ul className="hub__clubs">
      {HUB.map(([word, x, c, icon]) => (
        <li key={word} className="club" style={{ "--x": x } as CSSProperties} data-c={c}>
          <span className="club__dot"><svg viewBox="0 0 24 24">{icon}</svg></span>
          <span className="club__text">
            <span className="club__name">{word}</span>
          </span>
        </li>
      ))}
    </ul>
  </div>
);

/* Section tiles: the home page's bento demos without their captions (each section's H2 and cards carry the message).
   lib/row-fx.js animates each one from its data-tile and data-d hooks; decorative, so not a tab stop. */
const directoryTile = (
  <div className={`tile ${styles.visual}`} data-c="azure" data-tile="dir">
    <div className="tile__demo demo-dir" aria-hidden="true">
      <div className="mini-card">
        <div className="mini-card__head">
          <span className="mono" data-c="lilac">PS</span>
          <span className="mini-card__who">
            <span className="sample__name">Priya Sharma</span>
            <span className="sample__meta">Secretary</span>
          </span>
        </div>
        <div className="mini-row">
          <span>email</span>
          <span className="mini-row__v">
            <Check className="ico" />
          </span>
        </div>
        <div className="mini-row">
          <span>phone</span>
          <span className="mini-row__v demo-dir__phone">
            <span className="demo-dir__on" data-d="on">
              <Check className="ico" />
            </span>
            <span className="demo-dir__off" data-d="off">
              <Lock />
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
      <div className="mini-list">
        <div className="mini-list__row">
          <span className="mono" data-c="coral">RD</span>
          <span className="sample__name">Rahul Desai</span>
          <span className="mini-list__tag">Board of Directors</span>
        </div>
        <div className="mini-list__row">
          <span className="mono" data-c="mint">SK</span>
          <span className="sample__name">Sneha Kulkarni</span>
          <span className="mini-list__tag">Past Presidents</span>
        </div>
        <div className="mini-list__row">
          <span className="mono" data-c="azure">VJ</span>
          <span className="sample__name">Vikram Joshi</span>
          <span className="mini-list__tag mini-list__tag--off">
            <Lock />
          </span>
        </div>
      </div>
    </div>
  </div>
);

const messagesTile = (
  <div className={`tile ${styles.visual}`} data-c="mint" data-tile="chat">
    <div className="tile__demo demo-chat" aria-hidden="true">
      <div className="msg" data-d="msg">
        <span className="msg__from">ROW</span>
        <span className="msg__text">
          <span className="sample__msg">Weekly meeting this Thursday, 7 pm at Hotel Satkar. See you there!</span>
        </span>
        <span className="msg__meta">
          <span className="msg__ticks">
            <svg className="msg__t1" viewBox="0 0 24 16">
              <path d="M2 8.5l4 4L14 3.5" />
            </svg>
            <svg className="msg__t2" viewBox="0 0 24 16" data-d="t2">
              <path d="M9 12.5L18 3.5" />
            </svg>
          </span>
        </span>
      </div>
      <ul className="channels">
        <li>Event Notifications</li>
        <li>Announcements</li>
        <li>Newsletters</li>
        <li>Greetings</li>
      </ul>
    </div>
  </div>
);

const duesTile = (
  <div className={`tile ${styles.visual}`} data-c="marigold" data-tile="inv">
    <div className="tile__demo demo-inv" aria-hidden="true">
      <div className="inv">
        <div className="inv__head">
          <b>Club Dues Collection</b>
          <span className="sample__meta">Rotary Club of Thane Hills · 2026–27</span>
        </div>
        <ul className="inv__lines">
          {[["online", "USD 400"], ["offline", "USD 200"]].map(([way, amt]) => (
            <li key={way} data-d="line">
              <span className={styles.label}>{way}</span>
              <span className="sample__name">{amt}</span>
            </li>
          ))}
        </ul>
        <div className="inv__total">
          <span className="sample__meta">Total</span>
          <span className="sample__total inv__sum" data-d="sum">USD 600</span>
        </div>
        <span className="inv__chip" data-d="chip">
          <Check />
          Receipts
        </span>
      </div>
    </div>
  </div>
);

/* The stamped card (home: District tools) as the club's monthly report to the district */
const reportTile = (
  <div className={`tile ${styles.visual} ${styles.report}`} data-c="lilac" data-tile="grant">
    <div className="tile__demo demo-grant" aria-hidden="true">
      <div className="grant" data-d="card">
        <span className="grant__kicker">Club Monthly Report</span>
        <span className="sample__name">RC Thane Hills · October 2026</span>
        <div className="grant__rows">
          {[["activities", "4"], ["projects", "2"], ["contributions", "USD 1,500"]].map(([row, v]) => (
            <div key={row}>
              <span className={styles.label}>{row}</span>
              <span className="sample__name" style={row === "contributions" ? { marginRight: 56 } : undefined}>{v}</span>
            </div>
          ))}
        </div>
        <span className="grant__stamp" data-d="stamp">
          <Check className="ico" />
        </span>
      </div>
    </div>
  </div>
);

const websiteTile = (
  <div className={`tile ${styles.visual} ${styles.web}`} data-c="azure" data-tile="web">
    <div className="tile__demo demo-web" aria-hidden="true">
      <div className="web-stage">
        <div className="browser">
          <div className="browser__bar">
            <i />
            <i />
            <i />
            <span className="browser__url" />
          </div>
          <div className="browser__page">
            <div className="browser__nav">
              <span className="web-brand"><span className="web-brand__dot" /><span className="sample__tiny sample__tiny--b">RC Thane Hills</span></span>
              <span className="web-links"><span className="sample__tiny">Home</span><span className="sample__tiny">Projects</span><span className="sample__tiny">Events</span></span>
              <span className="lang-pill">
                <span className="lang-pill__track" data-d="track">
                  <span>banners</span>
                  <span>advertisements</span>
                  <span>social media links</span>
                  <span>more</span>
                </span>
              </span>
            </div>
            <div className="web-hero">
              <div className="browser__body">
                <span className="sample__head" data-d="sk">Welcome to our club</span>
                <span className="sample__tiny" data-d="sk">Rotary Club of Thane Hills</span>
                <span className="sample__tiny" data-d="sk">District 3142</span>
                <span className="web-cta" />
              </div>
              <span className="web-hero__art"><i /><i /><i /></span>
            </div>
            <div className="web-cards">
              <span className="web-card"><i /><span className="sample__tiny sample__tiny--b">Blood camp</span><span className="sample__tiny">12 Oct</span></span>
              <span className="web-card"><i /><span className="sample__tiny sample__tiny--b">Tree drive</span><span className="sample__tiny">19 Oct</span></span>
              <span className="web-card"><i /><span className="sample__tiny sample__tiny--b">Fellowship</span><span className="sample__tiny">26 Oct</span></span>
            </div>
            <div className="browser__ad" data-d="ad">
              <span>advertisements</span>
              <span className="web-sponsors"><i /><i /><i /></span>
            </div>
          </div>
        </div>
        <div className="web-phone">
          <span className="web-phone__notch" />
          <span className="web-phone__hero"><span className="sample__tiny sample__tiny--b">RC Thane Hills</span><span className="sample__tiny">District 3142</span></span>
          <span className="web-phone__row"><i /><span className="sample__tiny">Projects</span></span>
          <span className="web-phone__row"><i /><span className="sample__tiny">Events</span></span>
          <span className="web-phone__ad" />
        </div>
      </div>
    </div>
  </div>
);

export default function ClubManagementPage() {
  return (
    <>
      <PageHero
        title={<>Rotary club management <Scribble>made simple</Scribble></>}
        intro="ROW gives your club one place for members, meetings, projects, money, messages, reports and your website. Every screen is written in plain words, so any club officer can use it."
        visual={hub}
      />

      <Section
        id="members-and-club-leadership"
        title="Members and club leadership"
        c="sky"
        aside={directoryTile}
        className={`${styles.split} ${styles.trio}`}
      >
        <CardGrid
          cols={3}
          items={[
            "Directory: keep your member list up to date, assign club admins and manage member details",
            "Board of Directors: update and manage your club's current Board of Directors",
            "Past Presidents: keep a complete record of your club's past presidents",
          ]}
        />
      </Section>

      <Section id="meetings-and-service" title="Meetings and service" className={styles.trio}>
        <CardGrid
          cols={3}
          items={[
            "Club Service: record club meetings, including weekly, board, fellowship and other gatherings",
            "Attendance: record attendance for club meetings and events",
            "Avenues of Service: record projects under Community Service, Vocational Service, International Service, New Generation Service and Public Image",
          ]}
        />
      </Section>

      <Section
        id="keeping-members-informed"
        title="Keeping members informed"
        c="lilac"
        aside={messagesTile}
        className={`${styles.split} ${styles.flip} ${styles.quad}`}
      >
        <CardGrid
          cols={3}
          items={[
            "Event Notifications: tell members about upcoming events through the app and email",
            "Announcements: share important news with members through the app and email",
            "Newsletters: create and share newsletters about your club's activities and achievements",
            "Greetings: send personal birthday and anniversary wishes to members automatically",
          ]}
        />
      </Section>

      <Section id="money-and-rotary-foundation" title="Money and Rotary Foundation" aside={duesTile} className={styles.split}>
        <CardGrid
          cols={2}
          items={[
            "Club Dues Collection: send members payment reminders and accept dues online or offline. Receipts are created automatically and reports update in real time",
            "Rotary Foundation Contributions: track Rotary Foundation (TRF) contributions made by your club and its members",
          ]}
        />
      </Section>

      <Section
        id="working-with-your-district"
        title="Working with your district"
        c="ink"
        aside={reportTile}
        className={`${styles.split} ${styles.flip} ${styles.trio}`}
      >
        <CardGrid
          cols={3}
          items={[
            "Club Monthly Report: prepare and submit your monthly report to the district, covering activities, projects and contributions",
            "District Citation: take part in your district's citation program and earn points by meeting its criteria",
            "OCV and GOV Documents: keep all documents for the District Governor's Official Visit in one place",
          ]}
        />
      </Section>

      <Section id="your-club-website-and-reports" title="Your club website and reports" aside={websiteTile} className={styles.split}>
        <CardGrid
          cols={2}
          items={[
            "Club Website Management: update your club website's banners, advertisements, social media links and more",
            "Reports: download reports on members, past presidents, the Board of Directors and projects",
          ]}
        />
      </Section>

      <Section id="easy-for-every-officer" title={<>Easy for <Scribble>every officer</Scribble></>} c="marigold" className={styles.closing}>
        <Lead>If you can use a smartphone, you can use ROW. Our team helps your officers get started and is a phone call or an email away.</Lead>
        <div className="demo__ctas" data-reveal>
          <DemoButton />
        </div>
      </Section>
      <PageFx />
    </>
  );
}
