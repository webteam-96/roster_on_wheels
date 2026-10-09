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
import { ArrowLeft, Check, Palette, AlertCircle } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";

// Visual swatches per theme — pure CSS, no API call needed.
// Keys match the slug the public resolver will compute from theme_name.
const THEME_PREVIEW: Record<string, { gradient: string; primary: string; accent: string; ink: string; bg: string; tagline: string; font: string }> = {
  "classic-blue":   { gradient: "from-[#17458F] to-[#1D5BB8]",   primary: "#17458F", accent: "#F7A81B", ink: "#1A1A1A", bg: "#FFFFFF", tagline: "Traditional Rotary navy + gold. Serif headings.",     font: "serif" },
  "modern-minimal": { gradient: "from-[#0F766E] to-[#14B8A6]",   primary: "#0F766E", accent: "#14B8A6", ink: "#111827", bg: "#FAFAFA", tagline: "Off-white, teal accent, ultra-light typography.",   font: "sans-serif" },
  "bold-color":     { gradient: "from-[#E11D48] to-[#FB923C]",   primary: "#E11D48", accent: "#FB923C", ink: "#18181B", bg: "#FFFFFF", tagline: "Vibrant rose→orange. Big bold display headings.",  font: "system-ui" },
  "editorial":      { gradient: "from-[#1F2937] to-[#B91C1C]",   primary: "#1F2937", accent: "#B91C1C", ink: "#111827", bg: "#FBF7F0", tagline: "Newspaper masthead with Playfair serif headings.",  font: "Georgia, serif" },
  "compact-card":   { gradient: "from-[#1E40AF] to-[#06B6D4]",   primary: "#1E40AF", accent: "#06B6D4", ink: "#0F172A", bg: "#F3F4F6", tagline: "Dense tile grid. Built for content-heavy clubs.",   font: "sans-serif" },
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
              Pick the look of your public club website. The switch is instant — the public site refreshes within 5 minutes.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
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
                      <div className="w-full aspect-[16/10] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
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
              All content stays the same — only the look changes. The new theme appears on the public site within ~5 minutes.
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
