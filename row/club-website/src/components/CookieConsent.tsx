"use client";

import { useEffect, useState } from "react";
import { CONSENT_EVENT, OPEN_SETTINGS_EVENT, consentCookie, readConsent, type Consent } from "@/lib/consent";

function save(value: Consent) {
  document.cookie = consentCookie(value, location.protocol === "https:");
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

/** Banner shown until the visitor chooses; reopened from the footer "Cookie settings" link. */
export default function CookieConsent({ privacyUrl }: { privacyUrl: string | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readConsent(document.cookie) === null);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, reopen);
  }, []);

  if (!open) return null;
  const choose = (v: Consent) => {
    save(v);
    setOpen(false);
  };

  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie settings"
      className="cookie-bar fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white p-4 sm:p-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-700">
          This site uses only the cookies it needs to work. The map is provided by Google and sets its own
          cookies, so it loads only if you allow it.
          {privacyUrl && (
            <>
              {" "}
              <a href={privacyUrl} className="font-semibold underline">Privacy policy</a>
            </>
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("essential")}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800">
            Essential only
          </button>
          <button type="button" onClick={() => choose("all")}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white">
            Allow all
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer link that reopens the banner. */
export function CookieSettingsButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" className={`underline ${className}`}
      onClick={() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))}>
      Cookie settings
    </button>
  );
}

/** Renders `children` (a third-party embed) only after "Allow all"; otherwise `fallback`. */
export function ConsentGate({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(readConsent(document.cookie) === "all");
    const onChange = (e: Event) => setAllowed((e as CustomEvent<Consent>).detail === "all");
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);
  return <>{allowed ? children : fallback}</>;
}
