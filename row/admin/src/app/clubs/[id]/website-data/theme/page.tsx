"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Check, Palette, AlertCircle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ListPageSkeleton } from "@/components/row/AppKit";

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
  // ROW club themes (club-website/src/themes): main colour + accent taken from each theme's own styles.
  "warm-modern":        { gradient: "from-[#7C2D12] to-[#7C2D12]", primary: "#7C2D12", accent: "#F26430", ink: "#2A140A", bg: "#FAF7F2", tagline: "Warm tones, ticket-style events.", font: "Georgia, serif" },
  "civic-bold":         { gradient: "from-[#061634] to-[#061634]", primary: "#061634", accent: "#D4A429", ink: "#061634", bg: "#FBFAF7", tagline: "Bold civic layout.", font: "Arial, sans-serif" },
  "verdigris-ledger":   { gradient: "from-[#3A0E3C] to-[#3A0E3C]", primary: "#3A0E3C", accent: "#901F93", ink: "#3A0E3C", bg: "#F0ECF5", tagline: "Ledger-style editorial layout.", font: "Georgia, serif" },
  "gold":               { gradient: "from-[#09192F] to-[#09192F]", primary: "#09192F", accent: "#E2820C", ink: "#09192F", bg: "#F4E8CE", tagline: "Navy and gold.", font: "Georgia, serif" },
  "cinematic":          { gradient: "from-[#070B1A] to-[#070B1A]", primary: "#070B1A", accent: "#F7A81B", ink: "#070B1A", bg: "#F3F5FB", tagline: "Full-screen imagery.", font: "Arial, sans-serif" },
  "split-story":        { gradient: "from-[#0B2350] to-[#0B2350]", primary: "#0B2350", accent: "#F7A81B", ink: "#0B2350", bg: "#EAF3FC", tagline: "Split-screen storytelling.", font: "Arial, sans-serif" },
  "liquid-motion":      { gradient: "from-[#2A2A33] to-[#2A2A33]", primary: "#2A2A33", accent: "#0067C8", ink: "#2A2A33", bg: "#F6F5F1", tagline: "Smooth motion, calm palette.", font: "Arial, sans-serif" },
  "horizontal-journey": { gradient: "from-[#5E2690] to-[#5E2690]", primary: "#5E2690", accent: "#FF7A3D", ink: "#2A1440", bg: "#FFF7E6", tagline: "A sideways scrolling journey.", font: "Arial, sans-serif" },
  "photo-collage":      { gradient: "from-[#1B2C42] to-[#1B2C42]", primary: "#1B2C42", accent: "#F7A81B", ink: "#1B2C42", bg: "#FCF9F3", tagline: "Photo-led collage layout.", font: "Georgia, serif" },
  "sunrise":            { gradient: "from-[#4B2F86] to-[#4B2F86]", primary: "#4B2F86", accent: "#FFC46B", ink: "#13183A", bg: "#FFF3DE", tagline: "Sunrise colours.", font: "Arial, sans-serif" },
};

function themeKey(themeName: string): string {
  return themeName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function ChangeThemePage() {
  const params = useParams();
  const clubId = Number(params.id);
  const router = useRouter();
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

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
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.message || "Failed to change theme.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => router.push(`/clubs/${clubId}/website-data`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {club ? `${club.clubName} - Theme` : "Theme"}
            </h2>
            <p className="text-muted-foreground text-base">
              Pick the look of your public club website. The switch is instant: the public site refreshes within 5 minutes.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && !hasWebsite && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Club website not created yet</p>
                <p className="text-sm mt-1">
                  Themes can be picked only after a website is created. Ask the SuperAdmin to provision one from{" "}
                  <span className="font-medium">Settings → Club Websites</span>.
                </p>
              </div>
            </div>
          </div>
        )}

        {!loading && hasWebsite && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {themes.map((theme) => {
              const key = themeKey(theme.themeName);
              const preview = THEME_PREVIEW[key];
              const isActive = theme.id === activeThemeId;
              const imageUrl = theme.themeImagePath ? getPhotoUrl(theme.themeImagePath) : null;
              return (
                <Card
                  key={theme.id}
                  className={`overflow-hidden cursor-pointer transition-all border-2 ${
                    isActive
                      ? "border-primary ring-2 ring-primary/20"
                      : canManage ? "border-transparent hover:border-primary/40 hover:shadow-lg" : "border-transparent opacity-80"
                  }`}
                  onClick={() => handleSelect(theme)}
                  role="button"
                  aria-pressed={isActive}
                >
                  <CardContent className="p-0">
                    {/* Preview area */}
                    {imageUrl ? (
                      <div className="relative w-full aspect-[16/10] bg-gray-100">
                        <Image src={imageUrl} alt={theme.themeName} fill className="object-cover" unoptimized />
                      </div>
                    ) : preview ? (
                      <div className={`relative w-full aspect-[16/10] bg-gradient-to-br ${preview.gradient}`}>
                        <div className="absolute inset-0 p-4 flex flex-col justify-between text-white">
                          <div className="text-[10px] font-bold uppercase tracking-[0.25em] opacity-90">{theme.themeName}</div>
                          <div>
                            <div className="text-2xl leading-tight" style={{ fontFamily: preview.font, fontWeight: key === "modern-minimal" ? 300 : 700 }}>
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
                      <div className="w-full aspect-[16/10] bg-gray-100 flex items-center justify-center">
                        <Palette className="h-10 w-10 text-gray-400" />
                      </div>
                    )}

                    <div className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-primary">{theme.themeName}</h3>
                        {isActive && (
                          <Badge variant="default" className="flex items-center gap-1">
                            <Check className="h-3 w-3" />Active
                          </Badge>
                        )}
                      </div>
                      {(theme.description || preview?.tagline) && (
                        <p className="text-xs text-muted-foreground mt-1.5 leading-snug line-clamp-3" title={theme.description || preview?.tagline}>
                          {theme.description || preview?.tagline}
                        </p>
                      )}
                      {preview && (
                        <div className="flex items-center gap-1.5 mt-3" aria-hidden>
                          <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: preview.primary }} title="Primary" />
                          <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: preview.accent }} title="Accent" />
                          <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: preview.ink }} title="Ink" />
                          <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: preview.bg }} title="Background" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">About this theme</span>
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
    </ProtectedRoute>
  );
}
