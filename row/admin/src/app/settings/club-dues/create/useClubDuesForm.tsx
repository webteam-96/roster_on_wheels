import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getDistricts, getClubs, getRazorpayRouteAccounts, getRotaryYears, createClubDues, updateClubDues, getClubDuesDetail, getClubDuesAllClubVendors, sendClubDuesTestEmail, clubDuesAssetUrl, RazorpayRouteAccount } from "@/services/api";
import { DistrictListItem } from "@/types/district";
import { ClubListItem } from "@/types/club";
import { RotaryYear } from "@/types/rotaryYear";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Upload } from "@/components/icons";
import { getCurrencySymbol, duesDefaultsForDistrict } from "@/lib/currency";
import { getDuesDraft, saveDuesDraft, deleteDuesDraft, newDuesDraftId } from "@/lib/duesDraft";
import { defaultCurrency } from "@/lib/appFormat";
import { STEP_LABELS, VendorRow } from "./clubDuesShared";

export function useClubDuesForm() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("edit");
  const { isSuperAdmin, user } = useAuth();
  // Browser draft (new dues only): ?draft=<id> continues a saved draft; otherwise a new id is made.
  const draftParam = params.get("draft");
  const draftIdRef = useRef<string>(draftParam || newDuesDraftId());
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const draftDistrictRef = useRef<string | null>(null); // restored district: keep its saved channels/currency

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
  // Super Admin only (RIZones 2026-11-09, ROW form): whether this dues emails members, and the currency its
  // amounts show in. ROW has no WhatsApp.
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [currency, setCurrency] = useState<string>(defaultCurrency());
  // New campaign: pre-fill from the district's default currency.
  useEffect(() => {
    if (editId || !districtId || draftDistrictRef.current === districtId) return;
    const d = duesDefaultsForDistrict(districts.find((x) => String(x.id) === districtId)?.defaultCurrency);
    setNotifyEmail(d.notifyEmail); setCurrency(d.currency);
  }, [editId, districtId, districts]);
  const cur = getCurrencySymbol(currency);
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
        const [d, y, k] = await Promise.all([getDistricts(1, 9999), getRotaryYears(), getRazorpayRouteAccounts(true)]);
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
          setNotifyEmail(det.notifyEmail !== false);
          setCurrency(det.currency || defaultCurrency());
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

  // -- Browser draft: what is kept on every Next, and put back when the draft is continued --
  const draftSnapshot = () => ({
    districtId, rotaryYear, purpose, purposeDescription,
    rate, onlineSurcharge, modeOfPayment, approverEmail, showBankInReceipt, amountType, vendorRows,
    bankName, accountNumber, ifsc, rateModel, onlineRate, offlineRate, onlineVendorRows, offlineVendorRows,
    clubOverrides, clubSplits, clubOnlineOverrides, clubOfflineOverrides, clubOnlineSplits, clubOfflineSplits,
    emailCC, emailSubject, emailBody, emailReminderSubject, emailReminderBody, reminderButtonText, googleSheetEmail,
    notifyEmail, currency,
  });
  const saveDraft = (step: number) => {
    if (editId || !user?.memberId) return;
    const dist = districts.find((d) => String(d.id) === districtId)?.districtNumber;
    const title = [dist ? `District ${dist}` : "New District Dues", rotaryYear, purpose].filter(Boolean).join(" · ");
    saveDuesDraft({ id: draftIdRef.current, kind: "district", memberId: user.memberId, step, title, data: draftSnapshot() });
    setDraftSavedAt(new Date().toISOString());
    if (draftParam !== draftIdRef.current) router.replace(`/settings/club-dues/create?draft=${draftIdRef.current}`, { scroll: false });
  };
  const restoredRef = useRef(false);
  useEffect(() => {
    if (editId || restoredRef.current || !draftParam || !user?.memberId) return;
    restoredRef.current = true;
    const dr = getDuesDraft(draftParam, user.memberId);
    if (!dr) return;
    const d = dr.data || {};
    draftDistrictRef.current = d.districtId || null;
    if (d.districtId != null) setDistrictId(d.districtId);
    if (d.rotaryYear != null) setRotaryYear(d.rotaryYear);
    if (d.purpose != null) setPurpose(d.purpose);
    if (d.purposeDescription != null) setPurposeDescription(d.purposeDescription);
    if (d.rate != null) setRate(d.rate);
    if (d.onlineSurcharge != null) setOnlineSurcharge(d.onlineSurcharge);
    if (d.modeOfPayment) setModeOfPayment(d.modeOfPayment);
    if (d.approverEmail != null) setApproverEmail(d.approverEmail);
    if (d.showBankInReceipt != null) setShowBankInReceipt(d.showBankInReceipt);
    if (d.amountType) setAmountType(d.amountType);
    if (Array.isArray(d.vendorRows) && d.vendorRows.length) setVendorRows(d.vendorRows);
    if (d.bankName != null) setBankName(d.bankName);
    if (d.accountNumber != null) setAccountNumber(d.accountNumber);
    if (d.ifsc != null) setIfsc(d.ifsc);
    if (d.rateModel === "0" || d.rateModel === "1") setRateModel(d.rateModel);
    if (d.onlineRate != null) setOnlineRate(d.onlineRate);
    if (d.offlineRate != null) setOfflineRate(d.offlineRate);
    if (Array.isArray(d.onlineVendorRows) && d.onlineVendorRows.length) setOnlineVendorRows(d.onlineVendorRows);
    if (Array.isArray(d.offlineVendorRows) && d.offlineVendorRows.length) setOfflineVendorRows(d.offlineVendorRows);
    if (d.clubOverrides) setClubOverrides(d.clubOverrides);
    if (d.clubSplits) setClubSplits(d.clubSplits);
    if (d.clubOnlineOverrides) setClubOnlineOverrides(d.clubOnlineOverrides);
    if (d.clubOfflineOverrides) setClubOfflineOverrides(d.clubOfflineOverrides);
    if (d.clubOnlineSplits) setClubOnlineSplits(d.clubOnlineSplits);
    if (d.clubOfflineSplits) setClubOfflineSplits(d.clubOfflineSplits);
    if (d.emailCC != null) setEmailCC(d.emailCC);
    if (d.emailSubject != null) setEmailSubject(d.emailSubject);
    if (d.emailBody != null) setEmailBody(d.emailBody);
    if (d.emailReminderSubject != null) setEmailReminderSubject(d.emailReminderSubject);
    if (d.emailReminderBody != null) setEmailReminderBody(d.emailReminderBody);
    if (d.reminderButtonText != null) setReminderButtonText(d.reminderButtonText);
    if (d.googleSheetEmail != null) setGoogleSheetEmail(d.googleSheetEmail);
    if (d.notifyEmail != null) setNotifyEmail(d.notifyEmail);
    if (typeof d.currency === "string" && d.currency) setCurrency(d.currency);
    setCurrentStep(Number(dr.step) || 0);
    setDraftSavedAt(dr.savedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, draftParam, user?.memberId]);

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
          if (amountType === "1" && Math.abs(onlineSplitTotal - Number(onlineRate)) > 0.01) return `Online amount split must total exactly the online rate (${cur}${onlineRate}).`;
        }
        if (isOffline && offlineFilledRows.length > 0) {
          if (amountType === "2" && Math.abs(offlineSplitTotal - 100) > 0.01) return "Offline percentage split must total exactly 100%.";
          if (amountType === "1" && Math.abs(offlineSplitTotal - Number(offlineRate)) > 0.01) return `Offline amount split must total exactly the offline rate (${cur}${offlineRate}).`;
        }
      } else {
        if (!rate || Number(rate) <= 0) return "Enter a per-member rate.";
        if (isOnline && filledRows.length > 0) {
          if (amountType === "2" && Math.abs(splitTotal - 100) > 0.01) return "Percentage split must total exactly 100%.";
          if (amountType === "1" && Math.abs(splitTotal - Number(rate)) > 0.01) return `Amount split must total exactly the per-member rate (${cur}${rate}).`;
        }
      }
    }
    if (step === 2) {
      if (independent) {
        if (selectedOnlineVendors.length > 0) {
          const bad = clubsList.find((c) => !clubOnlineBalanced(c));
          if (bad) return `"${bad.clubName}" online split is off by ${amountType === "2" ? `${clubOnlineBalance(bad)}%` : `${cur}${clubOnlineBalance(bad)}`}. Every club's online balance must be 0 before continuing.`;
        }
        if (selectedOfflineVendors.length > 0) {
          const bad = clubsList.find((c) => !clubOfflineBalanced(c));
          if (bad) return `"${bad.clubName}" offline split is off by ${amountType === "2" ? `${clubOfflineBalance(bad)}%` : `${cur}${clubOfflineBalance(bad)}`}. Every club's offline balance must be 0 before continuing.`;
        }
      } else if (selectedVendors.length > 0) {
        const bad = clubsList.find((c) => !clubBalanced(c));
        if (bad) return `"${bad.clubName}" split is off by ${amountType === "2" ? `${clubBalance(bad)}%` : `${cur}${clubBalance(bad)}`}. Every club's balance must be 0 (${amountType === "2" ? "splits total 100%" : "splits total the club rate"}) before continuing.`;
      }
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep(currentStep);
    if (err) { setError(err); return; }
    if (currentStep < totalSteps - 1) { setCurrentStep(currentStep + 1); saveDraft(currentStep + 1); }
    else submit();
  };
  const handleBack = () => { if (currentStep > 0) setCurrentStep(currentStep - 1); };

  const submit = async () => {
    saveDraft(currentStep); // keep everything typed even if the final save fails
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
      if (isSuperAdmin) {
        fd.append("NotifyEmail", notifyEmail ? "true" : "false");
        fd.append("Currency", currency);
      }
      if (vendorsPayload) fd.append("VendorsJson", JSON.stringify(vendorsPayload));
      if (offlineVendorsPayload) fd.append("OfflineVendorsJson", JSON.stringify(offlineVendorsPayload));
      if (overrides.length > 0) fd.append("ClubOverridesJson", JSON.stringify(overrides));
      if (logoFile) fd.append("logo", logoFile);
      if (bgFile) fd.append("bgImage", bgFile);
      if (emailLogoFile) fd.append("emailLogo", emailLogoFile);

      if (editId) { await updateClubDues(Number(editId), fd); setSuccess("Updated. Set per-club rates any time on the Clubs page."); }
      else { await createClubDues(fd); deleteDuesDraft(draftIdRef.current); setSuccess("Created. You can fine-tune per-club rates on the Clubs page."); }
    } catch (e: any) {
      const d = e?.response?.data;
      const fieldErrors = d && typeof d === "object" && d.errors && typeof d.errors === "object"
        ? Object.entries(d.errors).map(([k, v]) => `${k.replace(/^\$\.?/, "")}: ${Array.isArray(v) ? v.join(" ") : String(v)}`).join("\n")
        : "";
      setError((typeof d === "string" && d) || d?.message || (fieldErrors ? `${d?.title || "Some fields are not valid."}\n${fieldErrors}` : "") || d?.title || "Failed to save.");
    } finally {
      setLoading(false);
    }
  };

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
            <img src={clubDuesAssetUrl(existing)} alt="" className="h-12 w-12 rounded border object-contain bg-card" />
          )}
          <Label className="inline-flex items-center gap-2 cursor-pointer rounded border px-3 py-2 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" />{existing ? "Replace" : "Upload"}
            <input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.svg" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Label>
        </div>
      )}
    </div>
  );
  return { router, editId, isSuperAdmin, draftSavedAt, totalSteps, currentStep, districts, years, routeAccounts, loading, ready, districtId, setDistrictId, districtOpen, setDistrictOpen, rotaryYear, setRotaryYear, purpose, setPurpose, purposeDescription, setPurposeDescription, rate, setRate, onlineSurcharge, setOnlineSurcharge, modeOfPayment, setModeOfPayment, approverEmail, setApproverEmail, showBankInReceipt, setShowBankInReceipt, amountType, setAmountType, vendorRows, bankName, setBankName, accountNumber, setAccountNumber, ifsc, setIfsc, onlineRate, setOnlineRate, offlineRate, setOfflineRate, onlineVendorRows, offlineVendorRows, clubsList, clubsLoading, clubOverrides, setClubOverrides, clubSplits, clubOnlineOverrides, setClubOnlineOverrides, clubOfflineOverrides, setClubOfflineOverrides, clubOnlineSplits, clubOfflineSplits, logoFile, setLogoFile, bgFile, setBgFile, emailLogoFile, setEmailLogoFile, existingLogo, existingBg, existingEmailLogo, emailCC, setEmailCC, emailSubject, setEmailSubject, emailBody, setEmailBody, emailReminderSubject, setEmailReminderSubject, emailReminderBody, setEmailReminderBody, reminderButtonText, setReminderButtonText, googleSheetEmail, setGoogleSheetEmail, notifyEmail, setNotifyEmail, currency, setCurrency, cur, emailBodyRef, emailReminderBodyRef, success, error, setError, testEmail, setTestEmail, testBusy, testMsg, sendTest, quillModules, isOnline, isOffline, filledRows, splitTotal, splitOk, selectedVendors, updateRow, addRow, removeRow, updateClubSplit, clubBalance, clubBalanced, independent, onlineFilledRows, onlineSplitTotal, onlineSplitOk, selectedOnlineVendors, offlineFilledRows, offlineSplitTotal, offlineSplitOk, selectedOfflineVendors, updateOnlineRow, addOnlineRow, removeOnlineRow, updateOfflineRow, addOfflineRow, removeOfflineRow, updateClubOnlineSplit, updateClubOfflineSplit, clubOnlineBalance, clubOnlineBalanced, clubOfflineBalance, clubOfflineBalanced, handleNext, handleBack, submit, imageField };
}

// Values the page computed after its early returns; same statements, same order.
export function deriveClubDuesForm(h: ReturnType<typeof useClubDuesForm>) {
  const { currentStep, totalSteps } = h;

  const isLastStep = currentStep === totalSteps - 1;
  return { isLastStep };
}

export type ClubDuesFormCtx = ReturnType<typeof useClubDuesForm> & ReturnType<typeof deriveClubDuesForm>;
