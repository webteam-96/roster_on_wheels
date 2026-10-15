"use server";

import { demoEmailHtml } from "./email";

// The demo form's fields, named by their doc labels (DemoForm.tsx). The first five are required.
const FIELDS = [
  "Full name", "Email address", "Phone number, with country code", "Rotary club name", "District number",
  "Your role", "I am interested in", "Message",
] as const;
const REQUIRED = FIELDS.slice(0, 5);

export type Values = Partial<Record<(typeof FIELDS)[number], string>>;
export type SendState = { status: "idle" | "sent" | "error"; values?: Values; at?: number }; // at: when it failed

/** Emails a demo request to the ROW team through the Apps Script mailer (see .env.example). */
export async function sendDemoRequest(_prev: SendState, form: FormData): Promise<SendState> {
  // Bots fill every field, including the hidden one: pretend it worked and send nothing
  if (String(form.get("website") ?? "")) return { status: "sent" };

  const values: Values = {};
  for (const f of FIELDS) {
    const raw = String(form.get(f) ?? "").trim();
    // one line each (keeps the subject and body clean), the message may wrap; lengths are capped
    values[f] = f === "Message" ? raw.slice(0, 4000) : raw.replace(/\s+/g, " ").slice(0, 200);
  }
  const email = values["Email address"] ?? "";
  if (REQUIRED.some((f) => !values[f]) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", values, at: Date.now() };

  const { MAIL_SCRIPT_URL, MAIL_SECRET } = process.env;
  if (!MAIL_SCRIPT_URL || !MAIL_SECRET) {
    console.error("[contact] MAIL_SCRIPT_URL and MAIL_SECRET are not set, so the demo request was not emailed");
    return { status: "error", values, at: Date.now() };
  }

  try {
    // The Apps Script web app (apps-script/Code.gs) sends it from the Google mailbox it is deployed under
    const res = await fetch(MAIL_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: MAIL_SECRET,
        replyTo: email, // a reply goes straight to the person who asked
        subject: `Book a free demo: ${values["Rotary club name"]}`,
        body: FIELDS.filter((f) => values[f]).map((f) => `${f}: ${values[f]}`).join("\n"),
        html: demoEmailHtml(values),
      }),
    });
    const out = await res.json().catch(() => null);
    if (!out?.ok) throw new Error(`the mail script answered ${res.status}: ${JSON.stringify(out)}`);
    return { status: "sent" };
  } catch (err) {
    console.error("[contact] the demo request email failed", err);
    return { status: "error", values, at: Date.now() };
  }
}
