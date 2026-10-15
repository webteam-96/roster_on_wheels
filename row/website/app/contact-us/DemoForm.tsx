"use client";

import { useActionState } from "react";
import type { InputHTMLAttributes } from "react";
import Arrow from "@/components/Arrow";
import { sendDemoRequest, type SendState, type Values } from "./actions";
import s from "./page.module.css";

const SUBMIT = "Book my free demo";

/** A required text field: the doc label, the asterisk (hidden from screen readers, which announce "required").
    The name is the label, so the email reads "Label: value". */
function Text({ label, values, ...rest }: { label: keyof Values; values?: Values } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={s.field}>
      <span className={s.label}>
        {label}
        <span className={s.req} aria-hidden="true">*</span>
      </span>
      <input className={s.input} name={label} required defaultValue={values?.[label]} {...rest} />
    </label>
  );
}

/** A doc drop-down. It starts blank (no invented prompt words) and is optional. */
function Pick({ label, options, values }: { label: keyof Values; options: string[]; values?: Values }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      <select className={`${s.input} ${s.select}`} name={label} defaultValue={values?.[label] ?? ""}>
        <option value="" disabled hidden />
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

// The server action emails the request (actions.ts). If sending fails, the fields come back filled in.
export default function DemoForm() {
  const [state, action, pending] = useActionState(sendDemoRequest, { status: "idle" } as SendState);

  if (state.status === "sent") {
    return (
      // focus moves here, so a keyboard or screen reader user lands on the confirmation
      <div className={`${s.form} ${s.done}`} role="status" tabIndex={-1} autoFocus>
        <span className={s.doneTick} aria-hidden="true">
          <svg className="ico" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <p className={s.doneText}>Thank you. We will call or email you to fix a time that suits you.</p>
      </div>
    );
  }

  const v = state.values;
  return (
    // a new key after each failed send remounts the form, so every field (drop-downs too) shows what was typed
    <form className={s.form} action={action} key={state.at}>
      <Text label="Full name" autoComplete="name" values={v} />
      <Text label="Email address" type="email" autoComplete="email" values={v} />
      <Text label="Phone number, with country code" type="tel" autoComplete="tel" values={v} />
      <Text label="Rotary club name" values={v} />
      <Text label="District number" inputMode="numeric" values={v} />
      <Pick label="Your role" options={["Member", "President", "Secretary", "Treasurer", "District team"]} values={v} />
      <Pick label="I am interested in" options={["Club", "District", "Both"]} values={v} />
      <label className={s.field}>
        <span className={s.label}>
          Message <span className={s.opt}>Optional</span>
        </span>
        <textarea className={`${s.input} ${s.area}`} name="Message" rows={5} defaultValue={v?.Message} />
      </label>
      {/* left empty by people; bots that fill it are ignored */}
      <input className={s.trap} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      {state.status === "error" ? (
        <p className={s.error} role="alert">Sorry, your request did not go through. Please try again, or call or email us.</p>
      ) : null}
      <div className={`hero__ctas ${s.submit}`}>
        <span className="magnet" data-magnet>
          <button className="btn btn--primary btn--lg" type="submit" disabled={pending}>
            {SUBMIT}
            <Arrow />
          </button>
        </span>
      </div>
    </form>
  );
}
