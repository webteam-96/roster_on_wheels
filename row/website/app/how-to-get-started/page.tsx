import type { Metadata } from "next";
import PageFx from "@/components/PageFx";
import { Avatar, C, Card, ICON, IconTile, Lines, Txt } from "@/components/art";
import { DemoButton, Lead, PageHero, Scribble, Section, Steps } from "@/components/kit";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "How to Start Using Roster On Wheels | Simple Setup Steps",
  description:
    "Getting your Rotary club on Roster On Wheels is easy: book a demo, subscribe, connect My Rotary, and your members download the app. We help at every step.",
};

const STEPS = [
  "Book a free demo. We show you ROW and answer your questions.",
  "Subscribe. Pay the yearly fee for your club.",
  "Connect My Rotary. Your club president or secretary chooses ROW as the club's software in My Rotary. We send simple instructions.",
  "We set up your club. Your members, board and club details come in from My Rotary.",
  "Members download the app. Each member signs in with a one-time code. No password needed.",
  "We help your officers get started. Our team shows your officers how to use ROW.",
];
const STEP_ICONS = [ICON.screen, ICON.card, ICON.sync, ICON.people, ICON.download, ICON.headset];

/* The pictures below are text-free except for the doc's own words ("My Rotary", "ROW", "family names", "photos",
   "president", "secretary", "a few minutes", "email", "phone"). lib/row-fx.js builds each once in view
   (data-build; data-in = start in seconds). */

// No typing in your member list: the list comes over from My Rotary; you only add extras such as family names or photos
const MEMBERS = [[70, C.coral, "Anil Mehta", "President"], [116, C.sky, "Priya Sharma", "Secretary"], [162, C.mint, "Rahul Desai", "Treasurer"], [208, C.lilac, "Sneha Kulkarni", "Member"]] as const; // row centres in a card
const memberArt = (
  <svg className={s.art} viewBox="0 0 460 330" aria-hidden="true" data-build>
    <Card x={8} y={44} w={182} h={252} r={22}>
      <circle cx="26" cy="28" r="8" fill="none" stroke={C.marigold} strokeWidth="4" />
      <text className={s.word} x="42" y="33">My Rotary</text>
      {MEMBERS.map(([y, , name, role]) => (
        <g key={y}>
          <Avatar x={30} y={y} r={13} fill="#D5DEE8" glyph="#fff" />
          <Lines x={52} y={y - 9} w={70} t={name} t2={role} size={9.5} />
        </g>
      ))}
    </Card>
    <path className={s.arrow} d="M196 176C212 160 234 160 248 172" data-in-draw="0.2" />
    <path className={s.arrow} d="M240.6 163.7 248 172 237.2 174.2" data-in-draw="0.5" />
    <g transform="translate(222 118)">
      <g data-in="0.35">
        <circle r="22" fill="#fff" stroke={C.ink} strokeOpacity=".12" strokeWidth="2" />
        <g transform="translate(-11 -11) scale(.92)" fill="none" stroke={C.ink} strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON.keyboard}</g>
        <path d="M-13 13 13-13" stroke={C.coral} strokeWidth="4" strokeLinecap="round" />
      </g>
    </g>
    <Card x={254} y={20} w={202} h={300} r={22}>
      <circle cx="26" cy="28" r="8" fill={C.azure} />
      <text className={s.word} x="42" y="33">ROW</text>
      {MEMBERS.map(([y, c, name, role], i) => (
        <g key={y} data-in={(0.55 + i * 0.16).toFixed(2)} data-in-move="-24 0">
          <Avatar x={30} y={y} r={13} fill={c} glyph={c === C.mint ? "#fff" : C.ink} />
          <Lines x={52} y={y - 9} w={70} t={name} t2={role} size={9.5} />
        </g>
      ))}
      <g data-in="1.35">
        <rect x="14" y="242" width="108" height="24" rx="12" fill={C.sky} />
        <path d="M25 254h8M29 250v8" stroke={C.azure} strokeWidth="2.4" strokeLinecap="round" />
        <text className={s.chip} x="38" y="258.5">family names</text>
      </g>
      <g data-in="1.5">
        <rect x="128" y="242" width="64" height="24" rx="12" fill="#FDE7B8" />
        <path d="M138 254h8M142 250v8" stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" />
        <text className={s.chip} x="151" y="258.5">photos</text>
      </g>
    </Card>
  </svg>
);

