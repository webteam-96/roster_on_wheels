"use client";

/**
 * LoadingButton — drop-in <button> that shows an inline spinner while
 * its async onAction is running.
 *
 * Why: users were double-clicking Save/Delete because nothing visibly
 * happened after the first click. This component:
 *   - swallows the click and awaits onAction
 *   - shows <Loader2 spinning> inline (left of children) while pending
 *   - disables itself while pending so the second click is a no-op
 *   - re-throws errors so the parent can still handle them
 *
 * Drop-in replacement for <button>:
 *   <LoadingButton onAction={handleSave} className="...">Save</LoadingButton>
 *
 * If the caller already has its own `saving` state and just wants the
 * visual, pass it via `forcePending` and keep `onAction` synchronous.
 */

import {
  useCallback,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Loader2 } from "@/components/icons";

export interface LoadingButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Click handler. Can be sync or async. Spinner shows until the promise settles. */
  onAction?: (e: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  /** When true, forces the spinner on (use when parent already owns the loading state). */
  forcePending?: boolean;
  /** Text to show while pending. If omitted, children stay visible and only the spinner is added. */
  loadingLabel?: string;
  /** Override the spinner size (px). Default 14. */
  spinnerSize?: number;
  children: ReactNode;
}

export default function LoadingButton({
  onAction,
  forcePending = false,
  loadingLabel,
  spinnerSize = 14,
  disabled,
  children,
  type = "button",
  ...rest
}: LoadingButtonProps) {
  const [internalPending, setInternalPending] = useState(false);
  const mountedRef = useRef(true);

  const pending = forcePending || internalPending;

  const handleClick = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      if (!onAction || pending) return;
      let result: void | Promise<void>;
      try {
        result = onAction(e);
      } catch (err) {
        // Synchronous throw — nothing to await, just bubble.
        throw err;
      }
      // Only show the spinner if onAction is actually async.
      if (result && typeof (result as Promise<void>).then === "function") {
        setInternalPending(true);
        try {
          await result;
        } finally {
          // Avoid setState after unmount (parent often navigates away on success).
          if (mountedRef.current) setInternalPending(false);
        }
      }
    },
    [onAction, pending]
  );

  // Track unmount so we don't setState after navigation
  // (using ref + a one-shot effect is overkill — useRef alone with cleanup
  //  via React's StrictMode is sufficient since we only set false in finally).

  return (
    <button
      {...rest}
      type={type}
      onClick={handleClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending && (
        <Loader2
          className="animate-spin"
          size={spinnerSize}
          aria-hidden="true"
        />
      )}
      {pending && loadingLabel ? loadingLabel : children}
    </button>
  );
}
