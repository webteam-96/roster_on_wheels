"use client";

/**
 * District Admin Dashboard: My District Website · Theme (2026-11-23)
 * -----------------------------------------------------------------
 * Picks which of the seven district website themes the public site uses
 * (district_websites.theme_key; none chosen = Ether). The site root reads it
 * from /api/public/district/by-host and opens /<theme>/.
 *
 * Same shell as the sibling pages: districtId from useAuth().selectedDistrictId,
 * Back honours ?returnTo= and forwards ?yearId=, yearless data so changing it
 * needs current-year rights (canEditYearless), like About and Menu List.
 */

import { Card } from "@/components/ui/card";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Palette, AlertTriangle } from "@/components/icons";
import { getDistrict, getDistrictWebsiteTheme, updateDistrictWebsiteTheme } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { districtYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";

// Keys match DistrictWebsiteThemes.Keys on the API and the folders under row/district-website/.
const THEMES: { key: string; name: string; description: string }[] = [
  { key: "ether",   name: "Ether",   description: "Highlights shown as a stack of cards beside the advertisement." },
  { key: "prism",   name: "Prism",   description: "Split screen: the banner on the left, district details on the right." },
  { key: "orbit",   name: "Orbit",   description: "Full-width banner, with the advertisement as a popup once per visit." },
  { key: "tide",    name: "Tide",    description: "The banner stays in place while each section slides up over it." },
  { key: "transit", name: "Transit", description: "A full-screen banner, then About arrives whole as visitors scroll." },
  { key: "cascade", name: "Cascade", description: "Two banners side by side, each new one sweeping in on a slant." },
  { key: "kinetic", name: "Kinetic", description: "Every banner the district has, rising in turn on a timer." },
];

const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function DistrictAdminWebsiteThemePage() {
  const { isSuperAdmin, isAdmin, selectedDistrictId, user } = useAuth();
  const districtId = selectedDistrictId ?? 0;

  const searchParams = useSearchParams();
  const router = useRouter();
  const returnTo = searchParams.get("returnTo");
  const currentYearId = searchParams.get("yearId");

  const goBack = () => {
    const dest = returnTo || "/district-admin-dashboard/my-district-website";
    if (!currentYearId) { router.push(dest); return; }
    const sep = dest.includes("?") ? "&" : "?";
    router.push(`${dest}${sep}yearId=${encodeURIComponent(currentYearId)}`);
  };

  const { years: rotaryYears, currentYearId: siteCurrentYearId } = useRotaryYears();
  const siteRights = useMemo(() => districtYearRights(user?.scopedRoles, districtId), [user?.scopedRoles, districtId]);
  const canManage = (isSuperAdmin || isAdmin) && canEditYearless(siteRights, siteCurrentYearId, isSuperAdmin);
  const currentYearLabel = rotaryYears.find((y) => y.id === siteCurrentYearId)?.yearLabel ?? "";

  const [districtName, setDistrictName] = useState("");
  const [hasWebsite, setHasWebsite] = useState(true);
  const [savedKey, setSavedKey] = useState("ether");
  const [selectedKey, setSelectedKey] = useState("ether");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!districtId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [d, t] = await Promise.all([getDistrict(districtId), getDistrictWebsiteTheme(districtId)]);
      setDistrictName(`District ${d.districtNumber}`);
      setHasWebsite(t.hasWebsite);
      setSavedKey(t.themeKey);
      setSelectedKey(t.themeKey);
    } catch (err) {
      setLoadError(apiMessage(err, "Could not load the website theme."));
    } finally {
      setLoading(false);
    }
  }, [districtId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await updateDistrictWebsiteTheme(districtId, selectedKey);
      setSavedKey(res.themeKey);
      setSelectedKey(res.themeKey);
      const name = THEMES.find((t) => t.key === res.themeKey)?.name ?? res.themeKey;
      setSuccessMessage(`The public website now uses the ${name} theme.`);
    } catch (err) {
      setErrorMessage(apiMessage(err, "Could not save the website theme."));
    } finally {
      setSaving(false);
    }
  };

  if (!districtId) return null;

  const editable = canManage && hasWebsite;
  const dirty = selectedKey !== savedKey;

  return (
    <ProtectedRoute>
      {!canManage && <ViewOnlyBadge currentYearOnly={currentYearLabel} className="mb-4" />}

      <div className="space-y-5">
        <SuccessAlert open={!!successMessage} title="Saved" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <PageHeader title={districtName ? `${districtName} · Website Theme` : "Website Theme"} description="The look of your public district website. Content stays the same in every theme." back={() => goBack()} />

        {loading && <SkeletonRows rows={7} />}

        {!loading && loadError && (
          <Card className="p-5 flex items-start gap-3" role="alert">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-3">
              <p className="text-sm text-slate-700">{loadError}</p>
              <Button variant="outline" size="sm" onClick={load}>Try again</Button>
            </div>
          </Card>
        )}

        {!loading && !loadError && (
          <>
            {!canManage && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <Lock size={12} /> Read only. Only SuperAdmin or Admin can change the website theme.
                </span>
              </div>
            )}
            {!hasWebsite && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                This district has no website yet. A theme can be chosen once SuperAdmin sets one up.
              </div>
            )}

            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-azure/5">
                <div className="w-9 h-9 rounded-lg bg-azure/10 text-ink flex items-center justify-center">
                  <Palette size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Choose a theme</p>
                  <p className="text-[11px] text-slate-500">Visitors see the change on their next visit.</p>
                </div>
              </div>

              <div role="radiogroup" aria-label="Website theme" className="divide-y divide-slate-100">
                {THEMES.map((t) => {
                  const checked = selectedKey === t.key;
                  return (
                    <label
                      key={t.key}
                      className={`flex items-start gap-3 px-5 py-3 ${editable ? "cursor-pointer hover:bg-slate-50" : "cursor-default"} ${checked ? "bg-azure/5" : ""}`}
                    >
                      <input
                        type="radio"
                        name="district-website-theme"
                        value={t.key}
                        checked={checked}
                        disabled={!editable || saving}
                        onChange={() => setSelectedKey(t.key)}
                        className="mt-1 h-4 w-4 accent-[#17458f]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                          {t.key === savedKey && (
                            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                              Current
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">{t.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Card>

            {editable && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedKey(savedKey)} disabled={!dirty || saving}>Cancel</Button>
                <Button onClick={save} disabled={!dirty || saving}>{saving ? "Saving..." : "Save"}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
