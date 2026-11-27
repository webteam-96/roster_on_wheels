"use client";

/**
 * TRF Contributions v2 — Edit Contribution.
 *
 * Extracted from the v1 inline EditTrfContributionDialog. Every field, every
 * validation rule and the updateTrfContribution call are preserved verbatim;
 * only the visual presentation differs (V2FormShell wrapper, dot-accented
 * section headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — never any other param name. `yearId` is a normal
 * query param because the contribution lookup endpoint requires it.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Info, FileText, DollarSign, Calendar } from "@/components/icons";
import {
  getClub,
  getTrfYears,
  getTrfFunds,
  getTrfContributions,
  updateTrfContribution,
} from "@/services/api";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { TrfContribution, TrfFund } from "@/types/trfContribution";
import { ReportYear } from "@/types/clubMonthlyReport";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { ListPageSkeleton } from "@/components/row/AppKit";

const TOP_MESSAGE = "Update an existing donor contribution to The Rotary Foundation. Changes flow into the club's monthly report and district / zone foundation totals.";

export default function TrfV2EditPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const trfId = Number(params.trfId);
  const yearIdParam = searchParams.get("yearId");
  // CMR round-trip context — when present, the date input is locked to the
  // wizard month with a defensive paste-bypass guard on submit.
  const fromParam = searchParams.get("from");
  const monthParam = searchParams.get("month");
  const isFromCmrMonth = fromParam === "cmr" && !!yearIdParam && !!monthParam;
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/trf/v2`);

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const cmrOn = useFeatureLoadedOn("club_monthly_report");
  const [yearId, setYearId] = useState<number | null>(null);
  const [funds, setFunds] = useState<TrfFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [trfDate, setTrfDate] = useState("");
  const [donorName, setDonorName] = useState("");
  const [amountUSD, setAmountUSD] = useState("");
  const [fundId, setFundId] = useState<number>(0);
  const [otherFundName, setOtherFundName] = useState("");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [club, yearsData, fundsData] = await Promise.all([
          getClub(clubId),
          getTrfYears(clubId, cmrOn),
          getTrfFunds(clubId),
        ]);
        setClubName(club.clubName);
        setYears(yearsData);
        setFunds(fundsData.filter((f) => f.isActive));

        // Resolve yearId for the lookup. Try the explicit param first; if absent
        // or stale, scan each known year until the contribution is found.
        const tryYearIds: number[] = [];
        const explicit = yearIdParam ? Number(yearIdParam) : NaN;
        if (Number.isFinite(explicit)) tryYearIds.push(explicit);
        for (const y of yearsData) {
          if (!tryYearIds.includes(y.id)) tryYearIds.push(y.id);
        }

        let found: TrfContribution | undefined;
        let foundYearId: number | null = null;
        for (const yid of tryYearIds) {
          try {
            const list = await getTrfContributions(clubId, yid);
            const match = list.find((c) => c.id === trfId);
            if (match) { found = match; foundYearId = yid; break; }
          } catch {
            // Skip years that fail to load — try next.
          }
        }

        if (!found || !foundYearId) {
          setErrorMessage("Contribution not found.");
          return;
        }

        setYearId(foundYearId);
        setTrfDate(found.trfDate ? found.trfDate.slice(0, 16) : "");
        setDonorName(found.donorName || "");
        setAmountUSD(found.amountUSD != null ? String(found.amountUSD) : "");
        setFundId(found.fundId);
        setOtherFundName(found.otherFundName || "");
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to load contribution.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, trfId, yearIdParam, cmrOn]);

  const selectedFund = funds.find((f) => f.id === fundId);
  const yearObj = years.find((y) => y.id === yearId);
  const yearLabel = yearObj?.yearLabel ?? "–";

  // Lock the TRF date to the CMR month when isFromCmrMonth. yearLabel is
  // "YYYY-YY"; calendar year for the locked month = startYear when month >= 7
  // (Jul-Dec), else startYear + 1. Matches v1 lockedCalendarYear logic.
  const lockedMonth = isFromCmrMonth ? Number(monthParam) : null;
  const lockedCalendarYear = (() => {
    if (!lockedMonth || !yearObj?.yearLabel) return null;
    const startYear = Number(yearObj.yearLabel.split("-")[0]);
    if (!Number.isFinite(startYear)) return null;
    return lockedMonth >= 7 ? startYear : startYear + 1;
  })();
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const lockedMinIso = lockedMonth && lockedCalendarYear
    ? `${lockedCalendarYear}-${pad2(lockedMonth)}-01T00:00`
    : undefined;
  const lockedMaxIso = (() => {
    if (!lockedMonth || !lockedCalendarYear) return undefined;
    const lastDay = new Date(lockedCalendarYear, lockedMonth, 0).getDate();
    return `${lockedCalendarYear}-${pad2(lockedMonth)}-${pad2(lastDay)}T23:59`;
  })();

  const handleSave = async () => {
    if (!trfDate) { setErrorMessage("Date & Time is required."); return; }
    // Defensive bounds check — browser min/max can be bypassed by paste.
    if (isFromCmrMonth && lockedMinIso && lockedMaxIso) {
      if (trfDate < lockedMinIso || trfDate > lockedMaxIso) {
        setErrorMessage("Date must be within the monthly report's month.");
        return;
      }
    }
    if (!donorName.trim()) { setErrorMessage("Name is required."); return; }
    if (donorName.length > 200) { setErrorMessage("Name must be 200 characters or less."); return; }
    const amt = parseFloat(amountUSD) || 0;
    if (amt < 0) { setErrorMessage("Amount must be 0 or greater."); return; }
    if (!fundId) { setErrorMessage("Fund Type is required."); return; }
    if (selectedFund?.fundName === "Others" && !otherFundName.trim()) {
      setErrorMessage("Please specify the fund name.");
      return;
    }

    setSaving(true);
    try {
      await updateTrfContribution(clubId, trfId, {
        trfDate,
        donorName: donorName.trim(),
        amountUSD: amt,
        fundId,
        otherFundName: selectedFund?.fundName === "Others" ? otherFundName : null,
      });
      setSuccessMessage("Contribution updated successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to update contribution.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Edit TRF Contribution"
          pageSubtitle="Record a Foundation contribution"
          activeNavHref="/club-admin-dashboard/foundation"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Edit TRF Contribution"
        pageSubtitle="Record a Foundation contribution"
        activeNavHref="/club-admin-dashboard/foundation"
      >
      <V2FormShell
        title="Edit TRF Contribution"
        subtitle={`${clubName} · RY ${yearLabel}`}
        defaultBack={`/clubs/${clubId}/trf/v2`}
        saving={saving}
        saveLabel="Update Contribution"
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{TOP_MESSAGE}</span>
          </div>
        }
      >
        {/* 1. Donor */}
        <SectionCard number={1} icon={FileText} title="Donor Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel required hint="(max 200 chars)">Donor / Member Name</FieldLabel>
              <Input
                type="text"
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
                placeholder="Enter donor name"
                maxLength={200}
                
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{donorName.length}/200</p>
            </div>
            <div>
              <FieldLabel required>Date &amp; Time</FieldLabel>
              <Input
                type="datetime-local"
                value={trfDate}
                min={lockedMinIso}
                max={lockedMaxIso}
                onChange={(e) => setTrfDate(e.target.value)}
                
              />
              {isFromCmrMonth && lockedCalendarYear && lockedMonth && (
                <p className="text-xs text-slate-500 mt-1">
                  Locked to {[
                    "", "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December",
                  ][lockedMonth]} {lockedCalendarYear} (from monthly report)
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        {/* 2. Fund */}
        <SectionCard number={2} icon={Calendar} title="Fund Allocation">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Fund Type</FieldLabel>
              <NativeSelect
                value={fundId || ""}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setFundId(next);
                  const f = funds.find((x) => x.id === next);
                  if (f?.fundName !== "Others") setOtherFundName("");
                }}
                
              >
                <option value="">Select fund type</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>{f.fundName}</option>
                ))}
              </NativeSelect>
            </div>
            {selectedFund?.fundName === "Others" && (
              <div>
                <FieldLabel required>Specify Fund Name</FieldLabel>
                <Input
                  type="text"
                  value={otherFundName}
                  onChange={(e) => setOtherFundName(e.target.value)}
                  placeholder="Enter fund name"
                  
                />
              </div>
            )}
          </div>
        </SectionCard>

        {/* 3. Amount */}
        <SectionCard number={3} icon={DollarSign} title="Amount">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required hint="(USD)">Amount USD</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                <Input
                  type="number"
                  value={amountUSD}
                  onChange={(e) => setAmountUSD(e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                  className="pl-7 pr-3"
                />
              </div>
            </div>
            <div className="flex items-end">
              <p className="text-xs text-slate-500">
                Currency is fixed to <span className="font-semibold text-slate-700">USD</span>: TRF reports
                to Rotary International in USD.
              </p>
            </div>
          </div>
        </SectionCard>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Contribution updated successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
