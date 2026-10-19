"use client";

/**
 * LoadingLink — Next.js <Link> wrapper that shows an inline spinner
 * while the route transition is in flight.
 *
 * Why: Next App Router transitions can take 300-1500ms (server fetch,
 * RSC payload, hydration). Users click again because nothing visibly
 * happened. This component:
 *   - renders a normal Next Link
 *   - on click, flips local `pending=true`
 *   - clears `pending` when the pathname actually changes OR after a
 *     safety timeout (default 1500ms) in case the click was a same-path
 *     navigation / scroll-to / cancelled
 *   - inserts a spinning Loader2 inline (right of children) while pending
 *   - sets pointer-events:none + aria-disabled while pending so a
 *     second click is swallowed
 *
 * Next 15 ships `useLinkStatus()` which does this natively; this project
 * is on Next 14.2 so we polyfill via usePathname().
 */

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Loader2 } from "@/components/icons";

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

export interface LoadingLinkProps extends LinkProps, AnchorProps {
  children: ReactNode;
  /** Spinner size in px. Default 12. */
  spinnerSize?: number;
  /** Safety timeout (ms) to clear pending if navigation never completes. Default 1500. */
  timeoutMs?: number;
  /** className applied to the underlying <a>. */
  className?: string;
}

export default function LoadingLink({
  children,
  spinnerSize = 12,
  timeoutMs = 1500,
  className,
  onClick,
  href,
  ...rest
}: LoadingLinkProps) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const pendingPathnameRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending when the pathname changes (route transition committed)
  useEffect(() => {
    if (pending && pendingPathnameRef.current !== pathname) {
      setPending(false);
      pendingPathnameRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Respect default-prevented / modifier-key clicks (open in new tab, etc.)
    if (
      e.defaultPrevented ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      (e.button !== undefined && e.button !== 0)
    ) {
      onClick?.(e);
      return;
    }
    if (pending) {
      e.preventDefault();
      return;
    }
    pendingPathnameRef.current = pathname;
    setPending(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPending(false);
      pendingPathnameRef.current = null;
      timerRef.current = null;
    }, timeoutMs);
    onClick?.(e);
  }

  const mergedStyle: React.CSSProperties = {
    ...(rest.style || {}),
    ...(pending ? { pointerEvents: "none", opacity: 0.85 } : {}),
  };

  return (
    <Link
      {...rest}
      href={href}
      onClick={handleClick}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      className={className}
      style={mergedStyle}
    >
      {children}
      {pending && (
        <Loader2
          className="animate-spin inline-block ml-1 align-[-2px]"
          size={spinnerSize}
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
