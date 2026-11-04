"use client";

// "Interested in joining" form (ROW feature contacts_growth). Posts from the browser to the public API, which rate
// limits per visitor, ignores bots (hidden field, minimum fill time) and files the reply as a prospect of the club.

import { useState } from "react";

type Status = { kind: "idle" | "sending" | "done" | "error"; text?: string };

export function JoinForm({ clubId, clubName, apiBase }: { clubId: number; clubName: string; apiBase: string }) {
  const [shownAt] = useState(() => Date.now());
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`${apiBase}/api/public/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          clubId,
          name: f.get("name"), email: f.get("email"), phone: f.get("phone"), message: f.get("message"),
          consent: f.get("consent") === "on", website: f.get("website"), elapsedMs: Date.now() - shownAt,
        }),
      });
      const body = await res.json().catch(() => ({}));
      setStatus(res.ok ? { kind: "done", text: body.message } : { kind: "error", text: body.message || "Please check the form and try again." });
    } catch {
      setStatus({ kind: "error", text: "The form could not be sent. Please try again in a moment." });
    }
  }

  if (status.kind === "done") {
    return <p className="text-lg text-brand-ink">{status.text || `Thank you. ${clubName} will be in touch soon.`}</p>;
  }

  const field = "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="join-name" className="block text-sm font-semibold text-brand-ink">Your name *</label>
        <input id="join-name" name="name" required maxLength={200} autoComplete="name" className={field} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="join-email" className="block text-sm font-semibold text-brand-ink">Email *</label>
          <input id="join-email" name="email" type="email" required maxLength={200} autoComplete="email" className={field} />
        </div>
        <div>
          <label htmlFor="join-phone" className="block text-sm font-semibold text-brand-ink">Phone</label>
          <input id="join-phone" name="phone" type="tel" maxLength={20} autoComplete="tel" className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="join-message" className="block text-sm font-semibold text-brand-ink">Anything you would like to tell us</label>
        <textarea id="join-message" name="message" rows={4} maxLength={1000} className={field} />
      </div>
      {/* Hidden from people and screen readers; bots fill it in. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
      <label className="flex items-start gap-2 text-sm text-brand-ink">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>I agree that {clubName} may keep these details and contact me about membership. They are not shared with anyone else.</span>
      </label>
      {status.kind === "error" && <p role="alert" className="text-sm text-red-700">{status.text}</p>}
      <button type="submit" disabled={status.kind === "sending"} className="rounded-md bg-brand px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {status.kind === "sending" ? "Sending" : "Send"}
      </button>
    </form>
  );
}
