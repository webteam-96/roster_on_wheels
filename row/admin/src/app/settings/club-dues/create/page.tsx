"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getDistricts, getClubs, getRazorpayRouteAccounts, getRotaryYears, createClubDues, updateClubDues, getClubDuesDetail, getClubDuesAllClubVendors, sendClubDuesTestEmail, clubDuesAssetUrl, RazorpayRouteAccount } from "@/services/api";
import { DistrictListItem } from "@/types/district";
import { ClubListItem } from "@/types/club";
import { RotaryYear } from "@/types/rotaryYear";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronsUpDown, Check, Plus, X, Save, Upload } from "@/components/icons";
import EmailTokenChips, { CLUB_DUES_RECEIPT_TOKENS, CLUB_DUES_REMINDER_TOKENS } from "@/components/club-dues/EmailTokenChips";

import { currencySymbol } from "@/lib/appFormat";
// forwardedRef-capable dynamic import so we can reach the Quill editor to insert tokens at the cursor.
const ReactQuill = dynamic(async () => {
  const { default: RQ } = await import("react-quill-new");
  const Comp = ({ forwardedRef, ...props }: any) => <RQ ref={forwardedRef} {...props} />;
  Comp.displayName = "ReactQuillWithRef";
  return Comp;
}, { ssr: false });

// Insert `token` at the Quill cursor (or append if the editor ref isn't ready / exposes no editor).
function insertQuillToken(ref: React.MutableRefObject<any>, setter: (fn: (v: string) => string) => void, token: string) {
  const q = ref.current?.getEditor?.();
  if (q) {
    const range = q.getSelection(true) || { index: q.getLength(), length: 0 };
    q.insertText(range.index, token, "user");
    q.setSelection(range.index + token.length, 0);
  } else {
    setter((v) => (v || "") + token);
  }
}

const STEP_LABELS = ["Basic Info", "Payment & Split", "Club List", "Images & Email"];

interface VendorRow { routeAccountId: string; value: string }

function CreateClubDuesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("edit");
  const { isSuperAdmin } = useAuth();

  const totalSteps = STEP_LABELS.length;
  const [currentStep, setCurrentStep] = useState(0);

  const [districts, setDistricts] = useState<DistrictListItem[]>([]);
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [routeAccounts, setRouteAccounts] = useState<RazorpayRouteAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // Step 1 — Basic Info
  const [districtId, setDistrictId] = useState("");
  const [districtOpen, setDistrictOpen] = useState(false);
  const [rotaryYear, setRotaryYear] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeDescription, setPurposeDescription] = useState("");

  // Step 2 — Payment & Split
  const [rate, setRate] = useState("");
  const [onlineSurcharge, setOnlineSurcharge] = useState("0"); // % added on top for ONLINE payments only
  const [modeOfPayment, setModeOfPayment] = useState("3"); // 1=Online, 2=Offline, 3=Both
  const [approverEmail, setApproverEmail] = useState("");
  const [showBankInReceipt, setShowBankInReceipt] = useState(false);
  const [amountType, setAmountType] = useState("2"); // 1=amount, 2=percentage
  const [vendorRows, setVendorRows] = useState<VendorRow[]>([{ routeAccountId: "", value: "" }]);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");

  // Step 2 — Payment & Split (INDEPENDENT mode: RateModel=1). New campaigns are always independent;
  // legacy campaigns (edit mode, RateModel=0) keep using the combined fields above, untouched.
  const [rateModel, setRateModel] = useState<"0" | "1">("1");
  const [onlineRate, setOnlineRate] = useState("");
  const [offlineRate, setOfflineRate] = useState("");
  const [onlineVendorRows, setOnlineVendorRows] = useState<VendorRow[]>([{ routeAccountId: "", value: "" }]);
  const [offlineVendorRows, setOfflineVendorRows] = useState<VendorRow[]>([{ routeAccountId: "", value: "" }]);

  // Step 3 — Club List (per-club rate overrides)
  const [clubsList, setClubsList] = useState<ClubListItem[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubOverrides, setClubOverrides] = useState<Record<number, string>>({});
  const [clubSplits, setClubSplits] = useState<Record<number, Record<string, string>>>({});
  // Step 3 — INDEPENDENT mode per-club overrides (separate online/offline rate + split).
  const [clubOnlineOverrides, setClubOnlineOverrides] = useState<Record<number, string>>({});
  const [clubOfflineOverrides, setClubOfflineOverrides] = useState<Record<number, string>>({});
  const [clubOnlineSplits, setClubOnlineSplits] = useState<Record<number, Record<string, string>>>({});
  const [clubOfflineSplits, setClubOfflineSplits] = useState<Record<number, Record<string, string>>>({});

  // Step 4 — Images & Email
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);
  const [existingLogo, setExistingLogo] = useState("");
  const [existingBg, setExistingBg] = useState("");
  const [existingEmailLogo, setExistingEmailLogo] = useState("");
  const [emailCC, setEmailCC] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReminderSubject, setEmailReminderSubject] = useState("");
  const [emailReminderBody, setEmailReminderBody] = useState("");
  const [reminderButtonText, setReminderButtonText] = useState("");
  const [googleSheetEmail, setGoogleSheetEmail] = useState("support@example.org");
  const emailBodyRef = useRef<any>(null);
  const emailReminderBodyRef = useRef<any>(null);

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Test-email send (inline feedback so it never triggers the SuccessAlert's navigate-away).
  const [testEmail, setTestEmail] = useState("");
  const [testBusy, setTestBusy] = useState<"reminder" | "receipt" | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sendTest = async (type: "reminder" | "receipt") => {
    setTestMsg(null);
    if (!testEmail.trim() || !testEmail.includes("@")) { setTestMsg({ ok: false, text: "Enter a valid email address." }); return; }
    if (!districtId) { setTestMsg({ ok: false, text: "Select a district (Basic Info step) first." }); return; }
    setTestBusy(type);
    try {
      const res = await sendClubDuesTestEmail({
        email: testEmail.trim(), type, districtId: Number(districtId), duesId: editId ? Number(editId) : 0,
        subject: type === "reminder" ? emailReminderSubject : emailSubject,
        body: type === "reminder" ? emailReminderBody : emailBody,
        buttonText: type === "reminder" ? reminderButtonText : undefined,
        showBank: showBankInReceipt, bankName, accountNumber, ifsc,
        emailLogo: emailLogoFile, // just-picked (unsaved) header logo, embedded inline for a true preview
      });
      setTestMsg({ ok: true, text: res.message });
    } catch (e: any) { setTestMsg({ ok: false, text: e?.response?.data?.message || "Failed to send test email." }); }
    finally { setTestBusy(null); }
  };

  const quillModules = useRef({
    toolbar: {
      container: [
        ["bold", "italic", "underline"],
        [{ header: [1, 2, 3, false] }],
        [{ size: [] }],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ align: [] }],
        ["link"],
        ["clean"],
      ],
    },
  }).current;

  const isOnline = modeOfPayment === "1" || modeOfPayment === "3";
  const isOffline = modeOfPayment === "2" || modeOfPayment === "3";

  const filledRows = vendorRows.filter((r) => r.routeAccountId && Number(r.value) > 0);
  const splitTotal = vendorRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const splitTarget = amountType === "2" ? 100 : Number(rate) || 0;
  const splitOk = filledRows.length === 0 || Math.abs(splitTotal - splitTarget) < 0.01;
  const selectedVendors = vendorRows.filter((r) => r.routeAccountId);  // vendor columns for the Club List

  const updateRow = (i: number, field: keyof VendorRow, value: string) =>
    setVendorRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const addRow = () => setVendorRows((rows) => [...rows, { routeAccountId: "", value: "" }]);
  const removeRow = (i: number) => setVendorRows((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));
  const updateClubSplit = (clubId: number, accId: string, value: string) =>
    setClubSplits((prev) => {
      const cur = prev[clubId] ?? Object.fromEntries(selectedVendors.map((sv) => [sv.routeAccountId, sv.value]));
      return { ...prev, [clubId]: { ...cur, [accId]: value } };
    });

  // Per-club split balance: target − sum(splits). Target = 100 (percentage) or the club's rate (amount).
  const clubRate = (c: ClubListItem) => Number(clubOverrides[c.id] ?? rate) || 0;
  const clubSplitSum = (c: ClubListItem) =>
    selectedVendors.reduce((s, sv) => s + (Number(clubSplits[c.id]?.[sv.routeAccountId] ?? sv.value) || 0), 0);
  const clubBalance = (c: ClubListItem) => (amountType === "2" ? 100 : clubRate(c)) - clubSplitSum(c);
  const clubBalanced = (c: ClubListItem) => Math.abs(clubBalance(c)) < 0.01;

  // ── INDEPENDENT mode (RateModel=1) — Online and Offline are fully separate tracks, each with its
  // own rate + split, mirroring the legacy helpers above one-for-one but parametrized per channel.
  const independent = rateModel === "1";
  const onlineFilledRows = onlineVendorRows.filter((r) => r.routeAccountId && Number(r.value) > 0);
  const onlineSplitTotal = onlineVendorRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const onlineSplitTarget = amountType === "2" ? 100 : Number(onlineRate) || 0;
  const onlineSplitOk = onlineFilledRows.length === 0 || Math.abs(onlineSplitTotal - onlineSplitTarget) < 0.01;
  const selectedOnlineVendors = onlineVendorRows.filter((r) => r.routeAccountId);

  const offlineFilledRows = offlineVendorRows.filter((r) => r.routeAccountId && Number(r.value) > 0);
  const offlineSplitTotal = offlineVendorRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const offlineSplitTarget = amountType === "2" ? 100 : Number(offlineRate) || 0;
  const offlineSplitOk = offlineFilledRows.length === 0 || Math.abs(offlineSplitTotal - offlineSplitTarget) < 0.01;
  const selectedOfflineVendors = offlineVendorRows.filter((r) => r.routeAccountId);

  const updateOnlineRow = (i: number, field: keyof VendorRow, value: string) =>
    setOnlineVendorRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const addOnlineRow = () => setOnlineVendorRows((rows) => [...rows, { routeAccountId: "", value: "" }]);
  const removeOnlineRow = (i: number) => setOnlineVendorRows((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const updateOfflineRow = (i: number, field: keyof VendorRow, value: string) =>
    setOfflineVendorRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const addOfflineRow = () => setOfflineVendorRows((rows) => [...rows, { routeAccountId: "", value: "" }]);
  const removeOfflineRow = (i: number) => setOfflineVendorRows((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const updateClubOnlineSplit = (clubId: number, accId: string, value: string) =>
    setClubOnlineSplits((prev) => {
      const cur = prev[clubId] ?? Object.fromEntries(selectedOnlineVendors.map((sv) => [sv.routeAccountId, sv.value]));
      return { ...prev, [clubId]: { ...cur, [accId]: value } };
    });
  const updateClubOfflineSplit = (clubId: number, accId: string, value: string) =>
    setClubOfflineSplits((prev) => {
      const cur = prev[clubId] ?? Object.fromEntries(selectedOfflineVendors.map((sv) => [sv.routeAccountId, sv.value]));
      return { ...prev, [clubId]: { ...cur, [accId]: value } };
    });

  const clubOnlineRate = (c: ClubListItem) => Number(clubOnlineOverrides[c.id] ?? onlineRate) || 0;
  const clubOnlineSplitSum = (c: ClubListItem) =>
    selectedOnlineVendors.reduce((s, sv) => s + (Number(clubOnlineSplits[c.id]?.[sv.routeAccountId] ?? sv.value) || 0), 0);
  const clubOnlineBalance = (c: ClubListItem) => (amountType === "2" ? 100 : clubOnlineRate(c)) - clubOnlineSplitSum(c);
  const clubOnlineBalanced = (c: ClubListItem) => Math.abs(clubOnlineBalance(c)) < 0.01;

  const clubOfflineRate = (c: ClubListItem) => Number(clubOfflineOverrides[c.id] ?? offlineRate) || 0;
  const clubOfflineSplitSum = (c: ClubListItem) =>
    selectedOfflineVendors.reduce((s, sv) => s + (Number(clubOfflineSplits[c.id]?.[sv.routeAccountId] ?? sv.value) || 0), 0);
  const clubOfflineBalance = (c: ClubListItem) => (amountType === "2" ? 100 : clubOfflineRate(c)) - clubOfflineSplitSum(c);
  const clubOfflineBalanced = (c: ClubListItem) => Math.abs(clubOfflineBalance(c)) < 0.01;

  useEffect(() => {
    (async () => {
      try {
        const [d, y, k] = await Promise.all([getDistricts(1, 400), getRotaryYears(), getRazorpayRouteAccounts(true)]);
        const sortedDistricts = [...d.items].sort((a, b) => {
          const na = parseInt(a.districtNumber ?? "", 10), nb = parseInt(b.districtNumber ?? "", 10);
          if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
          return (a.districtNumber ?? "").localeCompare(b.districtNumber ?? "");
        });
        setDistricts(sortedDistricts);
        setYears(y);
        setRouteAccounts(k.filter((x) => x.isActive && ["activated", "active"].includes((x.status || "").toLowerCase())));
        if (editId) {
          const det = await getClubDuesDetail(Number(editId));
          setDistrictId(String(det.fkDistrictId));
          setRotaryYear(det.rotaryYear || "");
          setPurpose(det.purpose || "");
          setPurposeDescription(det.purposeDescription || "");
          const rm = det.rateModel === 1 ? "1" : "0";
          setRateModel(rm);
          setRate(det.defaultPerMemberRate != null ? String(det.defaultPerMemberRate) : "");
          setOnlineSurcharge(det.onlineSurchargePercent != null ? String(det.onlineSurchargePercent) : "0");
          setOnlineRate(det.onlinePerMemberRate != null ? String(det.onlinePerMemberRate) : "");
          setOfflineRate(det.offlinePerMemberRate != null ? String(det.offlinePerMemberRate) : "");
          setModeOfPayment(det.modeOfPayment ? String(det.modeOfPayment) : "3");
          setApproverEmail(det.approverEmail || "");
          setShowBankInReceipt(!!det.isShowBankInReceipt);
          setBankName(det.offlineBankName || "");
          setAccountNumber(det.offlineAccountNumber || "");
          setIfsc(det.offlineIfscCode || "");
          setEmailCC(det.emailCC || "");
          setEmailSubject(det.emailSubject || "");
          setEmailBody(det.emailBody || "");
          setEmailReminderSubject(det.emailReminderSubject || "");
          setEmailReminderBody(det.emailReminderBody || "");
          setReminderButtonText(det.reminderButtonText || "");
          setGoogleSheetEmail(det.googleSheetEmail || "support@example.org");
          setExistingLogo(det.purposeLogo || "");
          setExistingBg(det.backgroundImage || "");
          setExistingEmailLogo(det.emailHeaderLogo || "");
          const at = det.amountType ? String(det.amountType) : "2";
          setAmountType(at);
          if (det.vendors && det.vendors.length > 0) {
            if (rm === "1") {
              const onlineV = det.vendors.filter((v: any) => v.isOnline !== false);
              const offlineV = det.vendors.filter((v: any) => v.isOnline === false);
              if (onlineV.length > 0) setOnlineVendorRows(onlineV.map((v: any) => ({
                routeAccountId: String(v.fkRouteAccountId),
                value: at === "1" ? String(v.splitAmount ?? "") : String(v.splitPercentage ?? ""),
              })));
              if (offlineV.length > 0) setOfflineVendorRows(offlineV.map((v: any) => ({
                routeAccountId: String(v.fkRouteAccountId),
                value: at === "1" ? String(v.splitAmount ?? "") : String(v.splitPercentage ?? ""),
              })));
            } else {
              setVendorRows(det.vendors.map((v: any) => ({
                routeAccountId: String(v.fkRouteAccountId),
                value: at === "1" ? String(v.splitAmount ?? "") : String(v.splitPercentage ?? ""),
              })));
            }
          }
        }
      } catch (e: any) {
        setError(e?.response?.data?.message || "Failed to load form data.");
      } finally {
        setReady(true);
      }
    })();
    /* eslint-disable-next-line */
  }, []);

  // Load the district's clubs when the Club List step is reached.
  useEffect(() => {
    if (currentStep === 2 && districtId && clubsList.length === 0) {
      (async () => {
        setClubsLoading(true);
        try {
          const res = await getClubs(1, 2000, undefined, Number(districtId));
          setClubsList(res.items);
          if (independent) {
            setClubOnlineOverrides((prev) => {
              const next = { ...prev };
              res.items.forEach((c) => { if (next[c.id] == null) next[c.id] = onlineRate; });
              return next;
            });
            setClubOfflineOverrides((prev) => {
              const next = { ...prev };
              res.items.forEach((c) => { if (next[c.id] == null) next[c.id] = offlineRate; });
              return next;
            });
          } else {
            setClubOverrides((prev) => {
              const next = { ...prev };
              res.items.forEach((c) => { if (next[c.id] == null) next[c.id] = rate; });
              return next;
            });
          }
          if (editId) {
            try {
              const cv: any[] = await getClubDuesAllClubVendors(Number(editId));
              if (independent) {
                const onlineMap: Record<number, Record<string, string>> = {};
                const offlineMap: Record<number, Record<string, string>> = {};
                cv.forEach((v) => {
                  const target = v.isOnline === false ? offlineMap : onlineMap;
                  if (!target[v.fkClubId]) target[v.fkClubId] = {};
                  target[v.fkClubId][String(v.fkRouteAccountId)] = amountType === "1" ? String(v.splitAmount ?? "") : String(v.splitPercentage ?? "");
                });
                setClubOnlineSplits(onlineMap);
                setClubOfflineSplits(offlineMap);
              } else {
                const map: Record<number, Record<string, string>> = {};
                cv.forEach((v) => {
                  if (!map[v.fkClubId]) map[v.fkClubId] = {};
                  map[v.fkClubId][String(v.fkRouteAccountId)] = amountType === "1" ? String(v.splitAmount ?? "") : String(v.splitPercentage ?? "");
                });
                setClubSplits(map);
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ } finally { setClubsLoading(false); }
      })();
    }
    /* eslint-disable-next-line */
  }, [currentStep, districtId]);

  const validateStep = (step: number): string | null => {
    if (step === 0) {
      if (!districtId) return "Select a district.";
      if (!rotaryYear) return "Select the rotary year.";
    }
    if (step === 1) {
      if (independent) {
        if (isOffline && (!offlineRate || Number(offlineRate) <= 0)) return "Enter an offline per-member rate.";
        if (isOnline && (!onlineRate || Number(onlineRate) <= 0)) return "Enter an online per-member rate.";
        if (isOnline && onlineFilledRows.length > 0) {
          if (amountType === "2" && Math.abs(onlineSplitTotal - 100) > 0.01) return "Online percentage split must total exactly 100%.";
          if (amountType === "1" && Math.abs(onlineSplitTotal - Number(onlineRate)) > 0.01) return `Online amount split must total exactly the online rate (${currencySymbol()}${onlineRate}).`;
        }
        if (isOffline && offlineFilledRows.length > 0) {
          if (amountType === "2" && Math.abs(offlineSplitTotal - 100) > 0.01) return "Offline percentage split must total exactly 100%.";
          if (amountType === "1" && Math.abs(offlineSplitTotal - Number(offlineRate)) > 0.01) return `Offline amount split must total exactly the offline rate (${currencySymbol()}${offlineRate}).`;
        }
      } else {
        if (!rate || Number(rate) <= 0) return "Enter a per-member rate.";
        if (isOnline && filledRows.length > 0) {
          if (amountType === "2" && Math.abs(splitTotal - 100) > 0.01) return "Percentage split must total exactly 100%.";
          if (amountType === "1" && Math.abs(splitTotal - Number(rate)) > 0.01) return `Amount split must total exactly the per-member rate (${currencySymbol()}${rate}).`;
        }
      }
    }
    if (step === 2) {
      if (independent) {
        if (selectedOnlineVendors.length > 0) {
          const bad = clubsList.find((c) => !clubOnlineBalanced(c));
          if (bad) return `"${bad.clubName}" online split is off by ${amountType === "2" ? `${clubOnlineBalance(bad)}%` : `${currencySymbol()}${clubOnlineBalance(bad)}`}. Every club's online balance must be 0 before continuing.`;
        }
        if (selectedOfflineVendors.length > 0) {
          const bad = clubsList.find((c) => !clubOfflineBalanced(c));
          if (bad) return `"${bad.clubName}" offline split is off by ${amountType === "2" ? `${clubOfflineBalance(bad)}%` : `${currencySymbol()}${clubOfflineBalance(bad)}`}. Every club's offline balance must be 0 before continuing.`;
        }
      } else if (selectedVendors.length > 0) {
        const bad = clubsList.find((c) => !clubBalanced(c));
        if (bad) return `"${bad.clubName}" split is off by ${amountType === "2" ? `${clubBalance(bad)}%` : `${currencySymbol()}${clubBalance(bad)}`}. Every club's balance must be 0 (${amountType === "2" ? "splits total 100%" : "splits total the club rate"}) before continuing.`;
      }
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep(currentStep);
    if (err) { setError(err); return; }
    if (currentStep < totalSteps - 1) setCurrentStep(currentStep + 1);
    else submit();
  };
  const handleBack = () => { if (currentStep > 0) setCurrentStep(currentStep - 1); };

  const submit = async () => {
    for (let s = 0; s < totalSteps; s++) { const err = validateStep(s); if (err) { setCurrentStep(s); setError(err); return; } }

    let vendorsPayload: any[] | null = null;
    let offlineVendorsPayload: any[] | null = null;
    let overrides: any[];

    if (independent) {
      if (isOnline && onlineFilledRows.length > 0) {
        const rateNum = Number(onlineRate) || 0;
        vendorsPayload = onlineFilledRows.map((r, i) => {
          const acc = routeAccounts.find((x) => x.id === Number(r.routeAccountId));
          const val = Number(r.value);
          return {
            fkRouteAccountId: Number(r.routeAccountId), accountId: acc?.accountId || "",
            splitPercentage: amountType === "2" ? val : (rateNum > 0 ? (val / rateNum) * 100 : 0),
            splitAmount: amountType === "1" ? val : 0, isDefault: i === 0,
          };
        });
      }
      if (isOffline && offlineFilledRows.length > 0) {
        const rateNum = Number(offlineRate) || 0;
        offlineVendorsPayload = offlineFilledRows.map((r, i) => {
          const acc = routeAccounts.find((x) => x.id === Number(r.routeAccountId));
          const val = Number(r.value);
          return {
            fkRouteAccountId: Number(r.routeAccountId), accountId: acc?.accountId || "",
            splitPercentage: amountType === "2" ? val : (rateNum > 0 ? (val / rateNum) * 100 : 0),
            splitAmount: amountType === "1" ? val : 0, isDefault: i === 0,
          };
        });
      }
      // Per-club overrides: send a club only if either rate differs from the campaign default OR it
      // has a custom vendor split, for either channel.
      overrides = clubsList.map((c) => {
        const onlineVal = clubOnlineOverrides[c.id] ?? onlineRate;
        const offlineVal = clubOfflineOverrides[c.id] ?? offlineRate;
        const onlineNum = Number(onlineVal) || 0;
        const offlineNum = Number(offlineVal) || 0;
        const onlineChanged = Number(onlineVal) !== Number(onlineRate);
        const offlineChanged = Number(offlineVal) !== Number(offlineRate);
        const hasOnlineSplit = clubOnlineSplits[c.id] != null;
        const hasOfflineSplit = clubOfflineSplits[c.id] != null;
        if (!onlineChanged && !offlineChanged && !hasOnlineSplit && !hasOfflineSplit) return null;
        const entry: any = { fkClubId: c.id, onlinePerMemberRate: onlineNum, offlinePerMemberRate: offlineNum };
        if (hasOnlineSplit) {
          entry.onlineVendors = selectedOnlineVendors.map((sv) => {
            const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
            const val = Number(clubOnlineSplits[c.id]?.[sv.routeAccountId] ?? sv.value) || 0;
            return {
              fkRouteAccountId: Number(sv.routeAccountId), accountId: acc?.accountId || "",
              splitPercentage: amountType === "2" ? val : (onlineNum > 0 ? (val / onlineNum) * 100 : 0),
              splitAmount: amountType === "1" ? val : 0,
            };
          }).filter((v: any) => v.splitPercentage > 0 || v.splitAmount > 0);
        }
        if (hasOfflineSplit) {
          entry.offlineVendors = selectedOfflineVendors.map((sv) => {
            const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
            const val = Number(clubOfflineSplits[c.id]?.[sv.routeAccountId] ?? sv.value) || 0;
            return {
              fkRouteAccountId: Number(sv.routeAccountId), accountId: acc?.accountId || "",
              splitPercentage: amountType === "2" ? val : (offlineNum > 0 ? (val / offlineNum) * 100 : 0),
              splitAmount: amountType === "1" ? val : 0,
            };
          }).filter((v: any) => v.splitPercentage > 0 || v.splitAmount > 0);
        }
        return entry;
      }).filter(Boolean) as any[];
    } else {
      if (isOnline && filledRows.length > 0) {
        const rateNum = Number(rate) || 0;
        vendorsPayload = filledRows.map((r, i) => {
          const acc = routeAccounts.find((x) => x.id === Number(r.routeAccountId));
          const val = Number(r.value);
          return {
            fkRouteAccountId: Number(r.routeAccountId),
            accountId: acc?.accountId || "",
            splitPercentage: amountType === "2" ? val : (rateNum > 0 ? (val / rateNum) * 100 : 0),
            splitAmount: amountType === "1" ? val : 0,
            isDefault: i === 0,
          };
        });
      }
      // Per-club overrides: send a club only if its rate differs from the campaign default OR it has a
      // custom vendor split. Amount-mode splits are converted to a % of the club's rate for the backend.
      overrides = clubsList
        .map((c) => {
          const rateVal = clubOverrides[c.id] ?? rate;
          const rateNum = Number(rateVal) || 0;
          const rateChanged = Number(rateVal) !== Number(rate);
          const hasSplit = clubSplits[c.id] != null;
          if (!rateChanged && !hasSplit) return null;
          const entry: any = { fkClubId: c.id, perMemberRate: rateNum };
          if (hasSplit) {
            entry.vendors = selectedVendors.map((sv) => {
              const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
              const val = Number(clubSplits[c.id]?.[sv.routeAccountId] ?? sv.value) || 0;
              return {
                fkRouteAccountId: Number(sv.routeAccountId),
                accountId: acc?.accountId || "",
                splitPercentage: amountType === "2" ? val : (rateNum > 0 ? (val / rateNum) * 100 : 0),
                splitAmount: amountType === "1" ? val : 0,
              };
            }).filter((v: any) => v.splitPercentage > 0 || v.splitAmount > 0);
          }
          return entry;
        })
        .filter(Boolean) as any[];
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("FkDistrictId", districtId);
      fd.append("RotaryYear", rotaryYear);
      fd.append("Purpose", purpose);
      fd.append("PurposeDescription", purposeDescription);
      fd.append("DefaultPerMemberRate", independent ? "0" : rate);
      fd.append("OnlineSurchargePercent", independent ? "0" : (onlineSurcharge || "0"));
      fd.append("RateModel", rateModel);
      fd.append("OnlinePerMemberRate", independent ? (onlineRate || "0") : "0");
      fd.append("OfflinePerMemberRate", independent ? (offlineRate || "0") : "0");
      fd.append("AmountType", amountType);
      fd.append("ModeOfPayment", modeOfPayment);
      fd.append("ApproverEmail", isOffline ? approverEmail : "");
      fd.append("IsShowBankInReceipt", isOffline && showBankInReceipt ? "true" : "false");
      fd.append("OfflineBankName", isOffline && showBankInReceipt ? bankName : "");
      fd.append("OfflineAccountNumber", isOffline && showBankInReceipt ? accountNumber : "");
      fd.append("OfflineIfscCode", isOffline && showBankInReceipt ? ifsc : "");
      fd.append("EmailCC", emailCC);
      fd.append("EmailSubject", emailSubject);
      fd.append("EmailBody", emailBody);
      fd.append("EmailReminderSubject", emailReminderSubject);
      fd.append("EmailReminderBody", emailReminderBody);
      fd.append("ReminderButtonText", reminderButtonText);
      fd.append("GoogleSheetEmail", googleSheetEmail);
      if (vendorsPayload) fd.append("VendorsJson", JSON.stringify(vendorsPayload));
      if (offlineVendorsPayload) fd.append("OfflineVendorsJson", JSON.stringify(offlineVendorsPayload));
      if (overrides.length > 0) fd.append("ClubOverridesJson", JSON.stringify(overrides));
      if (logoFile) fd.append("logo", logoFile);
      if (bgFile) fd.append("bgImage", bgFile);
      if (emailLogoFile) fd.append("emailLogo", emailLogoFile);

      if (editId) { await updateClubDues(Number(editId), fd); setSuccess("Updated. Set per-club rates any time on the Clubs page."); }
      else { await createClubDues(fd); setSuccess("Created. You can fine-tune per-club rates on the Clubs page."); }
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to save.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Basic Info ──────────────────────────────────────
  const renderBasic = () => (
    <Card>
      <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 max-w-sm">
          <Label>District<span className="text-destructive ml-1">*</span></Label>
          <Popover open={districtOpen} onOpenChange={setDistrictOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" role="combobox" disabled={!!editId} className="w-full justify-between font-normal">
                {districtId ? districts.find((d) => String(d.id) === districtId)?.districtNumber : "Select district"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search district number…" />
                <CommandList>
                  <CommandEmpty>No district found.</CommandEmpty>
                  <CommandGroup>
                    {districts.map((d) => (
                      <CommandItem key={d.id} value={d.districtNumber} onSelect={() => { setDistrictId(String(d.id)); setDistrictOpen(false); }}>
                        <Check className={`mr-2 h-4 w-4 ${districtId === String(d.id) ? "opacity-100" : "opacity-0"}`} />
                        {d.districtNumber}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2 max-w-sm">
          <Label>Rotary Year<span className="text-destructive ml-1">*</span></Label>
          <Select value={rotaryYear} onValueChange={setRotaryYear} disabled={!!editId}>
            <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y.id} value={y.yearLabel}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Purpose</Label>
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Title / purpose of the dues" />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <ReactQuill theme="snow" value={purposeDescription} onChange={setPurposeDescription} modules={quillModules}
            placeholder="Description (optional): bold / italic / sizes / colors / lists / links" />
        </div>
      </CardContent>
    </Card>
  );

  // ── Step 2: Payment & Split ─────────────────────────────────
  const renderPayment = () => (independent ? renderPaymentIndependent() : renderPaymentLegacy());

  // Reusable vendor-split block (account picker + value + running total), shared by the independent
  // mode's Online and Offline sections.
  const renderVendorSection = (
    title: string,
    rows: VendorRow[],
    updateRow: (i: number, field: keyof VendorRow, value: string) => void,
    addRow: () => void,
    removeRow: (i: number) => void,
    filled: VendorRow[],
    total: number,
    ok: boolean,
    rateVal: string,
  ) => (
    <div>
      <h3 className="font-semibold text-base mb-2">{title}</h3>
      <div className="space-y-3 rounded-md border p-3">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Select value={row.routeAccountId} onValueChange={(v) => updateRow(i, "routeAccountId", v)}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {routeAccounts
                  .filter((a) => String(a.id) === row.routeAccountId || !rows.some((rr, idx) => idx !== i && rr.routeAccountId === String(a.id)))
                  .map((a) => {
                  const bank = `••••${a.bankAccountLast4 || "----"} · IFSC ${a.bankIfsc || "N/A"}`;
                  return (
                    <SelectItem key={a.id} value={String(a.id)} className="py-2">
                      <div className="flex flex-col items-start gap-0.5 text-left leading-tight">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{bank}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="w-28">
              <Input type="number" value={row.value} onChange={(e) => updateRow(i, "value", e.target.value)} placeholder={amountType === "2" ? "%" : currencySymbol()} />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={rows.length === 1}><X className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 h-4 w-4" />Add account</Button>
          {filled.length > 0 && (
            <span className={`text-sm ${ok ? "text-green-600" : "text-red-600"}`}>
              Total: {amountType === "2" ? `${total}% / 100%` : `${currencySymbol()}${total} / ${currencySymbol()}${rateVal || 0}`}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {amountType === "2" ? "Percentages must total 100%." : `Amounts must total the per-member rate (${currencySymbol()}${rateVal || 0}).`} Leave all empty to send the full amount to the main account.
        </p>
      </div>
    </div>
  );

  const renderPaymentIndependent = () => (
    <Card>
      <CardHeader><CardTitle>Payment & Split</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 max-w-xs">
          <Label>Mode of Payment</Label>
          <Select value={modeOfPayment} onValueChange={setModeOfPayment}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Online only</SelectItem>
              <SelectItem value="2">Offline only</SelectItem>
              <SelectItem value="3">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Online and Offline are fully independent: each has its own per-member rate and account split. A club only needs <b>one</b> of them fully paid to be marked Paid.
        </p>
        <div className="flex items-center gap-2">
          <Label>Split by</Label>
          <div className="inline-flex rounded-md border overflow-hidden text-sm">
            <button type="button" onClick={() => setAmountType("2")} className={`px-3 py-1 disabled:opacity-60 ${amountType === "2" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Percentage</button>
            <button type="button" onClick={() => setAmountType("1")} className={`px-3 py-1 disabled:opacity-60 ${amountType === "1" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Amount</button>
          </div>
        </div>

        {isOffline && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2 max-w-xs">
              <Label>Offline per-member Rate ({currencySymbol()})<span className="text-destructive ml-1">*</span></Label>
              <Input type="number" value={offlineRate} onChange={(e) => setOfflineRate(e.target.value)} placeholder="e.g. 100" />
            </div>
            {renderVendorSection("Offline Split", offlineVendorRows, updateOfflineRow, addOfflineRow, removeOfflineRow, offlineFilledRows, offlineSplitTotal, offlineSplitOk, offlineRate)}
            <div className="space-y-2 max-w-md">
              <Label>Approver email: District Treasurer</Label>
              <Input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="treasurer@example.com" />
              <p className="text-xs text-muted-foreground">Used only when a club submits an <b>offline</b> payment: the approve/reject email is sent here.</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="showBankInd" checked={showBankInReceipt} onChange={(e) => setShowBankInReceipt(e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="showBankInd">Do you want to send Bank details in Receipt?</Label>
            </div>
            {showBankInReceipt && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" /></div>
                <div className="space-y-2"><Label>Account no.</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 50100XXXXXX" /></div>
                <div className="space-y-2"><Label>IFSC</Label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="e.g. HDFC0001234" /></div>
              </div>
            )}
          </div>
        )}

        {isOnline && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2 max-w-xs">
              <Label>Online per-member Rate ({currencySymbol()})<span className="text-destructive ml-1">*</span></Label>
              <Input type="number" value={onlineRate} onChange={(e) => setOnlineRate(e.target.value)} placeholder="e.g. 103" />
            </div>
            {renderVendorSection("Online Split (Razorpay Route)", onlineVendorRows, updateOnlineRow, addOnlineRow, removeOnlineRow, onlineFilledRows, onlineSplitTotal, onlineSplitOk, onlineRate)}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderPaymentLegacy = () => (
    <Card>
      <CardHeader><CardTitle>Payment & Split</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
          <div className="space-y-2">
            <Label>Per-member Rate ({currencySymbol()})<span className="text-destructive ml-1">*</span></Label>
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 100" />
            <p className="text-xs text-muted-foreground">Default for all clubs; override per club in the next step.</p>
          </div>
          <div className="space-y-2">
            <Label>Mode of Payment</Label>
            <Select value={modeOfPayment} onValueChange={setModeOfPayment}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Online only</SelectItem>
                <SelectItem value="2">Offline only</SelectItem>
                <SelectItem value="3">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isOnline && (
          <div className="space-y-2 max-w-xs">
            <Label>Online surcharge (%)</Label>
            <Input type="number" step="0.01" min="0" value={onlineSurcharge} onChange={(e) => setOnlineSurcharge(e.target.value)} placeholder="e.g. 2" />
            <p className="text-xs text-muted-foreground">Added on top of the rate for <b>online</b> payments only (e.g. to cover the gateway fee). Offline pays the base rate. Editable anytime.</p>
          </div>
        )}

        {isOnline && (
          <div>
            <h3 className="font-semibold text-base mb-2">Online Split (Razorpay Route)</h3>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>Split by</Label>
                <div className="inline-flex rounded-md border overflow-hidden text-sm">
                  <button type="button" onClick={() => setAmountType("2")} className={`px-3 py-1 disabled:opacity-60 ${amountType === "2" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Percentage</button>
                  <button type="button" onClick={() => setAmountType("1")} className={`px-3 py-1 disabled:opacity-60 ${amountType === "1" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Amount</button>
                </div>
              </div>
              {vendorRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={row.routeAccountId} onValueChange={(v) => updateRow(i, "routeAccountId", v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {routeAccounts
                        .filter((a) => String(a.id) === row.routeAccountId || !vendorRows.some((rr, idx) => idx !== i && rr.routeAccountId === String(a.id)))
                        .map((a) => {
                        const bank = `••••${a.bankAccountLast4 || "----"} · IFSC ${a.bankIfsc || "N/A"}`;
                        return (
                          <SelectItem key={a.id} value={String(a.id)} className="py-2">
                            <div className="flex flex-col items-start gap-0.5 text-left leading-tight">
                              <span className="font-medium">{a.name}</span>
                              <span className="text-xs text-muted-foreground">{bank}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <div className="w-28">
                    <Input type="number" value={row.value} onChange={(e) => updateRow(i, "value", e.target.value)} placeholder={amountType === "2" ? "%" : currencySymbol()} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={vendorRows.length === 1}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 h-4 w-4" />Add account</Button>
                {filledRows.length > 0 && (
                  <span className={`text-sm ${splitOk ? "text-green-600" : "text-red-600"}`}>
                    Total: {amountType === "2" ? `${splitTotal}% / 100%` : `${currencySymbol()}${splitTotal} / ${currencySymbol()}${rate || 0}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {amountType === "2" ? "Percentages must total 100%." : `Amounts must total the per-member rate (${currencySymbol()}${rate || 0}).`} Leave all empty to send the full amount to the main account.
              </p>
            </div>
          </div>
        )}

        {isOffline && (
          <div>
            <h3 className="font-semibold text-base mb-2">Offline Payment</h3>
            <div className="space-y-4">
              <div className="space-y-2 max-w-md">
                <Label>Approver email: District Treasurer</Label>
                <Input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="treasurer@example.com" />
                <p className="text-xs text-muted-foreground">Used only when a club submits an <b>offline</b> payment: the approve/reject email is sent here.</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="showBank" checked={showBankInReceipt} onChange={(e) => setShowBankInReceipt(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="showBank">Do you want to send Bank details in Receipt?</Label>
              </div>
              {showBankInReceipt && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" /></div>
                  <div className="space-y-2"><Label>Account no.</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 50100XXXXXX" /></div>
                  <div className="space-y-2"><Label>IFSC</Label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="e.g. HDFC0001234" /></div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // ── Step 3: Club List ───────────────────────────────────────
  const renderClubs = () => (independent ? renderClubsIndependent() : renderClubsLegacy());

  const renderClubsIndependent = () => (
    <Card>
      <CardHeader><CardTitle>Club List: per-club rate &amp; split</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Every club in the district (synced &amp; non-synced) is included, defaulting to the campaign&apos;s Online/Offline rates and splits. Change any club to override just that one. You can also edit this later on the Clubs page.
        </p>
        {((selectedOnlineVendors.length > 0 && clubsList.some((c) => !clubOnlineBalanced(c))) ||
          (selectedOfflineVendors.length > 0 && clubsList.some((c) => !clubOfflineBalanced(c)))) && (
          <p className="mb-3 text-sm rounded bg-red-50 text-red-700 border border-red-200 p-2">
            Some clubs&apos; splits don&apos;t balance (Balance ≠ 0). Fix the red rows: every Balance must be <b>0</b> before you can continue.
          </p>
        )}
        {clubsLoading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>
        ) : (
          <div className="overflow-x-auto max-h-[440px] border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left sticky top-0">
                <tr>
                  <th className="p-2">Club</th>
                  <th className="p-2 text-center">Members</th>
                  {isOffline && <th className="p-2 w-24">Offline Rate ({currencySymbol()})</th>}
                  {isOffline && selectedOfflineVendors.map((sv, idx) => {
                    const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
                    return <th key={`off-${sv.routeAccountId}`} className="p-2 w-24 whitespace-nowrap">Off: {acc?.name || `A/C${idx + 1}`}<span className="text-muted-foreground font-normal"> ({amountType === "2" ? "%" : currencySymbol()})</span></th>;
                  })}
                  {isOffline && selectedOfflineVendors.length > 0 && <th className="p-2 w-24 text-right">Off. Balance</th>}
                  {isOnline && <th className="p-2 w-24">Online Rate ({currencySymbol()})</th>}
                  {isOnline && selectedOnlineVendors.map((sv, idx) => {
                    const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
                    return <th key={`on-${sv.routeAccountId}`} className="p-2 w-24 whitespace-nowrap">On: {acc?.name || `A/C${idx + 1}`}<span className="text-muted-foreground font-normal"> ({amountType === "2" ? "%" : currencySymbol()})</span></th>;
                  })}
                  {isOnline && selectedOnlineVendors.length > 0 && <th className="p-2 w-24 text-right">On. Balance</th>}
                </tr>
              </thead>
              <tbody>
                {clubsList.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">{c.clubName}{!c.isSyncedFromRotaryOrg && <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">non-sync</span>}</td>
                    <td className="p-2 text-center">{c.totalMembers}</td>
                    {isOffline && <td className="p-2"><Input type="number" className="h-8" value={clubOfflineOverrides[c.id] ?? offlineRate} onChange={(e) => setClubOfflineOverrides((p) => ({ ...p, [c.id]: e.target.value }))} /></td>}
                    {isOffline && selectedOfflineVendors.map((sv) => (
                      <td key={`off-${sv.routeAccountId}`} className="p-2">
                        <Input type="number" className={`h-8 ${!clubOfflineBalanced(c) ? "border-red-400" : ""}`} value={clubOfflineSplits[c.id]?.[sv.routeAccountId] ?? sv.value}
                          onChange={(e) => updateClubOfflineSplit(c.id, sv.routeAccountId, e.target.value)} />
                      </td>
                    ))}
                    {isOffline && selectedOfflineVendors.length > 0 && (
                      <td className={`p-2 text-right font-semibold ${clubOfflineBalanced(c) ? "text-green-600" : "text-red-600"}`}>
                        {amountType === "2" ? `${clubOfflineBalance(c)}%` : `${currencySymbol()}${clubOfflineBalance(c)}`}
                      </td>
                    )}
                    {isOnline && <td className="p-2"><Input type="number" className="h-8" value={clubOnlineOverrides[c.id] ?? onlineRate} onChange={(e) => setClubOnlineOverrides((p) => ({ ...p, [c.id]: e.target.value }))} /></td>}
                    {isOnline && selectedOnlineVendors.map((sv) => (
                      <td key={`on-${sv.routeAccountId}`} className="p-2">
                        <Input type="number" className={`h-8 ${!clubOnlineBalanced(c) ? "border-red-400" : ""}`} value={clubOnlineSplits[c.id]?.[sv.routeAccountId] ?? sv.value}
                          onChange={(e) => updateClubOnlineSplit(c.id, sv.routeAccountId, e.target.value)} />
                      </td>
                    ))}
                    {isOnline && selectedOnlineVendors.length > 0 && (
                      <td className={`p-2 text-right font-semibold ${clubOnlineBalanced(c) ? "text-green-600" : "text-red-600"}`}>
                        {amountType === "2" ? `${clubOnlineBalance(c)}%` : `${currencySymbol()}${clubOnlineBalance(c)}`}
                      </td>
                    )}
                  </tr>
                ))}
                {clubsList.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No clubs in this district.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderClubsLegacy = () => (
    <Card>
      <CardHeader><CardTitle>Club List: per-club rate{selectedVendors.length > 0 ? " & split" : ""}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Every club in the district (synced &amp; non-synced) is included, defaulting to {currencySymbol()}{rate || 0}/member{selectedVendors.length > 0 ? " and the campaign split" : ""}. Change any club to override just that one: the split columns route that club&apos;s payment across the accounts you picked in Payment &amp; Split ({amountType === "2" ? "must total 100%" : `must total the club rate`}). You can also edit this later on the Clubs page.
        </p>
        {selectedVendors.length > 0 && clubsList.some((c) => !clubBalanced(c)) && (
          <p className="mb-3 text-sm rounded bg-red-50 text-red-700 border border-red-200 p-2">
            Some clubs&apos; splits don&apos;t balance (Balance ≠ 0). Fix the red rows: every Balance must be <b>0</b> before you can continue.
          </p>
        )}
        {clubsLoading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>
        ) : (
          <div className="overflow-x-auto max-h-[440px] border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left sticky top-0">
                <tr>
                  <th className="p-2">Club</th>
                  <th className="p-2 text-center">Members</th>
                  <th className="p-2 w-24">Rate ({currencySymbol()})</th>
                  {selectedVendors.map((sv, idx) => {
                    const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
                    return <th key={sv.routeAccountId} className="p-2 w-24 whitespace-nowrap">{acc?.name || `A/C${idx + 1}`}<span className="text-muted-foreground font-normal"> ({amountType === "2" ? "%" : currencySymbol()})</span></th>;
                  })}
                  {selectedVendors.length > 0 && <th className="p-2 w-24 text-right">Balance</th>}
                </tr>
              </thead>
              <tbody>
                {clubsList.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">{c.clubName}{!c.isSyncedFromRotaryOrg && <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">non-sync</span>}</td>
                    <td className="p-2 text-center">{c.totalMembers}</td>
                    <td className="p-2"><Input type="number" className="h-8" value={clubOverrides[c.id] ?? rate} onChange={(e) => setClubOverrides((p) => ({ ...p, [c.id]: e.target.value }))} /></td>
                    {selectedVendors.map((sv) => (
                      <td key={sv.routeAccountId} className="p-2">
                        <Input type="number" className={`h-8 ${!clubBalanced(c) ? "border-red-400" : ""}`} value={clubSplits[c.id]?.[sv.routeAccountId] ?? sv.value}
                          onChange={(e) => updateClubSplit(c.id, sv.routeAccountId, e.target.value)} />
                      </td>
                    ))}
                    {selectedVendors.length > 0 && (
                      <td className={`p-2 text-right font-semibold ${clubBalanced(c) ? "text-green-600" : "text-red-600"}`}>
                        {amountType === "2" ? `${clubBalance(c)}%` : `${currencySymbol()}${clubBalance(c)}`}
                      </td>
                    )}
                  </tr>
                ))}
                {clubsList.length === 0 && <tr><td colSpan={3 + selectedVendors.length + (selectedVendors.length > 0 ? 1 : 0)} className="p-6 text-center text-muted-foreground">No clubs in this district.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // ── Step 4: Images & Email ──────────────────────────────────
  const imageField = (label: string, file: File | null, setFile: (f: File | null) => void, existing: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {file ? (
        <div className="flex items-center gap-3">
          <img src={URL.createObjectURL(file)} alt="" className="h-12 w-12 rounded border object-contain" />
          <Button type="button" variant="ghost" size="icon" onClick={() => setFile(null)}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {existing && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={clubDuesAssetUrl(existing)} alt="" className="h-12 w-12 rounded border object-contain bg-white" />
          )}
          <Label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" />{existing ? "Replace" : "Upload"}
            <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.svg" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Label>
        </div>
      )}
    </div>
  );

  const renderImagesEmail = () => (
    <Card>
      <CardHeader><CardTitle>Images &amp; Email</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="font-semibold text-base mb-2">Images</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {imageField("Purpose logo", logoFile, setLogoFile, existingLogo)}
            {imageField("Background image", bgFile, setBgFile, existingBg)}
            {imageField("Email header logo", emailLogoFile, setEmailLogoFile, existingEmailLogo)}
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-base mb-2">Email</h3>
          <p className="text-xs text-muted-foreground mb-3">Click a chip to insert a value (e.g. club name, amount) into your text. It&apos;s filled in automatically when the email is sent. If you don&apos;t add an amount/members value, a summary is appended for you.</p>
          <div className="space-y-4">
            <div className="space-y-2 max-w-md"><Label>Email CC</Label><Input value={emailCC} onChange={(e) => setEmailCC(e.target.value)} placeholder="cc@example.com, another@example.com" /></div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Receipt (thank-you) email</p>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Your District Dues receipt" />
                <EmailTokenChips tokens={CLUB_DUES_RECEIPT_TOKENS} onInsert={(t) => setEmailSubject((v) => (v ? v + " " : "") + t)} />
              </div>
              <div className="space-y-1">
                <Label>Body</Label>
                <ReactQuill forwardedRef={emailBodyRef} theme="snow" value={emailBody} onChange={setEmailBody} modules={quillModules} placeholder="Receipt email message (optional)" />
                <EmailTokenChips tokens={CLUB_DUES_RECEIPT_TOKENS} onInsert={(t) => insertQuillToken(emailBodyRef, setEmailBody, t)} />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Reminder email</p>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={emailReminderSubject} onChange={(e) => setEmailReminderSubject(e.target.value)} placeholder="District Dues reminder" />
                <EmailTokenChips tokens={CLUB_DUES_REMINDER_TOKENS} onInsert={(t) => setEmailReminderSubject((v) => (v ? v + " " : "") + t)} />
              </div>
              <div className="space-y-1">
                <Label>Body</Label>
                <ReactQuill forwardedRef={emailReminderBodyRef} theme="snow" value={emailReminderBody} onChange={setEmailReminderBody} modules={quillModules} placeholder="Reminder email message (optional)" />
                <EmailTokenChips tokens={CLUB_DUES_REMINDER_TOKENS} onInsert={(t) => insertQuillToken(emailReminderBodyRef, setEmailReminderBody, t)} />
              </div>
              <div className="space-y-1">
                <Label>Pay button text</Label>
                <Input value={reminderButtonText} onChange={(e) => setReminderButtonText(e.target.value)} placeholder="Pay Now/Record Offline Payment Here" />
                <p className="text-xs text-muted-foreground">Text shown on the button in the reminder email. Leave blank to use the default.</p>
              </div>
              <div className="space-y-1">
                <Label>Google Sheet share email</Label>
                <Input type="email" value={googleSheetEmail} onChange={(e) => setGoogleSheetEmail(e.target.value)} placeholder="support@example.org" />
                <p className="text-xs text-muted-foreground">A Google Sheet can be created for this campaign from the District Dues list: enter an email to share editor access.</p>
              </div>
            </div>

            <div className="rounded-md border border-dashed p-3 space-y-2">
              <p className="text-sm font-medium">Send a test email</p>
              <p className="text-xs text-muted-foreground">Uses the text above with sample values.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="email" className="max-w-xs" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                <Button type="button" variant="outline" size="sm" disabled={testBusy !== null} onClick={() => sendTest("reminder")}>
                  {testBusy === "reminder" && <RotaryLoader size="sm" />}Test reminder
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={testBusy !== null} onClick={() => sendTest("receipt")}>
                  {testBusy === "receipt" && <RotaryLoader size="sm" />}Test thank-you
                </Button>
              </div>
              {testMsg && <p className={`text-xs ${testMsg.ok ? "text-green-600" : "text-red-600"}`}>{testMsg.text}</p>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!isSuperAdmin) {
    return <ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3><p className="text-muted-foreground">Only SuperAdmin can manage district dues.</p></div></ProtectedRoute>;
  }
  if (!ready) return <ProtectedRoute><div className="flex justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  const isLastStep = currentStep === totalSteps - 1;
  const stepContent = [renderBasic, renderPayment, renderClubs, renderImagesEmail][currentStep];

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!success} title="Saved" description={success || ""} onOk={() => router.push("/settings/club-dues")} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/club-dues"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">{editId ? "Edit District Dues" : "Create District Dues"}</h2>
            <p className="text-muted-foreground text-base">Step {currentStep + 1} of {totalSteps}</p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStep ? "bg-green-600 text-white" :
                i === currentStep ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm hidden md:inline ${i === currentStep ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < STEP_LABELS.length - 1 && <div className="w-8 h-[2px] bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {stepContent()}

        {/* Navigation */}
        <div className="flex justify-between pb-8">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          {isLastStep ? (
            <Button onClick={submit} disabled={loading} className="bg-green-600 hover:bg-green-700">
              {loading ? <RotaryLoader size="sm" /> : <Save className="h-4 w-4 mr-2" />}
              {loading ? (editId ? "Updating..." : "Creating...") : (editId ? "Update District Dues" : "Create District Dues")}
            </Button>
          ) : (
            <Button onClick={handleNext}>Next<ArrowRight className="h-4 w-4 ml-2" /></Button>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default function CreateClubDuesPage() {
  return <Suspense fallback={null}><CreateClubDuesInner /></Suspense>;
}
