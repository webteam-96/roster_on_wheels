"use client";

import { useEffect, useState } from "react";
import { detectExtension } from "@/lib/addToOrg";

/**
 * Tracks whether the "Add to Org" browser extension is installed.
 * Re-checks whenever the tab regains focus / becomes visible, so a user who
 * installs the extension and returns to the form sees the status flip without a
 * full reload.
 *
 * @returns null while checking, true if installed, false if not.
 */
export function useExtensionStatus(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = () => {
      detectExtension().then((v) => { if (active) setInstalled(v); });
    };
    check();

    const onFocus = () => check();
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return installed;
}
