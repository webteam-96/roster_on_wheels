"use client";

import { useState, useTransition } from "react";
import { rateArticle } from "./actions";
import s from "./help.module.css";

export default function Feedback({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "thanks" | "error">("idle");
  const [pending, start] = useTransition();
  const send = (helpful: boolean) => start(async () => setState((await rateArticle(slug, helpful)) ? "thanks" : "error"));

  return (
    <div className={s.feedback} aria-live="polite">
      {state === "thanks" ? (
        <p>Thank you. Your answer helps us improve this article.</p>
      ) : (
        <>
          <p id="helpful-q">Was this article helpful?</p>
          <div role="group" aria-labelledby="helpful-q" className={s.feedbackButtons}>
            <button type="button" className="btn btn--sm btn--primary" disabled={pending} onClick={() => send(true)}>Yes</button>
            <button type="button" className="btn btn--sm btn--ghost" disabled={pending} onClick={() => send(false)}>No</button>
          </div>
          {state === "error" && <p className={s.muted}>That did not go through. Please try again later.</p>}
        </>
      )}
    </div>
  );
}
