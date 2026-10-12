"use client";

import { useEffect, useRef } from "react";

/* The live site's key (domain-locked to example.org) is used on production
 * builds; everywhere else Google's official always-pass TEST key keeps the
 * widget functional on localhost. Override with NEXT_PUBLIC_RECAPTCHA_SITE_KEY. */
const LIVE_KEY = "6LdVpUUqAAAAAPzyZVYm5DKDyugGPBJf1d4ESOxM";
const TEST_KEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
const SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ??
  (process.env.NODE_ENV === "production" ? LIVE_KEY : TEST_KEY);

type Grecaptcha = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    }
  ) => number;
  reset: (widgetId?: number) => void;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    onRecaptchaApiLoad?: () => void;
  }
}

/**
 * Google reCAPTCHA v2 checkbox — the same verification the live
 * Potential_member.aspx form uses. Reports the verification token (or null
 * when it expires) to the parent; expose the widget id via `widgetIdRef` so
 * the form can reset the widget after a successful submit.
 */
export function ReCaptcha({
  onToken,
  widgetIdRef,
}: {
  onToken: (token: string | null) => void;
  widgetIdRef?: React.MutableRefObject<number | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  // Keep the latest callback without re-rendering the widget.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    const renderWidget = () => {
      const host = hostRef.current;
      if (!host || renderedRef.current || !window.grecaptcha?.render) return;
      if (host.hasChildNodes()) return; // already rendered into this node
      renderedRef.current = true;
      const id = window.grecaptcha.render(host, {
        sitekey: SITE_KEY,
        theme: "light",
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
      if (widgetIdRef) widgetIdRef.current = id;
    };

    if (window.grecaptcha?.render) {
      renderWidget();
      return;
    }
    // Chain onto any previously-registered onload so multiple mounts coexist.
    const prev = window.onRecaptchaApiLoad;
    window.onRecaptchaApiLoad = () => {
      prev?.();
      renderWidget();
    };
    if (!document.querySelector('script[src*="recaptcha/api.js"]')) {
      const s = document.createElement("script");
      s.src =
        "https://www.google.com/recaptcha/api.js?onload=onRecaptchaApiLoad&render=explicit";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  }, [widgetIdRef]);

  return (
    <div>
      <div ref={hostRef} className="min-h-[78px]" />
      <noscript>
        <p className="mt-2 text-xs text-ink/60">
          Please enable JavaScript to complete the captcha.
        </p>
      </noscript>
    </div>
  );
}