// Only the president or secretary needs to connect My Rotary: they choose ROW as the club's software, in a few minutes
const OPTIONS = [[84, "ClubRunner"], [132, "DACdb"]] as const; // row tops in the card, the other software choices
const connectArt = (
  <svg className={s.art} viewBox="0 0 460 340" aria-hidden="true" data-build>
    <circle cx="250" cy="170" r="166" fill="#fff" opacity=".1" />
    <path d="M98 118C140 124 140 230 166 240M100 226c30 2 46 12 66 18" fill="none" stroke="#fff" strokeWidth="2.6" strokeDasharray="2 7" strokeLinecap="round" opacity=".7" data-in-draw="0.55" />
    <Card x={150} y={34} w={290} h={272} r={24}>
      <circle cx="28" cy="30" r="9" fill="none" stroke={C.marigold} strokeWidth="4.5" />
      <text className={s.word} x="46" y="35.5">My Rotary</text>
      <Lines x={24} y={52} w={150} t="Club software" t2="Rotary Club of Thane Hills" size={10} />
      {OPTIONS.map(([y, w]) => (
        <g key={y}>
          <rect x="18" y={y} width="254" height="40" rx="14" fill={C.cream2} />
          <circle cx="42" cy={y + 20} r="8" fill="#fff" stroke={C.ink} strokeOpacity=".3" strokeWidth="2.4" />
          <Txt x={62} y={y + 24} t={w} size={11} weight={600} op={0.6} />
        </g>
      ))}
      <rect x="18" y="180" width="254" height="40" rx="14" fill="#fff" stroke={C.azure} strokeWidth="2.5" />
      <circle cx="42" cy="200" r="8" fill={C.azure} />
      <circle cx="42" cy="200" r="3" fill="#fff" />
      <text className={s.row} x="62" y="206">ROW</text>
      <g transform="translate(248 200)">
        <g data-in="0.95">
          <circle r="13" fill={C.mint} />
          <path d="M-5.5.5l3.6 3.6 7-7.4" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      <g transform="translate(24 236)">
        <rect width="120" height="22" rx="11" fill="#FDE7B8" />
        <g transform="translate(7 4) scale(.58)" fill="none" stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 3.5h5" /></g>
        <text className={s.chip} x="26" y="15.5">a few minutes</text>
      </g>
    </Card>
    {[[72, 112, C.marigold, "president", 0.2], [72, 222, C.mint, "secretary", 0.35]].map(([x, y, c, who, t]) => (
      <g key={String(who)} data-in={String(t)}>
        <Avatar x={Number(x)} y={Number(y)} r={28} fill={String(c)} ring="#fff" />
        <rect x={Number(x) - 40} y={Number(y) + 34} width="80" height="22" rx="11" fill="#fff" />
        <text className={s.pill} x={Number(x)} y={Number(y) + 49.5}>{who}</text>
      </g>
    ))}
  </svg>
);

// Help whenever you need it: the support team by email and phone, and again for new officers each Rotary year
const helpArt = (
  <svg className={s.art} viewBox="0 0 460 330" aria-hidden="true" data-build>
    <circle cx="150" cy="168" r="96" fill={C.sky} />
    <circle cx="150" cy="174" r="74" fill={C.ink} opacity=".08" />
    <circle cx="150" cy="168" r="74" fill="#fff" />
    <Avatar x={150} y={170} r={52} fill={C.azure} />
    <path d="M114 160a36 36 0 0 1 72 0" fill="none" stroke={C.ink} strokeWidth="7" strokeLinecap="round" />
    <rect x="104" y="152" width="14" height="24" rx="6" fill={C.ink} />
    <rect x="182" y="152" width="14" height="24" rx="6" fill={C.ink} />
    <path d="M189 176c0 12-10 18-22 18" fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
    <circle cx="164" cy="194" r="5" fill={C.marigold} />
    {[[266, 64, C.mint, "#fff", ICON.mail, "email", 0.3], [266, 140, C.marigold, C.ink, ICON.phone, "phone", 0.5]].map(([x, y, c, st, icon, word, t]) => (
      <g key={String(word)} data-in={String(t)} data-in-move="30 0">
        <Card x={Number(x)} y={Number(y)} w={180} h={58} r={18}>
          <IconTile x={12} y={12} size={34} fill={String(c)} stroke={String(st)}>{icon}</IconTile>
          <text className={s.word} x="58" y="27">{word}</text>
          <Txt x={58} y={43} t={word === "email" ? "support@rosteronwheels.com" : "+91 84240 64369"} size={8} weight={500} op={0.6} />
        </Card>
      </g>
    ))}
    <g data-in="0.8">
      <circle cx="292" cy="262" r="20" fill={C.ink} />
      <g transform="translate(281 251) scale(.92)" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{ICON.cycle}</g>
    </g>
    {[[338, C.coral, C.ink], [370, C.lilac, C.ink], [402, C.mint, "#fff"]].map(([x, c, g], i) => (
      <g key={String(x)} data-in={(0.95 + i * 0.1).toFixed(2)}>
        <Avatar x={Number(x)} y={262} r={17} fill={String(c)} glyph={String(g)} ring="#fff" />
      </g>
    ))}
  </svg>
);

export default function HowToGetStarted() {
  return (
    <>
      <PageHero
        title={<>Getting started with Roster On Wheels <Scribble>is easy</Scribble></>}
        intro="Our team sets up ROW for your club. You do not need any technical knowledge."
      />

      <Section id="six-simple-steps" title="Six simple steps" c="lilac" className={s.steps}>
        <Steps items={STEPS} lead icons={STEP_ICONS} />
      </Section>

      <Section id="member-list" title="No typing in your member list" aside={memberArt} className={s.statement}>
        <Lead>
          Your member list comes from My Rotary when your club connects ROW. You only add extra details you want, such as family names or photos.
        </Lead>
      </Section>

      <Section
        id="connect-my-rotary"
        title="Only the president or secretary needs to connect My Rotary"
        c="marigold"
        aside={connectArt}
        className={`${s.statement} ${s.flip}`}
      >
        <Lead>
          {"Rotary International asks the club president or club secretary to choose the club's software. It takes a few minutes, and we guide you through it."}
        </Lead>
      </Section>

      <Section id="help" title="Help whenever you need it" aside={helpArt} className={s.statement}>
        <Lead>Our support team helps you by email and phone, including when new officers take over each Rotary year.</Lead>
        <div className={`hero__ctas ${s.cta}`} data-reveal>
          <DemoButton />
        </div>
      </Section>

      <PageFx />
    </>
  );
}
