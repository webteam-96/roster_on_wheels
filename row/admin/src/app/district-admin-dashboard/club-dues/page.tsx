"use client";

import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";
import { getClubDuesMyDistrict, getClubDuesContent, updateClubDuesContent, getClubDuesClubs, approveClubDuesPayment, getClubDuesOfflineDetails, sendClubDuesTestEmail, sendClubDuesReminder, bulkClubDuesReminder, clubDuesAssetUrl, recordClubDuesOffline, getClubDuesOfflineAccounts, ClubDuesOfflineAccountOption } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { useAuth } from "@/contexts/AuthContext";
import { Upload, X, RefreshCw, Bell, FileText, Send } from "@/components/icons";
import EmailTokenChips, { CLUB_DUES_RECEIPT_TOKENS, CLUB_DUES_REMINDER_TOKENS } from "@/components/club-dues/EmailTokenChips";

import { appLocale, currencySymbol } from "@/lib/appFormat";
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

const MODES: Record<string, string> = { "1": "Cash", "2": "Cheque", "3": "NEFT", "4": "UPI", "5": "Other" };

interface Campaign { id: number; districtNumber?: string; rotaryYear?: string; purpose?: string; isActive: boolean }
interface AccountBreakdown {
  fkRouteAccountId: number;
  accountLabel: string | null;
  amount: number;
  isPaid: boolean;
}
interface ClubRow {
  clubDuesClubId: number; fkClubId: number; clubName: string;
  isSyncedFromRotaryOrg: boolean;
  onlinePerMemberRate: number; offlinePerMemberRate: number;
  memberCount: number; paidCount: number; unpaidCount: number; amountPaid: number;
  onlineAmount: number; onlinePaid: number; onlineAccountBreakdown: AccountBreakdown[];
  offlineAmount: number; offlinePaid: number; offlineAccountBreakdown: AccountBreakdown[];
  totalPaid: number; paidOnline: boolean | null;
  status: string; hasPendingApproval: boolean; pendingPaymentId?: number;
}

