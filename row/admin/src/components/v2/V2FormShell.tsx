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

import { useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Save, X, Send } from "lucide-react";
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
  /** Color classes for the primary Save button. Defaults to the generic blue used
   *  across most v2 forms; pass brand classes to match a section's theme (e.g. the
   *  Foundation pages use the gold #F7A81B / navy #1e3a5f dashboard accent). */
  saveTone?: string;
}

// Default primary-button tone — generic v2 blue. Overridable per-page via `saveTone`.
const SAVE_TONE_DEFAULT = "bg-blue-600 text-white hover:bg-blue-700";

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
  saveTone = SAVE_TONE_DEFAULT,
}: V2FormShellProps) {
  const params = useSearchParams();
  const returnTo = params.get("returnTo") || "";
  const cancelHref = returnTo || defaultBack;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Link
            href={cancelHref}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Back"
          >
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </div>

      {banner && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          {banner}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5 pb-8">
        {children}
      </div>

      {!hideFooter && (
      <div className="sticky bottom-0 flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
        {footerStart && (
          <div className="flex flex-wrap items-center gap-2">{footerStart}</div>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          {!hideCancel && (
            <Link
              href={cancelHref}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-[15px] font-semibold text-slate-700 hover:bg-slate-100"
            >
              <X size={17} /> Cancel
            </Link>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled || saving}
              title={secondaryAction.disabled ? "Install the Add-to-Org extension to use this" : undefined}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-[15px] font-bold text-blue-950 shadow-sm ring-1 ring-amber-500/50 hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:ring-0"
            >
              <Send size={17} />
              {secondaryAction.label}
            </button>
          )}
          <LoadingButton
            type="button"
            onAction={onSave}
            forcePending={saving}
            loadingLabel="Saving…"
            spinnerSize={17}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[15px] font-bold shadow-sm disabled:opacity-50 ${saveTone}`}
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
