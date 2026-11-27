"use client";

/**
 * V2FormShell — shared scaffolding for every v2 Add / Edit page.
 *
 * Responsibilities:
 *   - Read `?returnTo=` once via useSearchParams.
 *   - Render a consistent page header (title, subtitle, back button).
 *   - Render a sticky-bottom action row with Cancel + primary button.
 *   - Expose `navigateAfterSave()` that the form's submit handler calls on
 *     success. If `returnTo` is present → push it. Otherwise push the
 *     `defaultBack` fallback (the v2 listing for that module).
 *
 * Used by every v2 form. Single source of truth so changes (icon, label,
 * disabled state) propagate everywhere.
 */

import { Button } from "@/components/ui/button";
import { useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Save, X, Send } from "@/components/icons";
import { PageHeader } from "@/components/row/AppKit";
import LoadingButton from "./LoadingButton";

export interface V2FormShellProps {
  title: string;
  subtitle?: string;
  defaultBack: string;
  children: ReactNode;
  banner?: ReactNode;
  saving?: boolean;
  saveLabel?: string;
  onSave: () => void;
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  /** Optional content rendered left-aligned at the start of the sticky footer. */
  footerStart?: ReactNode;
  /** Hide the footer Cancel link (e.g. Add pages that confirm via a dialog and keep
   *  only a single Save action; the header back arrow still lets users leave). */
  hideCancel?: boolean;
  /** Hide the entire sticky footer (Save/Cancel bar). Use when a nested editor renders
   *  its own action buttons, so the page doesn't show two competing Save bars. */
  hideFooter?: boolean;
  /** Kept for existing callers: the Save button has one colour. */
  saveTone?: string;
}

export function useV2ReturnTo(defaultBack: string) {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = useMemo(() => params.get("returnTo") || "", [params]);

  const navigateAfterSave = useCallback(() => {
    // Show the global navigation overlay for this programmatic push (no anchor click to detect).
    if (typeof window !== "undefined") window.dispatchEvent(new Event("nav-loader:show"));
    // The back arrow / Cancel link visible on every add/edit page points at this
    // same URL, so Next.js has usually already prefetched it into the Router
    // Cache before the user finishes the form. Without refresh(), push() reuses
    // that stale pre-save render and the listing below doesn't show what was
    // just saved until a hard reload.
    router.refresh();
    if (returnTo) router.push(returnTo);
    else router.push(defaultBack);
  }, [router, returnTo, defaultBack]);

  const navigateAfterCancel = useCallback(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("nav-loader:show"));
    if (returnTo) router.push(returnTo);
    else router.push(defaultBack);
  }, [router, returnTo, defaultBack]);

  return { returnTo, navigateAfterSave, navigateAfterCancel };
}

export default function V2FormShell({
  title,
  subtitle,
  defaultBack,
  children,
  banner,
  saving = false,
  saveLabel = "Save",
  onSave,
  secondaryAction,
  footerStart,
  hideCancel = false,
  hideFooter = false,
}: V2FormShellProps) {
  const params = useSearchParams();
  const returnTo = params.get("returnTo") || "";
  const cancelHref = returnTo || defaultBack;

  return (
    <div className="space-y-5">
      <PageHeader title={title} description={subtitle} back={cancelHref} />

      {banner && (
        <div className="rounded-md border border-[color:var(--row-line)] bg-muted px-4 py-2 text-[13px] text-muted-foreground">
          {banner}
        </div>
      )}

      <div className="row-rise">
        {children}
      </div>

      {!hideFooter && (
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[color:var(--row-line)] bg-background px-4 py-3 md:-mx-8 md:px-8">
        {footerStart && (
          <div className="flex flex-wrap items-center gap-2">{footerStart}</div>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {!hideCancel && (
            <Link
              href={cancelHref}
              className="row-btn row-btn-secondary"
            >
              <X size={17} /> Cancel
            </Link>
          )}
          {secondaryAction && (
            <Button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled || saving}
              title={secondaryAction.disabled ? "Install the Add-to-Org extension to use this" : undefined}
              variant="outline"
            >
              <Send size={17} />
              {secondaryAction.label}
            </Button>
          )}
          <LoadingButton
            type="button"
            onAction={onSave}
            forcePending={saving}
            loadingLabel="Saving…"
            spinnerSize={17}
            className="row-btn row-btn-primary"
          >
            {!saving && <Save size={17} />}
            {saveLabel}
          </LoadingButton>
        </div>
      </div>
      )}
    </div>
  );
}