export default function DistrictAdminClubDuesPage() {
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

  const { selectedDistrictId } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"clubs" | "content">("clubs");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Content-edit state
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const emailBodyRef = useRef<any>(null);
  const emailReminderBodyRef = useRef<any>(null);
  // Loaded from the campaign so the reminder test preview matches the "show bank" config.
  const [showBank, setShowBank] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  // Test-email send (inline feedback).
  const [testEmail, setTestEmail] = useState("");
  const [testBusy, setTestBusy] = useState<"reminder" | "receipt" | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sendTest = async (type: "reminder" | "receipt") => {
    setTestMsg(null);
    if (!testEmail.trim() || !testEmail.includes("@")) { setTestMsg({ ok: false, text: "Enter a valid email address." }); return; }
    const districtId = selectedDistrictId || 0;
    if (!districtId) { setTestMsg({ ok: false, text: "No district selected." }); return; }
    setTestBusy(type);
    try {
      const res = await sendClubDuesTestEmail({
        email: testEmail.trim(), type, districtId, duesId: selectedId || 0,
        subject: type === "reminder" ? emailReminderSubject : emailSubject,
        body: type === "reminder" ? emailReminderBody : emailBody,
        buttonText: type === "reminder" ? reminderButtonText : undefined,
        showBank, bankName, accountNumber, ifsc,
        emailLogo: emailLogoFile, // just-picked (unsaved) header logo, embedded inline for a true preview
      });
      setTestMsg({ ok: true, text: res.message });
    } catch (e: any) { setTestMsg({ ok: false, text: e?.response?.data?.message || "Failed to send test email." }); }
    finally { setTestBusy(null); }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list: Campaign[] = await getClubDuesMyDistrict(selectedDistrictId || undefined);
        setCampaigns(list);
        setSelectedId(list.length > 0 ? list[0].id : null);
      } catch (e: any) { setError(e?.response?.data?.message || "Failed to load district dues."); }
      finally { setLoading(false); }
    })();
  }, [selectedDistrictId]);

  const loadContent = useCallback(async (id: number) => {
    setLoadingContent(true);
    try {
      const d = await getClubDuesContent(id);
      setExistingLogo(d.purposeLogo || "");
      setExistingBg(d.backgroundImage || "");
      setExistingEmailLogo(d.emailHeaderLogo || "");
      setEmailCC(d.emailCC || "");
      setEmailSubject(d.emailSubject || "");
      setEmailBody(d.emailBody || "");
      setEmailReminderSubject(d.emailReminderSubject || "");
      setEmailReminderBody(d.emailReminderBody || "");
      setReminderButtonText(d.reminderButtonText || "");
      setShowBank(!!d.isShowBankInReceipt);
      setBankName(d.offlineBankName || "");
      setAccountNumber(d.offlineAccountNumber || "");
      setIfsc(d.offlineIfscCode || "");
      setLogoFile(null); setBgFile(null); setEmailLogoFile(null);
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to load content."); }
    finally { setLoadingContent(false); }
  }, []);

  useEffect(() => {
    if (selectedId == null || tab !== "content") return;
    loadContent(selectedId);
  }, [selectedId, tab, loadContent]);

  const save = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("EmailCC", emailCC);
      fd.append("EmailSubject", emailSubject);
      fd.append("EmailBody", emailBody);
      fd.append("EmailReminderSubject", emailReminderSubject);
      fd.append("EmailReminderBody", emailReminderBody);
      fd.append("ReminderButtonText", reminderButtonText);
      if (logoFile) fd.append("logo", logoFile);
      if (bgFile) fd.append("bgImage", bgFile);
      if (emailLogoFile) fd.append("emailLogo", emailLogoFile);
      await updateClubDuesContent(selectedId, fd);
      setSuccess("Content updated.");
      await loadContent(selectedId); // re-fetch so the saved images show + file pickers reset
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  const imageField = (label: string, file: File | null, setFile: (f: File | null) => void, existing: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {file ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
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

  if (loading) return <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">District Dues</h2>
        <p className="text-muted-foreground text-base">Track which clubs have paid, approve offline payments, and edit the branding &amp; email content for your district&apos;s dues.</p>
      </div>

      {campaigns.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          No district dues campaign exists for your district yet.
        </CardContent></Card>
      ) : (
        <>
          {campaigns.length > 1 && (
            <div className="max-w-sm space-y-2">
              <Label>Campaign</Label>
              <Select value={selectedId != null ? String(selectedId) : ""} onValueChange={(v) => setSelectedId(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.purpose || "District Dues"} · {c.rotaryYear}{c.isActive ? "" : " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-1 border-b">
            {(["clubs", "content"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t === "clubs" ? "Clubs & Approvals" : "Content"}
              </button>
            ))}
          </div>

          {tab === "clubs" ? (
            selectedId != null && <ClubsSection duesId={selectedId} onSuccess={setSuccess} onError={setError} />
          ) : loadingContent ? (
            <div className="flex justify-center py-16"><RotaryLoader size="lg" /></div>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle>Images</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {imageField("Purpose logo", logoFile, setLogoFile, existingLogo)}
                    {imageField("Background image", bgFile, setBgFile, existingBg)}
                    {imageField("Email header logo", emailLogoFile, setEmailLogoFile, existingEmailLogo)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Email content</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground">Click a chip to insert a value (e.g. club name, amount) into your text. It&apos;s filled in when the email is sent. If you don&apos;t add an amount/members value, a summary is appended for you.</p>
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
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>{saving && <RotaryLoader size="sm" />}Save changes</Button>
              </div>
            </>
          )}
        </>
      )}

      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function ClubsSection({ duesId, onSuccess, onError }: { duesId: number; onSuccess: (m: string) => void; onError: (m: string) => void }) {
  const [rows, setRows] = useState<ClubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [approveFor, setApproveFor] = useState<ClubRow | null>(null);
  const [offlineFor, setOfflineFor] = useState<ClubRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState<"email" | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null); // `${clubId}-email`
  const [bulkConfirmChannel, setBulkConfirmChannel] = useState<"email" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await getClubDuesClubs(duesId, { includeNonSynced: true })); }
    catch (e: any) { onError(e?.response?.data?.message || "Failed to load clubs."); }
    finally { setLoading(false); }
  }, [duesId, onError]);
  useEffect(() => { load(); }, [load]);

  const emailAll = async () => {
    setBulkBusy("email");
    try { await bulkClubDuesReminder(duesId); onSuccess("Email reminders sent to all unpaid clubs."); }
    catch (e: any) { onError(e?.response?.data?.message || "Failed to send email reminders."); }
    finally { setBulkBusy(null); }
  };
  const emailClub = async (r: ClubRow) => {
    setRowBusy(`${r.fkClubId}-email`);
    try { await sendClubDuesReminder(duesId, r.fkClubId); onSuccess(`Email reminder sent to ${r.clubName}.`); }
    catch (e: any) { onError(e?.response?.data?.message || "Failed to send reminder."); }
    finally { setRowBusy(null); }
  };

  // Online and Offline are independent tracks with independent rates, so there's no single honest
  // "Total Amount" anymore — show two parallel totals instead of inventing a blended figure.
  const summary = {
    totalClubs: rows.length,
    fullyPaid: rows.filter((r) => r.status === "Fully Paid").length,
    pending: rows.filter((r) => r.hasPendingApproval).length,
    totalMembers: rows.reduce((s, r) => s + r.memberCount, 0),
    paidMembers: rows.reduce((s, r) => s + r.paidCount, 0),
    offlineAmount: rows.reduce((s, r) => s + r.offlineAmount, 0),
    onlineAmount: rows.reduce((s, r) => s + r.onlineAmount, 0),
    collectedAmount: rows.reduce((s, r) => s + r.offlinePaid + r.onlinePaid, 0),
    pendingAmount: rows.reduce((s, r) => s + Math.max(0, r.offlineAmount - r.offlinePaid), 0),
  };
  const byStatus = statusFilter === "all"
    ? rows
    : statusFilter === "pending"
      ? rows.filter((r) => r.hasPendingApproval)
      : rows.filter((r) => r.status === statusFilter);
  const searched = search.trim()
    ? byStatus.filter((r) => r.clubName?.toLowerCase().includes(search.trim().toLowerCase()))
    : byStatus;
  // Non-sync clubs (not synced from Rotary.org — often zero-member) sink to the bottom; the sort is
  // stable so each group keeps its A-Z order from the backend.
  const filtered = [...searched].sort((a, b) => Number(b.isSyncedFromRotaryOrg) - Number(a.isSyncedFromRotaryOrg));
  // Column counts stay stable across filters — computed over all rows, not just the filtered set.
  const maxOfflineAccountCols = rows.reduce((m, r) => Math.max(m, r.offlineAccountBreakdown?.length || 0), 0);
  const maxOnlineAccountCols = rows.reduce((m, r) => Math.max(m, r.onlineAccountBreakdown?.length || 0), 0);

  if (loading) return <div className="flex justify-center py-16"><RotaryLoader size="lg" /></div>;

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total via Offline</p>
            <p className="text-2xl font-bold text-primary">{currencySymbol()}{summary.offlineAmount.toLocaleString(appLocale())}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{summary.totalMembers} member{summary.totalMembers === 1 ? "" : "s"} · {summary.fullyPaid}/{summary.totalClubs} clubs paid</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total via Online</p>
            <p className="text-2xl font-bold text-primary">{currencySymbol()}{summary.onlineAmount.toLocaleString(appLocale())}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected</p>
            <p className="text-2xl font-bold text-green-600">{currencySymbol()}{summary.collectedAmount.toLocaleString(appLocale())}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{summary.paidMembers} member{summary.paidMembers === 1 ? "" : "s"} · {summary.fullyPaid}/{summary.totalClubs} clubs paid</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pending (Offline)</p>
            <p className="text-2xl font-bold text-red-600">{currencySymbol()}{summary.pendingAmount.toLocaleString(appLocale())}</p>
            {summary.pending > 0 && <p className="text-xs text-amber-600 mt-0.5">{summary.pending} offline awaiting approval</p>}
          </CardContent></Card>
        </div>
      )}

      <div className="flex gap-3 items-center flex-wrap">
        <Input className="w-56" placeholder="Search club" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending approval</SelectItem>
            <SelectItem value="Fully Paid">Fully Paid</SelectItem>
            <SelectItem value="Partial">Partial</SelectItem>
            <SelectItem value="Unpaid">Unpaid</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        <Button variant="outline" size="sm" onClick={() => window.open(`/report/club-dues/${duesId}`, "_blank")} title="Open the public report for this campaign">
          <FileText className="mr-2 h-4 w-4" />Report
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setBulkConfirmChannel("email")} disabled={bulkBusy !== null}>
          {bulkBusy === "email" ? <RotaryLoader size="sm" /> : <Bell className="mr-2 h-4 w-4" />}Email all
        </Button>
      </div>
      <AlertModal
        open={!!bulkConfirmChannel}
        icon={Send}
        iconClassName="text-orange-600"
        title="Send Email Reminder to All Clubs"
        description="Send an email reminder to every unpaid club in this campaign? This cannot be undone."
        confirmLabel="Send"
        confirmClassName="bg-orange-600 text-white hover:bg-orange-700"
        onConfirm={() => { setBulkConfirmChannel(null); emailAll(); }}
        cancelLabel="Cancel"
        onCancel={() => setBulkConfirmChannel(null)}
      />


      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Club</th>
                <th className="p-3 text-center">Total Members</th>
                <th className="p-3 text-right">Offline Amount</th>
                {Array.from({ length: maxOfflineAccountCols }, (_, i) => (
                  <Fragment key={`off-${i}`}>
                    <th className="p-3 text-right whitespace-nowrap">Off. A/C {i + 1} Amount</th>
                    <th className="p-3 text-center whitespace-nowrap">Off. A/C {i + 1} Status</th>
                  </Fragment>
                ))}
                <th className="p-3 text-right">Offline Paid</th>
                <th className="p-3 text-right">Online Amount</th>
                {Array.from({ length: maxOnlineAccountCols }, (_, i) => (
                  <Fragment key={`on-${i}`}>
                    <th className="p-3 text-right whitespace-nowrap">On. A/C {i + 1} Amount</th>
                    <th className="p-3 text-center whitespace-nowrap">On. A/C {i + 1} Status</th>
                  </Fragment>
                ))}
                <th className="p-3 text-right">Online Paid</th>
                <th className="p-3 text-right">Total Paid</th>
                <th className="p-3 text-center">Payment Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => !r.isSyncedFromRotaryOrg ? (
                // Non-sync club (no members synced from Rotary.org) — nothing to bill. Show one message
                // spanning Total Members → Action instead of the empty numeric/action columns.
                <tr key={r.clubDuesClubId} className="border-t bg-amber-50/70 text-amber-900">
                  <td className="p-3 align-top">
                    {r.clubName}
                    <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5" title="This club is not synced from Rotary.org">Non-sync</span>
                  </td>
                  <td colSpan={10 + maxOfflineAccountCols * 2 + maxOnlineAccountCols * 2} className="p-3 text-sm italic text-amber-700">
                    This club is not synced from Rotary.org, so it has no members to bill: sync this club first to track its dues.
                  </td>
                </tr>
              ) : (
                <tr key={r.clubDuesClubId} className="border-t">
                  <td className="p-3">
                    {r.clubName}
                    {r.hasPendingApproval && <span className="ml-2 text-xs rounded bg-blue-100 text-blue-700 px-1.5 py-0.5">offline pending</span>}
                  </td>
                  <td className="p-3 text-center" title={`${r.paidCount} paid + ${r.unpaidCount} pending`}>{r.paidCount}+{r.unpaidCount}</td>
                  <td className="p-3 text-right font-medium">{r.paidOnline === true ? "-" : `${currencySymbol()}${Number(r.offlineAmount).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                  {Array.from({ length: maxOfflineAccountCols }, (_, i) => {
                    const acc = r.paidOnline === true ? undefined : r.offlineAccountBreakdown?.[i];
                    return (
                      <Fragment key={`off-${i}`}>
                        <td className="p-3 text-right whitespace-nowrap">
                          {acc ? `${currencySymbol()}${Number(acc.amount).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                        </td>
                        <td className="p-3 text-center whitespace-nowrap" title={acc?.accountLabel || ""}>
                          {acc ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${acc.isPaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {acc.isPaid ? "Paid" : "Unpaid"}
                            </span>
                          ) : "-"}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className="p-3 text-right">{r.paidOnline === true ? "-" : `${currencySymbol()}${Number(r.offlinePaid).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                  <td className="p-3 text-right font-medium">{r.paidOnline === false ? "-" : `${currencySymbol()}${Number(r.onlineAmount).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                  {Array.from({ length: maxOnlineAccountCols }, (_, i) => {
                    const acc = r.paidOnline === false ? undefined : r.onlineAccountBreakdown?.[i];
                    return (
                      <Fragment key={`on-${i}`}>
                        <td className="p-3 text-right whitespace-nowrap">
                          {acc ? `${currencySymbol()}${Number(acc.amount).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                        </td>
                        <td className="p-3 text-center whitespace-nowrap" title={acc?.accountLabel || ""}>
                          {acc ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${acc.isPaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {acc.isPaid ? "Paid" : "Unpaid"}
                            </span>
                          ) : "-"}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className="p-3 text-right">{r.paidOnline === false ? "-" : `${currencySymbol()}${Number(r.onlinePaid).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
                  <td className="p-3 text-right">{currencySymbol()}{Number(r.totalPaid).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="p-3 text-center">{r.paidOnline == null ? "-" : r.paidOnline ? "Online" : "Offline"}</td>
                  <td className="p-3">{r.status}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {r.hasPendingApproval && <Button size="sm" onClick={() => setApproveFor(r)}>Review</Button>}
                      <Button size="sm" variant="outline" disabled={r.status === "Fully Paid"} onClick={() => setOfflineFor(r)}>Offline</Button>
                      <Button size="sm" variant="ghost" title="Send email reminder" disabled={rowBusy === `${r.fkClubId}-email`} onClick={() => emailClub(r)}>
                        {rowBusy === `${r.fkClubId}-email` ? <RotaryLoader size="sm" /> : <Bell className="h-4 w-4" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={11 + maxOfflineAccountCols * 2 + maxOnlineAccountCols * 2} className="p-8 text-center text-muted-foreground">No clubs.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {approveFor && approveFor.pendingPaymentId && (
        <ApproveDialog club={approveFor} onClose={() => setApproveFor(null)}
          onDone={(msg) => { setApproveFor(null); onSuccess(msg); load(); }} onError={onError} />
      )}

      {offlineFor && (
        <OfflineDialog duesId={duesId} club={offlineFor} onClose={() => setOfflineFor(null)}
          onDone={() => { setOfflineFor(null); onSuccess("Offline payment recorded."); load(); }} onError={onError} />
      )}
    </div>
  );
}

// District admin records an offline payment for a club — recorded as paid directly (the district is
// the authority on money it received). Mirrors the SuperAdmin clubs-page offline dialog.
function OfflineDialog({ duesId, club, onClose, onDone, onError }: { duesId: number; club: ClubRow; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [transactionType, setType] = useState("1");
  const [transactionId, setTid] = useState("");
  const [remark, setRemark] = useState("");
  const [accounts, setAccounts] = useState<ClubDuesOfflineAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getClubDuesOfflineAccounts(duesId, club.fkClubId).then(setAccounts).catch(() => {});
  }, [duesId, club.fkClubId]);

  const selectedAccount = accounts.find((a) => a.fkRouteAccountId === Number(accountId));

  const submit = async () => {
    if (accounts.length > 0 && !accountId) { onError("Select which account this payment went into."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("FkClubId", String(club.fkClubId));
      if (accountId) fd.append("FkRouteAccountId", accountId);
      fd.append("TransactionType", transactionType);
      fd.append("TransactionId", transactionId);
      fd.append("Remark", remark);
      fd.append("SendReceiptEmail", "true");
      await recordClubDuesOffline(duesId, fd);
      onDone();
    } catch (e: any) { onError(e?.response?.data?.message || "Failed to record offline payment."); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Record offline payment: {club.clubName}</h3>
        {accounts.length > 0 && (
          <div className="space-y-1">
            <Label>Account</Label>
            <select className="w-full border border-input bg-background rounded-md h-9 px-2 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Which bank account did this go into?</option>
              {accounts.map((a) => <option key={a.fkRouteAccountId} value={a.fkRouteAccountId}>{a.accountLabel}</option>)}
            </select>
          </div>
        )}
        {(accounts.length === 0 || accountId) && (
          <p className="text-sm text-muted-foreground">
            Amount: <b>{currencySymbol()}{Number(accounts.length === 0 ? club.unpaidCount * club.offlinePerMemberRate : selectedAccount?.amount ?? 0).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>. This marks the club as paid immediately.
          </p>
        )}
        <div className="space-y-1">
          <Label>Mode</Label>
          <select className="w-full border border-input bg-background rounded-md h-9 px-2 text-sm" value={transactionType} onChange={(e) => setType(e.target.value)}>
            <option value="1">Cash</option><option value="2">Cheque</option><option value="3">NEFT</option><option value="4">UPI</option><option value="5">Other</option>
          </select>
        </div>
        <div className="space-y-1"><Label>Transaction / reference</Label><Input value={transactionId} onChange={(e) => setTid(e.target.value)} /></div>
        <div className="space-y-1"><Label>Remark</Label><Input value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy && <RotaryLoader size="sm" />}Record as paid</Button>
        </div>
      </div>
    </div>
  );
}

function ApproveDialog({ club, onClose, onDone, onError }: { club: ClubRow; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (club.pendingPaymentId) getClubDuesOfflineDetails(club.pendingPaymentId).then(setDetails).catch(() => {});
  }, [club.pendingPaymentId]);

  const decide = async (isApproved: boolean) => {
    // A rejection must carry a reason; approval needs nothing. Validate here on the dialog.
    if (!isApproved && !reason.trim()) { setReasonErr(true); return; }
    setBusy(true);
    try {
      const res = await approveClubDuesPayment(club.pendingPaymentId!, { isApproved, rejectionReason: reason.trim() });
      onDone(res?.alreadyHandled ? res.message : isApproved ? "Payment approved." : "Payment rejected.");
    } catch (e: any) { onError(e?.response?.data?.message || "Failed."); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Review offline payment: {club.clubName}</h3>
        <div className="rounded-lg border p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>Members covered</span><b>{details?.memberCountCovered ?? club.unpaidCount}</b></div>
          <div className="flex justify-between"><span>Account</span><b>{details?.accountLabel || "-"}</b></div>
          <div className="flex justify-between"><span>Mode</span><b>{MODES[String(details?.transactionType)] || "–"}</b></div>
          {details?.transactionId && <div className="flex justify-between"><span>Reference</span><b>{details.transactionId}</b></div>}
          {details?.remark && <div className="flex justify-between"><span>Remark</span><span>{details.remark}</span></div>}
          <div className="flex justify-between border-t pt-1"><span>Amount</span><b>{currencySymbol()}{Number(details?.amount ?? club.unpaidCount * club.offlinePerMemberRate).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div>
        </div>
        <div className="space-y-1">
          <Label>Rejection reason <span className="text-muted-foreground">(required only to reject)</span></Label>
          <Input value={reason} onChange={(e) => { setReason(e.target.value); if (reasonErr) setReasonErr(false); }}
            className={reasonErr ? "border-red-500" : ""} placeholder="Why is this being rejected?" />
          {reasonErr && <p className="text-xs text-red-600">Please enter a reason to reject this payment.</p>}
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => decide(false)} disabled={busy}>Reject</Button>
          <Button onClick={() => decide(true)} disabled={busy}>{busy && <RotaryLoader size="sm" />}Approve</Button>
        </div>
      </div>
    </div>
  );
}
