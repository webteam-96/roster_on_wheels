"use client";

/**
 * Change Theme — v2 single-record page.
 *
 * The theme module is effectively a single-record "which theme is active for
 * this club's public website" picker. There is no separate add/edit subroute —
 * this page IS the destination. Selecting a card opens a confirm modal; on
 * confirm we PUT /api/clubs/{id}/website/active-theme and update local state.
 *
 * v2 changes visuals only — all v1 behavior (theme list, preview swatches,
 * confirm modal, hasWebsite guard, role-based read-only) is preserved.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check, Palette, AlertCircle, Loader2, CheckCircle2, Sparkles, Eye, Lock } from "@/components/icons";
import { Club } from "@/types/club";
import { Theme } from "@/types/theme";
import {
  getClub,
  getThemes,
  getClubActiveTheme,
  setClubActiveTheme,
  getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { SkeletonRows } from "@/components/row/AppKit";

// Visual swatches per theme — pure CSS, no API call needed.
// Keys match the slug the public resolver will compute from theme_name.
const THEME_PREVIEW: Record<string, { gradient: string; primary: string; accent: string; ink: string; bg: string; tagline: string; font: string }> = {
  // Same colours as the club site's theme tokens: Rotary's brand palette only (build spec 3.11).
  "classic-blue":   { gradient: "from-[#17458F] to-[#17458F]",   primary: "#17458F", accent: "#F7A81B", ink: "#0F172A", bg: "#FBFAF7", tagline: "Rotary Royal Blue and Gold. Georgia headings.",          font: "Georgia, serif" },
  "modern-minimal": { gradient: "from-[#0F172A] to-[#1E293B]",   primary: "#0F172A", accent: "#00A2E0", ink: "#0F172A", bg: "#FAFAFA", tagline: "Charcoal with a Rotary Sky Blue accent. Arial throughout.", font: "Arial, sans-serif" },
  "bold-color":     { gradient: "from-[#0067C8] to-[#0067C8]",   primary: "#0067C8", accent: "#F7A81B", ink: "#0F172A", bg: "#F5F5F7", tagline: "Rotary Azure and Gold. Big bold headings.",               font: "Arial, sans-serif" },
  "editorial":      { gradient: "from-[#1F2937] to-[#374151]",   primary: "#1F2937", accent: "#E02927", ink: "#111827", bg: "#FBF7F0", tagline: "Newspaper masthead with a Rotary Cardinal accent.",       font: "Georgia, serif" },
  "compact-card":   { gradient: "from-[#17458F] to-[#17458F]",   primary: "#17458F", accent: "#FF7600", ink: "#1C1917", bg: "#FDF8F0", tagline: "Dense tile grid in Royal Blue and Rotary Orange.",        font: "Arial, sans-serif" },
  "banner":         { gradient: "from-[#17458F] to-[#17458F]",   primary: "#17458F", accent: "#F7A81B", ink: "#0E1B33", bg: "#ECEEF2", tagline: "The club's banner wall: projects hang as pennants.",     font: "sans-serif" },
  "rotaract":       { gradient: "from-[#D41367] to-[#D41367]",   primary: "#D41367", accent: "#F7A81B", ink: "#0E1B33", bg: "#F5F5F8", tagline: "Rotaract template: the banner wall in cranberry.",       font: "sans-serif" },
};

function themeKey(themeName: string): string {
  return themeName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function ChangeThemeV2Page() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const returnTo = searchParams.get("returnTo") || "";
  const defaultBack = `/clubs/${clubId}/website-data`;
  const backHref = returnTo || defaultBack;

  const [club, setClub] = useState<Club | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<number | null>(null);
  const [hasWebsite, setHasWebsite] = useState(true);
  const [loading, setLoading] = useState(true);
  const [confirmTheme, setConfirmTheme] = useState<Theme | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [clubData, themesData, active] = await Promise.all([
          getClub(clubId),
          getThemes(),
          getClubActiveTheme(clubId),
        ]);
        setClub(clubData);
        setThemes(themesData);
        setHasWebsite(active.hasWebsite);
        setActiveThemeId(active.themeId ?? null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [clubId]);

  const handleSelect = (theme: Theme) => {
    if (!canManage || theme.id === activeThemeId) return;
    setConfirmTheme(theme);
  };

  const handleConfirm = async () => {
    if (!confirmTheme) return;
    setSaving(true);
    try {
      await setClubActiveTheme(clubId, confirmTheme.id);
      setActiveThemeId(confirmTheme.id);
      setSuccessMessage(`Theme switched to ${confirmTheme.themeName}. Changes appear on the public site within ~5 minutes (cache refresh).`);
      setConfirmTheme(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setErrorMessage(e?.response?.data?.message || e?.message || "Failed to change theme.");
    } finally {
      setSaving(false);
    }
  };

  const activeTheme = useMemo(
    () => themes.find((t) => t.id === activeThemeId) || null,
    [themes, activeThemeId]
  );

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Theme"
        pageSubtitle="Public website theme"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <div className="space-y-5">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link
              href={backHref}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">
                {club ? `${club.clubName}: Theme` : "Theme"}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Pick the look of your public club website. The switch is instant: the public site refreshes within ~5 minutes.
              </p>
            </div>
          </div>
          {!loading && hasWebsite && activeTheme && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 size={12} /> Active: {activeTheme.themeName}
            </span>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <SkeletonRows />
        )}

        {/* No website yet — banner */}
        {!loading && !hasWebsite && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">Club website not created yet</p>
                <p className="text-xs mt-1">
                  Themes can be picked only after a website is created. Ask the SuperAdmin to provision one from{" "}
                  <span className="font-medium">Settings → Club Websites</span>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Read-only banner for non-managers */}
        {!loading && hasWebsite && !canManage && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> Read only. Only SuperAdmin or Admin can change the theme.
            </span>
          </div>
        )}

        {/* Theme gallery */}
        {!loading && hasWebsite && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-blue-50">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Choose a theme</h3>
                <p className="text-xs text-slate-500">
                  {themes.length} theme{themes.length === 1 ? "" : "s"} available · click a card to switch
                </p>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {themes.map((theme) => {
                const key = themeKey(theme.themeName);
                const preview = THEME_PREVIEW[key];
                const isActive = theme.id === activeThemeId;
                const imageUrl = theme.themeImagePath ? getPhotoUrl(theme.themeImagePath) : null;
                const clickable = canManage && !isActive;
                return (
                  <div
                    key={theme.id}
                    onClick={() => handleSelect(theme)}
                    role={clickable ? "button" : undefined}
                    aria-pressed={isActive}
                    tabIndex={clickable ? 0 : -1}
                    onKeyDown={(e) => {
                      if (clickable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        handleSelect(theme);
                      }
                    }}
                    className={[
                      "group rounded-xl overflow-hidden border-2 transition-all bg-white",
                      isActive
                        ? "border-blue-500 ring-2 ring-blue-100 shadow-sm"
                        : clickable
                        ? "border-slate-200 hover:border-blue-300 hover:shadow-md cursor-pointer"
                        : "border-slate-200 opacity-80 cursor-default",
                    ].join(" ")}
                  >
                    {/* Preview area */}
                    {imageUrl ? (
                      <div className="relative w-full aspect-[16/10] bg-slate-100">
                        <Image src={imageUrl} alt={theme.themeName} fill className="object-cover" unoptimized />
                      </div>
                    ) : preview ? (
                      <div className={`relative w-full aspect-[16/10] bg-gradient-to-br ${preview.gradient}`}>
                        <div className="absolute inset-0 p-4 flex flex-col justify-between text-white">
                          <div className="text-[10px] font-bold uppercase tracking-[0.25em] opacity-90">{theme.themeName}</div>
                          <div>
                            <div
                              className="text-2xl leading-tight"
                              style={{ fontFamily: preview.font, fontWeight: key === "modern-minimal" ? 300 : 700 }}
                            >
                              {club?.clubName || "Rotary Club"}
                            </div>
                            <div className="flex items-center gap-1.5 mt-2">
                              <span className="h-2 w-8 rounded" style={{ backgroundColor: preview.accent }} />
                              <span className="h-2 w-12 rounded bg-white/40" />
                              <span className="h-2 w-6 rounded bg-white/40" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full aspect-[16/10] bg-slate-100 flex items-center justify-center">
                        <Palette className="h-10 w-10 text-slate-400" />
                      </div>
                    )}

                    {/* Meta */}
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-800 truncate">{theme.themeName}</h3>
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                            <Check size={11} /> Active
                          </span>
                        ) : clickable ? (
                          <span className="hidden group-hover:inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                            <Eye size={11} /> Switch
                          </span>
                        ) : null}
                      </div>
                      {(theme.description || preview?.tagline) && (
                        <p
                          className="text-xs text-slate-500 mt-1.5 leading-snug line-clamp-3"
                          title={theme.description || preview?.tagline}
                        >
                          {theme.description || preview?.tagline}
                        </p>
                      )}
                      {preview && (
                        <div className="flex items-center gap-1.5 mt-3" aria-hidden>
                          <span
                            className="h-4 w-4 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: preview.primary }}
                            title="Primary"
                          />
                          <span
                            className="h-4 w-4 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: preview.accent }}
                            title="Accent"
                          />
                          <span
                            className="h-4 w-4 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: preview.ink }}
                            title="Ink"
                          />
                          <span
                            className="h-4 w-4 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: preview.bg }}
                            title="Background"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer note */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
              <span>
                Theme changes apply to the public club website. Content (members, projects, events) stays the same.
              </span>
              <span className="text-slate-400">Cache refresh ~5 min</span>
            </div>
          </div>
        )}

        <AlertModal
          open={!!confirmTheme}
          onOpenChange={(o) => !o && !saving && setConfirmTheme(null)}
          icon={Palette}
          title="Switch theme?"
          description={
            <>
              The public website will switch to{" "}
              <span className="font-semibold text-foreground">{confirmTheme?.themeName}</span>.
              All content stays the same. Only the look changes. The new theme appears on the public site within ~5 minutes.
              {(() => {
                if (!confirmTheme) return null;
                const blurb = confirmTheme.description || THEME_PREVIEW[themeKey(confirmTheme.themeName)]?.tagline;
                if (!blurb) return null;
                return (
                  <span className="block mt-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground/80">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      About this theme
                    </span>
                    {blurb}
                  </span>
                );
              })()}
            </>
          }
          confirmLabel={saving ? "Switching..." : "Switch theme"}
          onConfirm={handleConfirm}
          cancelLabel="Cancel"
          onCancel={() => !saving && setConfirmTheme(null)}
        />
      </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
