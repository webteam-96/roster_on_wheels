import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Arrow from "@/components/Arrow";
import PageFx from "@/components/PageFx";
import { Lead, PageHero, Scribble, Section } from "@/components/kit";
import { EMAIL, PHONES } from "@/lib/site";
import DemoForm from "./DemoForm";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Contact Roster On Wheels | Book a Free Demo",
  description:
    "Contact the Roster On Wheels team to book a free demo, ask about pricing or get help with your Rotary club or district. Call, email or send us a message.",
};

// Every visible word is verbatim from the V2 content doc's Contact Us page.
const MAILTO = `mailto:${EMAIL}`;
const [USER, HOST] = EMAIL.split("@");

export default function ContactUs() {
  return (
    <>
      <PageHero
        title={<>Talk to the Roster On Wheels <Scribble>team</Scribble></>}
        intro="Book a free demo, ask about pricing for your club or district, or get help with ROW."
      />

      {/* Every demo button on the site lands here (DEMO_HREF in lib/site.ts). Call or email us sits in the same
          panel, under the paragraph, beside the long form. */}
      <Section id="book-a-free-demo" title="Book a free demo" c="sky" aside={<DemoForm />} className={s.book}>
        <Lead>Fill in the form and we will call or email you to fix a time that suits you.</Lead>
        <section className={s.reach} id="call-or-email-us" aria-labelledby="call-or-email-us-title">
          <h2 className={s.reachTitle} id="call-or-email-us-title">Call or email us</h2>
          <ul className={s.cards}>
            <li className={`kcard ${s.card}`} data-c="azure" data-reveal style={{ "--tilt": "-1deg" } as CSSProperties}>
              <span className={s.badge} aria-hidden="true">
                <svg className="ico" viewBox="0 0 24 24">
                  <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
                  <path d="M10.5 18h3" />
                </svg>
              </span>
              <h3 className={`kcard__t ${s.cardTitle}`}>Phone</h3>
              <ul className={s.links}>
                {PHONES.map((p) => (
                  <li key={p}>
                    <a className={s.link} href={`tel:${p.replace(/\s/g, "")}`}>
                      <span>{p}</span>
                      <Arrow />
                    </a>
                  </li>
                ))}
              </ul>
            </li>
            <li className={`kcard ${s.card}`} data-c="cream" data-reveal style={{ "--tilt": "1deg" } as CSSProperties}>
              <span className={s.badge} aria-hidden="true">
                <svg className="ico" viewBox="0 0 24 24">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M4 7.5l8 6 8-6" />
                </svg>
              </span>
              <h3 className={`kcard__t ${s.cardTitle}`}>Email</h3>
              <p className={s.links}>
                <a className={s.link} href={MAILTO}>
                  {/* on a narrow phone the address breaks after the @ */}
                  <span>
                    {USER}@<wbr />
                    {HOST}
                  </span>
                  <Arrow />
                </a>
              </p>
            </li>
          </ul>
        </section>
      </Section>

      <Section id="already-using-row" title="Already using ROW?" c="lilac" className={s.duo}>
        <Lead>
          {"For help with your club's account, "}
          <a className={s.inline} href={MAILTO}>email us</a>
          {" with your club name and district number, and our support team will get back to you."}
        </Lead>
      </Section>

      <PageFx />
    </>
  );
}
