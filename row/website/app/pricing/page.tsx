import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Arrow from "@/components/Arrow";
import PageFx from "@/components/PageFx";
import { ICON } from "@/components/art";
import { Lead, PageHero, Scribble, Section } from "@/components/kit";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Roster On Wheels Pricing | USD 10 per Member per Year",
  description:
    "ROW pricing for Rotary clubs: USD 10 per member, per year, including the mobile app, club website, dues collection and events module.",
};

// What the fee includes, each with its icon
const INCLUDED: [string, ReactNode][] = [
  ["ROW Mobile App for every member of your club", ICON.phone],
  ["Integrated Club Website that you update yourself", ICON.browser],
  ["Club Dues Collection Tool with reminders and automatic receipts", ICON.card],
  ["Events Module for club events and notifications", ICON.calendar],
  ["Directory, Board of Directors and past presidents", ICON.people],
  ["Meetings, attendance and service projects", ICON.clipboard],
  ["Announcements, newsletters and greetings through the app and email", ICON.megaphone],
  ["Club monthly reports, district citation and Rotary Foundation tracking", ICON.chart],
  ["Connection with My Rotary", ICON.sync],
  ["All eight languages", ICON.globe],
  ["Help and support from our team", ICON.headset],
];
const INC_C = ["azure", "mint", "marigold", "sky", "lilac", "coral"];

const PAY = "What your club will pay";

// Club size, price per year, and one small figure for every ten members
const SIZES: [string, string, number][] = [
  ["20 members", "USD 200", 2],
  ["30 members", "USD 300", 3],
  ["50 members", "USD 500", 5],
  ["100 members", "USD 1,000", 10],
];
const PERSON = (
  <svg viewBox="-19 -19 38 38">
    <circle cy="-6" r="6.5" />
    <path d="M-11.5 11c2.2-6 6.6-8.6 11.5-8.6s9.3 2.6 11.5 8.6Z" />
  </svg>
);

export default function Page() {
  return (
    <>
      <PageHero
        title={<>Simple pricing: <Scribble>USD 10</Scribble> per member, per year</>}
        intro="One easy price covers everything. Your club pays once a year, based on the number of members."
      />

      <Section id="whats-included" title="What’s included" c="sky">
        <div className={s.plan} data-reveal>
          <p className={s.fee}>
            <span className={s.feeLabel}>Annual subscription fee per member:</span>{" "}
            <strong className={s.amount}>
              <span className={s.cur}>USD</span> 10
            </strong>
          </p>
          <div className={s.inc}>
            <p className={s.incLabel}>Everything below is included:</p>
            <ul className={s.list}>
              {INCLUDED.map(([item, icon], i) => (
                <li key={item}>
                  <span className={s.icon} data-c={INC_C[i % INC_C.length]} aria-hidden="true">
                    <svg viewBox="0 0 24 24">{icon}</svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section id="what-your-club-will-pay" title={PAY}>
        <ul className={s.sizes} aria-label={PAY} data-build>
          {SIZES.map(([size, price, n], i) => (
            <li key={size} className={s.size} data-reveal>
              <span className={s.crowd} aria-hidden="true">
                {Array.from({ length: n }, (_, k) => (
                  <i key={k} data-in={(0.15 + i * 0.12 + k * 0.05).toFixed(2)}>{PERSON}</i>
                ))}
              </span>
              <dl className={s.terms}>
                <dt>Club size</dt>
                <dd className={s.members}>{size}</dd>
                <dt>Price per year</dt>
                <dd className={s.price}>{price}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="district-pricing" title="District pricing" c="marigold" className={s.split}>
        <div>
          <Lead>For district management, or for districts that want to bring all their clubs onto ROW, please contact us for district pricing.</Lead>
          <div className="hero__ctas" data-reveal>
            <span className="magnet" data-magnet>
              <Link className="btn btn--primary btn--lg" href="/contact-us">
                Contact Us
                <Arrow />
              </Link>
            </span>
          </div>
        </div>
      </Section>
      <PageFx />
    </>
  );
}
