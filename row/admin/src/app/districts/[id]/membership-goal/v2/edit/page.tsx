"use client";

/**
 * District Membership Goal v2 — Edit form.
 *
 * Wave 13D scaffold for the District Admin "Set Goal" action that sits on the
 * Membership dashboard. One row per (district, rotary year) — upsert on save.
 *
 * Path:    /districts/[id]/membership-goal/v2/edit
 * Returns: ?returnTo overrides the default back target (defaults to the DA
 *          Membership dashboard).
 * Year:    ?yearId=N forces a specific RY (used when the dashboard links the
 *          currently-selected year). Otherwise we default to the current RY
 *          from getRotaryYears().
 *
 * Backend:
 *   GET  /api/district-admin-dashboard/membership-goal?districtId=&yearId=
 *   POST /api/district-admin-dashboard/membership-goal      (upsert)
 *
 *   Current Total is fetched from the dashboard summary (district-admin-dashboard
 *   /membership). The DistrictMembershipGoalDto does not carry a currentTotal
 *   column; the dashboard's totalMembers is the live count for the resolved
 *   district + RY context.
 *
 *   A 403 from POST means the signed-in member is not an active District Admin
 *   at this district — we surface the API message directly.
 *
 * URL sync: useSyncDistrictIdFromUrl pushes the URL's [id] into AuthContext so
 * the sidebar district indicator and any other consumers stay aligned.
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Target, Users, UserPlus, Percent, Calendar } from "@/components/icons";
import {
  getDistrictMembershipGoal,
  saveDistrictMembershipGoal,
  getDistrictAdminMembership,
  getRotaryYears,
} from "@/services/api";
import { RotaryYear } from "@/types/rotaryYear";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import DistrictAdminShell from "@/components/v2/DistrictAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncDistrictIdFromUrl } from "@/hooks/useSyncDistrictIdFromUrl";

const DEFAULT_BACK = "/district-admin-dashboard/membership";

function FieldLabel({
  children, hint, dot, required = false,
}: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 mb-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function DistrictMembershipGoalV2EditPage() {
  useSyncDistrictIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const districtId = Number(params.id);
  const yearIdParam = Number(searchParams.get("yearId") || "0");

  const { navigateAfterSave } = useV2ReturnTo(DEFAULT_BACK);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const [allYears, setAllYears] = useState<RotaryYear[]>([]);
  const [districtNumber, setDistrictNumber] = useState<string>("");
  const [yearLabel, setYearLabel] = useState<string>("");
  const [currentTotal, setCurrentTotal] = useState<number | null>(null);

  // Form fields
  const [selectedYearId, setSelectedYearId] = useState<number>(0);
  const [targetTotal, setTargetTotal] = useState<string>("");
  const [targetNewMembers, setTargetNewMembers] = useState<string>("");
  const [targetRetentionPercent, setTargetRetentionPercent] = useState<string>("");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  // ── Initial bootstrap: years + dashboard context ─────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [years, membership] = await Promise.all([
          getRotaryYears(),
          // Dashboard fetch is best-effort — gives us districtNumber + yearLabel
          // for header context and currentTotal for the read-only field.
          getDistrictAdminMembership(undefined, districtId).catch(() => null),
        ]);
        if (cancelled) return;

        setAllYears(years);
        if (membership) {
          setDistrictNumber(membership.district.districtNumber);
          setYearLabel(membership.district.yearLabel);
          setCurrentTotal(membership.totalMembers ?? 0);
        }

        // Resolve initial year: explicit ?yearId param > membership.yearLabel
        // match > the rotary-year-master current flag.
        let initialYearId = 0;
        if (yearIdParam > 0 && years.some((y) => y.id === yearIdParam)) {
          initialYearId = yearIdParam;
        } else if (membership?.district.yearLabel) {
          const match = years.find((y) => y.yearLabel === membership.district.yearLabel);
          if (match) initialYearId = match.id;
        }
        if (!initialYearId) {
          const current = years.find((y) => y.isCurrent);
          if (current) initialYearId = current.id;
        }
        if (initialYearId) setSelectedYearId(initialYearId);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } }; message?: string };
        if (!cancelled) setBootError(e?.response?.data?.message || e?.message || "Failed to load goal page.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (Number.isFinite(districtId) && districtId > 0) {
      init();
    } else {
      setBootError("Invalid district id in URL.");
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [districtId, yearIdParam]);

  // ── Year change → load existing goal row (or reset to blank) ─────────
  useEffect(() => {
    let cancelled = false;
    if (!selectedYearId || !districtId) return;

    async function loadGoal() {
      try {
        const goal = await getDistrictMembershipGoal(districtId, selectedYearId);
        if (cancelled) return;
        if (goal) {
          setTargetTotal(String(goal.targetTotal ?? ""));
          setTargetNewMembers(String(goal.targetNewMembers ?? ""));
          setTargetRetentionPercent(
            goal.targetRetentionPercent != null ? String(goal.targetRetentionPercent) : "",
          );
        } else {
          // No row yet for this RY — start blank.
          setTargetTotal("");
          setTargetNewMembers("");
          setTargetRetentionPercent("");
        }
      } catch (err: unknown) {
        // 403 here means the user isn't allowed to even read; surface it.
        const e = err as { response?: { data?: { message?: string }; status?: number } };
        if (!cancelled) {
          setErrorMessage(
            e?.response?.data?.message
              ?? (e?.response?.status === 403
                ? "You do not have permission to view this goal."
                : "Failed to load existing goal."),
          );
        }
      }
    }
    loadGoal();
    return () => { cancelled = true; };
  }, [districtId, selectedYearId]);

  // ── Save ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedYearId) {
      setErrorMessage("Please select a rotary year.");
      return;
    }
    const tt = parseInt(targetTotal, 10);
    const tn = parseInt(targetNewMembers, 10);
    const tr = parseFloat(targetRetentionPercent);

    if (!Number.isFinite(tt) || tt < 0) {
      setErrorMessage("Target Total Members must be a non-negative whole number.");
      return;
    }
    if (!Number.isFinite(tn) || tn < 0) {
      setErrorMessage("Target New Members must be a non-negative whole number.");
      return;
    }
    if (!Number.isFinite(tr) || tr < 0 || tr > 100) {
      setErrorMessage("Target Retention % must be between 0 and 100.");
      return;
    }

    setSaving(true);
    try {
      await saveDistrictMembershipGoal({
        fkDistrictId: districtId,
        fkYearId: selectedYearId,
        targetTotal: tt,
        targetNewMembers: tn,
        targetRetentionPercent: tr,
      });
      setSuccessMessage("Membership goal saved successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const anyErr = err as {
        response?: { data?: { message?: string } | string; status?: number };
        message?: string;
      };
      const apiMsg =
        (typeof anyErr.response?.data === "object" && anyErr.response?.data?.message) ||
        (typeof anyErr.response?.data === "string" ? anyErr.response.data : undefined) ||
        anyErr.message ||
        "Failed to save.";
      const prefix =
        anyErr.response?.status === 403
          ? "Permission denied: "
          : "";
      setErrorMessage(prefix + apiMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Set Membership Goal"
          activeNavHref="/district-admin-dashboard/membership"
        >
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  if (bootError) {
    return (
      <ProtectedRoute>
        <DistrictAdminShell
          pageTitle="Set Membership Goal"
          activeNavHref="/district-admin-dashboard/membership"
        >
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {bootError}
          </div>
        </DistrictAdminShell>
      </ProtectedRoute>
    );
  }

  const subtitleParts: string[] = [];
  if (districtNumber) subtitleParts.push(`District ${districtNumber}`);
  if (yearLabel) subtitleParts.push(`RY ${yearLabel}`);
  const subtitle = subtitleParts.join(" · ");

  return (
    <ProtectedRoute>
      <DistrictAdminShell
        pageTitle="Set Membership Goal"
        pageSubtitle="Define this RY's district membership target"
        activeNavHref="/district-admin-dashboard/membership"
      >
        <V2FormShell
          title="Set Membership Goal"
          subtitle={subtitle || undefined}
          defaultBack={DEFAULT_BACK}
          saving={saving}
          saveLabel="Save Goal"
          onSave={handleSave}
        >
          {/* 1. Rotary year ── */}
          <SectionCard number={1} icon={Calendar} title="Rotary Year" dot="bg-amber-500">
            <FieldLabel dot="bg-amber-500" required>Rotary Year</FieldLabel>
            <select
              value={selectedYearId || ""}
              onChange={(e) => setSelectedYearId(Number(e.target.value))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select rotary year…</option>
              {allYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Goals are stored one row per (district, year). Switching the year
              loads the saved values for that RY (if any).
            </p>
          </SectionCard>

          {/* 2. Current Total (read-only) ── */}
          <SectionCard number={2} icon={Users} title="Current Standing" dot="bg-blue-600">
            <FieldLabel dot="bg-blue-500">Current Total Members</FieldLabel>
            <input
              type="text"
              readOnly
              value={currentTotal == null ? "–" : currentTotal.toLocaleString()}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Live district-wide member count from the dashboard.
            </p>
          </SectionCard>

          {/* 3. Targets ── */}
          <SectionCard number={3} icon={Target} title="Membership Targets" dot="bg-emerald-600">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel dot="bg-emerald-500" required>Target Total Members</FieldLabel>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={targetTotal}
                  onChange={(e) => setTargetTotal(e.target.value)}
                  placeholder="e.g. 1200"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <FieldLabel dot="bg-emerald-500" required>
                  <span className="inline-flex items-center gap-1">
                    <UserPlus size={11} className="text-slate-400" /> Target New Members
                  </span>
                </FieldLabel>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={targetNewMembers}
                  onChange={(e) => setTargetNewMembers(e.target.value)}
                  placeholder="e.g. 150"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel dot="bg-emerald-500" required hint="(0–100)">
                  <span className="inline-flex items-center gap-1">
                    <Percent size={11} className="text-slate-400" /> Target Retention %
                  </span>
                </FieldLabel>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  inputMode="decimal"
                  value={targetRetentionPercent}
                  onChange={(e) => setTargetRetentionPercent(e.target.value)}
                  placeholder="e.g. 92.5"
                  className="w-full sm:max-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </SectionCard>
        </V2FormShell>

        <SuccessAlert
          open={showSuccessDialog}
          title="Goal Saved"
          description={successMessage || ""}
          onOk={() => {
            setShowSuccessDialog(false);
            navigateAfterSave();
          }}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </DistrictAdminShell>
    </ProtectedRoute>
  );
}
