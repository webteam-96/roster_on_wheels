import type { Metadata } from "next";
import PageFx from "@/components/PageFx";
import { Faq, PageHero, Scribble } from "@/components/kit";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Roster On Wheels FAQ | Questions About the ROW App",
  description:
    "Simple answers about Roster On Wheels (ROW): what it does, what USD 10 per member includes, My Rotary, privacy and how to get started.",
};

// The V2 doc's eight questions and answers, verbatim and in the doc's order.
const FAQ = [
  { q: "What is Roster On Wheels?", a: "A club management and district management tool for Rotary. Members use the mobile app, and officers use it to run the club or district." },
  { q: "How much does it cost?", a: "USD 10 per member, per year. Districts can contact us for district pricing." },
  { q: "What does the USD 10 include?", a: "The mobile app, an Integrated Club Website, the Club Dues Collection Tool and the Events Module, plus every club feature." },
  { q: "Do members pay for the app?", a: "No. The club pays, and members download the app free." },
  { q: "Is it easy to use?", a: "Yes. If you can use a smartphone, you can use ROW." },
  { q: "Does it work with My Rotary?", a: "Yes. Your member list comes straight from My Rotary." },
  { q: "Who can see my phone number and email?", a: "You decide. You can show or hide your details at any time." },
  { q: "How do we start?", a: "Book a free demo. We set up your club and help your officers get started." },
];

// Chat bubbles with one tight corner, each pointing at its speaker.
const ASK = "M78 36H210a44 44 0 0 1 44 44V148a44 44 0 0 1-44 44H46a12 12 0 0 1-12-12V80a44 44 0 0 1 44-44z";
const ANSWER = "M194 214H366a44 44 0 0 1 44 44V338a12 12 0 0 1-12 12H194a44 44 0 0 1-44-44V258a44 44 0 0 1 44-44z";

/** Decorative and text-free, in the logo's two colours: a member asks in gold, ROW answers in Royal Blue and the answer writes itself in. */
const qaArt = (
  <svg className={s.art} viewBox="0 0 480 410" aria-hidden="true">
    <circle cx="240" cy="205" r="184" fill="#EDF4FB" />
    <circle cx="398" cy="92" r="12" fill="#0067C8" />
    <circle cx="440" cy="140" r="7" fill="#A9C6EA" />
    <g className={`${s.pop} ${s.ask}`}>
      <g transform="rotate(-4 144 114)">
        <path d={ASK} fill="#1B2C42" opacity=".12" transform="translate(0 12)" />
        <path d={ASK} fill="#FFC65C" stroke="#F7F9FC" strokeWidth="10" paintOrder="stroke" />
        <g transform="translate(144 114)" fill="#1B2C42">
          <path d="M-23-15A24 24 0 1 1 24-22C24-6 0-4 0 10V20" fill="none" stroke="#1B2C42" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
          <circle cy="42" r="9.5" />
        </g>
      </g>
      <circle cx="30" cy="232" r="24" fill="#F7A81B" stroke="#F7F9FC" strokeWidth="8" paintOrder="stroke" />
    </g>
    <g className={`${s.pop} ${s.answer}`}>
      <g transform="rotate(3 280 282)">
        <path d={ANSWER} fill="#1B2C42" opacity=".14" transform="translate(0 12)" />
        <path d={ANSWER} fill="#17458F" stroke="#F7F9FC" strokeWidth="10" paintOrder="stroke" />
        <rect className={s.line} x="184" y="248" width="196" height="14" rx="7" fill="#F7A81B" />
        <rect className={s.line} x="184" y="274" width="170" height="14" rx="7" fill="#F7F9FC" />
        <rect className={s.line} x="184" y="300" width="110" height="14" rx="7" fill="#F7F9FC" />
      </g>
      <circle cx="436" cy="372" r="26" fill="#1B2C42" stroke="#F7F9FC" strokeWidth="8" paintOrder="stroke" />
      <circle cx="436" cy="372" r="11.4" fill="none" stroke="#F7A81B" strokeWidth="5.4" />
    </g>
  </svg>
);

export default function FaqPage() {
  return (
    <>
      <div className={s.hero}>
        <PageHero title={<>Frequently asked <Scribble>questions</Scribble></>} visual={qaArt} />
      </div>

      {/* The doc gives the questions no section heading: each question is its own H2. */}
      <section className={s.list}>
        <div className="container">
          <div data-reveal>
            <Faq items={FAQ} idPrefix="q" level={2} />
          </div>
        </div>
      </section>

      <PageFx />
    </>
  );
}
