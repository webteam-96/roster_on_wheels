"use client";
// Report download progress INSIDE the clicked button (user 2026-11-13).
// While a report downloads, the button's label is replaced by a small progress bar + %, and comes back when done.
// Only one report at a time per page: `busy` is true while any download runs, so every report button can be disabled.
//
// The server first builds the whole file - that time cannot be measured, so the bar moves on an estimate up to 85%,
// then shows the real transfer of the file. Every blob request made through services/api.ts while a download runs
// reports its transfer here (see the interceptor there), so the api functions themselves need no change.
import { useCallback, useEffect, useRef, useState } from "react";

type Listener = (fraction: number) => void;
let current: Listener | null = null;
/** Used by the axios interceptor in services/api.ts. */
export const downloadProgressListener = () => current;

export function useDownloadProgress() {
  const [active, setActive] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => () => { stop(); current = null; }, []);

  /** Runs one download with progress on the button `key`. Ignored while another download is running. */
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, slow = false): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setActive(key);
    setPct(3);
    stop();
    timer.current = setInterval(() => setPct((p) => (p < 85 ? p + (85 - p) * (slow ? 0.02 : 0.06) : p)), 500);
    current = (f) => setPct((p) => Math.max(p, 85 + 15 * f));
    let ok = false;
    try {
      const r = await fn();
      ok = true;
      return r;
    } finally {
      stop();
      current = null;
      if (ok) {
        setPct(100);
        await new Promise((res) => setTimeout(res, 600));
      }
      busyRef.current = false;
      setActive(null);
      setPct(0);
    }
  }, []);

  /** True while this button's download runs. */
  const is = (key: string) => active === key;

  /** The progress bar shown in place of the button label. */
  const bar = (key: string, color = "bg-blue-600") => {
    const v = active === key ? Math.min(100, Math.round(pct)) : 0;
    return (
      <span className="flex w-full min-w-[90px] items-center gap-2" role="status" aria-live="polite">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <span className={`block h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${v}%` }} />
        </span>
        <span className="tabular-nums text-xs">{v}%</span>
      </span>
    );
  };

  return { busy: active !== null, active, is, run, bar };
}
