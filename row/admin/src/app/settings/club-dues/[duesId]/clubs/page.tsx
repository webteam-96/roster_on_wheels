"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getClubDuesClubs, updateClubDuesRate, recordClubDuesOffline, approveClubDuesPayment, sendClubDuesReminder, bulkClubDuesReminder, sendClubDuesReceipt, getClubDuesOfflineDetails, updateClubDuesOffline, getClubDuesClubVendors, saveClubDuesClubVendors, getRazorpayRouteAccounts, RazorpayRouteAccount, getClubDuesOfflineAccounts, ClubDuesOfflineAccountOption, getClubDuesPayLink, getClubDuesExportUrl, syncClubDues } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, RefreshCw, Download, Bell, Link2, Check, Receipt, Pencil, Split, Plus, X, FileText, Send } from "@/components/icons";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
interface AccountBreakdown {
  fkRouteAccountId: number;
  accountLabel: string | null;
  amount: number;
  isPaid: boolean;
}
interface ClubRow {
  clubDuesClubId: number;
  fkClubId: number;
  clubName: string;
  isSyncedFromRotaryOrg: boolean;
  perMemberRate: number;
  onlinePerMemberRate: number;
  offlinePerMemberRate: number;
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  amountPaid: number;
  onlineAmount: number;
  onlinePaid: number;
  onlineAccountBreakdown: AccountBreakdown[];
  offlineAmount: number;
  offlinePaid: number;
  offlineAccountBreakdown: AccountBreakdown[];
  totalPaid: number;
  paidOnline: boolean | null;
  status: string;
  hasPendingApproval: boolean;
  pendingPaymentId?: number;
  lastPaidPaymentId?: number;
  lastOfflinePaymentId?: number;
  hasClubVendorSplit?: boolean;
}

export default function ClubDuesClubsPage() {
  const params = useParams();
  const duesId = Number(params.duesId);
  const { isSuperAdmin } = useAuth();

  const [rows, setRows] = useState<ClubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [includeNonSynced, setIncludeNonSynced] = useState(true);
  const [offlineRateEdits, setOfflineRateEdits] = useState<Record<number, string>>({});
  const [onlineRateEdits, setOnlineRateEdits] = useState<Record<number, string>>({});
  const [statusFilter, setStatusFilter] = useState("all"); // all | Fully Paid | Partial | Unpaid
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [offlineFor, setOfflineFor] = useState<ClubRow | null>(null);
  const [editOffline, setEditOffline] = useState<{ club: ClubRow; paymentId: number } | null>(null);
  const [approveFor, setApproveFor] = useState<ClubRow | null>(null);
  const [splitFor, setSplitFor] = useState<{ club: ClubRow; isOnline: boolean } | null>(null);
  const [routeAccounts, setRouteAccounts] = useState<RazorpayRouteAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkConfirmChannel, setBulkConfirmChannel] = useState<"email" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getClubDuesClubs(duesId, { search, includeNonSynced });
      setRows(data);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load clubs.");
    } finally {
      setLoading(false);
    }
  }, [duesId, search, includeNonSynced]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [includeNonSynced]);
  useEffect(() => {
    getRazorpayRouteAccounts(true)
      .then((k) => setRouteAccounts(k.filter((x) => x.isActive && ["activated", "active"].includes((x.status || "").toLowerCase()))))
      .catch(() => {});
  }, []);

  const receipt = async (r: ClubRow) => {
    if (!r.lastPaidPaymentId) return;
    try { await sendClubDuesReceipt(r.lastPaidPaymentId); setSuccess(`Receipt sent for ${r.clubName}.`); }
    catch { setError("Failed to send receipt."); }
  };

  const saveOfflineRate = async (r: ClubRow) => {
    const v = offlineRateEdits[r.clubDuesClubId];
    if (v == null || v === "" || Number(v) < 0) return;
    try {
      await updateClubDuesRate(duesId, r.clubDuesClubId, Number(v), undefined, Number(v));
      setOfflineRateEdits((p) => { const n = { ...p }; delete n[r.clubDuesClubId]; return n; });
      load();
    } catch { setError("Failed to update rate."); }
  };
  const saveOnlineRate = async (r: ClubRow) => {
    const v = onlineRateEdits[r.clubDuesClubId];
    if (v == null || v === "" || Number(v) < 0) return;
    try {
      await updateClubDuesRate(duesId, r.clubDuesClubId, r.perMemberRate, Number(v), undefined);
      setOnlineRateEdits((p) => { const n = { ...p }; delete n[r.clubDuesClubId]; return n; });
      load();
    } catch { setError("Failed to update rate."); }
  };

  const copyLink = async (r: ClubRow) => {
    try {
      const res = await getClubDuesPayLink(duesId, r.fkClubId);
      await navigator.clipboard.writeText(res.url);
      setSuccess(`Pay link for ${r.clubName} copied. This link stays active and does not expire.`);
    } catch { setError("Failed to generate link."); }
  };

  const copyReportLink = async () => {
    try {
      const url = `${window.location.origin}/report/club-dues/${duesId}`;
      await navigator.clipboard.writeText(url);
      setSuccess("Report link copied.");
    } catch { setError("Failed to copy report link."); }
  };

  // Live campaign-wide totals (from all rows, ignores the status filter).
  const summary = {
    totalClubs: rows.length,
    fullyPaid: rows.filter((r) => r.status === "Fully Paid").length,
    totalMembers: rows.reduce((s, r) => s + r.memberCount, 0),
    paidMembers: rows.reduce((s, r) => s + r.paidCount, 0),
    unpaidMembers: rows.reduce((s, r) => s + r.unpaidCount, 0),
    collected: rows.reduce((s, r) => s + Number(r.amountPaid || 0), 0),
  };

  const remind = async (r: ClubRow) => {
    try { await sendClubDuesReminder(duesId, r.fkClubId); setSuccess(`Reminder sent to ${r.clubName}.`); }
    catch { setError("Failed to send reminder."); }
  };


  // Non-sync clubs (not synced from Rotary.org — often zero-member) sink to the bottom, so they land on
  // the last page(s). Stable sort keeps each group's A-Z order from the backend.
  const filtered = (statusFilter === "all" ? [...rows] : rows.filter((r) => r.status === statusFilter))
    .sort((a, b) => Number(b.isSyncedFromRotaryOrg) - Number(a.isSyncedFromRotaryOrg));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Column counts stay stable across pages/filters — computed over all rows, not just the current page.
  const maxOnlineAccountCols = rows.reduce((m, r) => Math.max(m, r.onlineAccountBreakdown?.length || 0), 0);
  const maxOfflineAccountCols = rows.reduce((m, r) => Math.max(m, r.offlineAccountBreakdown?.length || 0), 0);
  useEffect(() => { setPage(1); }, [statusFilter, rows]);

  return (
    <ProtectedRoute>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild><Link href="/settings/club-dues"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">District Dues: Clubs</h2>
              <p className="text-muted-foreground text-base">Each club owes members × rate. Track payment status and send reminders.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={async () => { setBusy(true); try { await syncClubDues(duesId); await load(); } finally { setBusy(false); } }} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Sync members</Button>
            <Button variant="outline" size="sm" onClick={() => setBulkConfirmChannel("email")}><Bell className="mr-2 h-4 w-4" />Email all</Button>
            <Button variant="outline" size="sm" onClick={copyReportLink} title="Copy public report link"><FileText className="mr-2 h-4 w-4" />Copy report link</Button>
            <a href={getClubDuesExportUrl(duesId)}><Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" />Export</Button></a>
          </div>
        </div>

        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Clubs paid</p>
              <p className="text-2xl font-bold text-primary">{summary.fullyPaid}<span className="text-base font-normal text-muted-foreground"> / {summary.totalClubs}</span></p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total members</p>
              <p className="text-2xl font-bold text-primary">{summary.totalMembers.toLocaleString(appLocale())}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Collected</p>
              <p className="text-2xl font-bold text-primary">{currencySymbol()}{summary.collected.toLocaleString(appLocale())}</p>
            </CardContent></Card>
          </div>
        )}

        <div className="flex gap-3 items-center flex-wrap">
          <Input className="max-w-xs" placeholder="Search club" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <Button variant="outline" size="sm" onClick={load}>Search</Button>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Fully Paid">Fully Paid</SelectItem>
              <SelectItem value="Partial">Partial</SelectItem>
              <SelectItem value="Unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeNonSynced} onChange={(e) => setIncludeNonSynced(e.target.checked)} className="h-4 w-4" />
            Include non-synced clubs
          </label>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><ListPageSkeleton /></div>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B] text-left">
                  <tr>
                    <th className="p-3">Club</th>
                    <th className="p-3 text-center">Total Members</th>
                    <th className="p-3 text-right">Offline Rate</th>
                    <th className="p-3 text-right">Offline Amount</th>
                    {Array.from({ length: maxOfflineAccountCols }, (_, i) => (
                      <Fragment key={`off-${i}`}>
                        <th className="p-3 text-right whitespace-nowrap">Off. A/C {i + 1} Amount</th>
                        <th className="p-3 text-center whitespace-nowrap">Off. A/C {i + 1} Status</th>
                      </Fragment>
                    ))}
                    <th className="p-3 text-right">Offline Paid</th>
                    <th className="p-3 text-right">Online Rate</th>
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
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => !r.isSyncedFromRotaryOrg ? (
                    // Non-sync club (no members synced from Rotary.org) — nothing to bill. Show one message
                    // spanning Total Members → Action instead of the empty numeric/action columns.
                    <tr key={r.clubDuesClubId} className="border-t bg-amber-50/70 text-amber-900">
                      <td className="p-3 align-top">
                        {r.clubName}
                        <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5" title="This club is not synced from Rotary.org">non-sync</span>
                      </td>
                      <td colSpan={10 + maxOfflineAccountCols * 2 + maxOnlineAccountCols * 2} className="p-3 text-sm italic text-amber-700">
                        This club is not synced from Rotary.org, so it has no members to bill: sync this club first to track its dues.
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.clubDuesClubId} className="border-t">
                      <td className="p-3">
                        {r.clubName}
                        {r.hasPendingApproval && <span className="ml-2 text-xs rounded bg-blue-100 text-blue-700 px-1.5 py-0.5">pending approval</span>}
                      </td>
                      <td className="p-3 text-center" title={`${r.paidCount} paid + ${r.unpaidCount} pending`}>{r.paidCount}+{r.unpaidCount}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input className="h-8 w-20" type="number" value={offlineRateEdits[r.clubDuesClubId] ?? String(r.offlinePerMemberRate)}
                            onChange={(e) => setOfflineRateEdits((p) => ({ ...p, [r.clubDuesClubId]: e.target.value }))} />
                          {offlineRateEdits[r.clubDuesClubId] != null && offlineRateEdits[r.clubDuesClubId] !== String(r.offlinePerMemberRate) && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveOfflineRate(r)}><Check className="h-4 w-4" /></Button>
                          )}
                        </div>
                      </td>
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
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input className="h-8 w-20" type="number" value={onlineRateEdits[r.clubDuesClubId] ?? String(r.onlinePerMemberRate)}
                            onChange={(e) => setOnlineRateEdits((p) => ({ ...p, [r.clubDuesClubId]: e.target.value }))} />
                          {onlineRateEdits[r.clubDuesClubId] != null && onlineRateEdits[r.clubDuesClubId] !== String(r.onlinePerMemberRate) && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveOnlineRate(r)}><Check className="h-4 w-4" /></Button>
                          )}
                        </div>
                      </td>
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
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex gap-1 flex-nowrap">
                          <Button size="sm" variant="outline" disabled={r.unpaidCount === 0} onClick={() => setOfflineFor(r)}>Offline</Button>
                          {r.lastOfflinePaymentId && <Button size="sm" variant="ghost" onClick={() => setEditOffline({ club: r, paymentId: r.lastOfflinePaymentId! })} title="Edit offline payment"><Pencil className="h-4 w-4" /></Button>}
                          {r.hasPendingApproval && <Button size="sm" onClick={() => setApproveFor(r)}>Review</Button>}
                          {r.lastPaidPaymentId && <Button size="sm" variant="ghost" onClick={() => receipt(r)} title="Send receipt"><Receipt className="h-4 w-4" /></Button>}
                          <Button size="sm" variant="ghost" onClick={() => setSplitFor({ club: r, isOnline: true })} title={r.hasClubVendorSplit ? "Per-club online split" : "Set per-club online split"}>
                            <Split className={`h-4 w-4 ${r.hasClubVendorSplit ? "text-primary" : ""}`} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setSplitFor({ club: r, isOnline: false })} title={r.hasClubVendorSplit ? "Per-club offline split" : "Set per-club offline split"}>
                            <Split className={`h-4 w-4 rotate-90 ${r.hasClubVendorSplit ? "text-primary" : ""}`} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => copyLink(r)} title="Copy 3-hour pay link"><Link2 className="h-4 w-4" /></Button>
                          {r.status === "Fully Paid" ? (
                            // Fully paid — nothing left to remind about. Receipt is already offered above
                            // (lastPaidPaymentId); reminder buttons would just be noise/confusing here.
                            null
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => remind(r)} title="Send email reminder"><Bell className="h-4 w-4" /></Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={11 + maxOfflineAccountCols * 2 + maxOnlineAccountCols * 2} className="p-8 text-center text-muted-foreground">No clubs.</td></tr>}
                </tbody>
              </table>
            </CardContent>
            {filtered.length > PAGE_SIZE && (
              <div className="p-3 border-t"><Pagination page={page} totalPages={totalPages} totalCount={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>
            )}
          </Card>
        )}
      </div>

      {offlineFor && (
        <OfflineDialog duesId={duesId} club={offlineFor} onClose={() => setOfflineFor(null)}
          onDone={() => { setOfflineFor(null); setSuccess("Offline payment recorded."); load(); }} onError={setError} />
      )}
      {editOffline && (
        <OfflineDialog duesId={duesId} club={editOffline.club} editPaymentId={editOffline.paymentId} onClose={() => setEditOffline(null)}
          onDone={() => { setEditOffline(null); setSuccess("Offline payment updated."); load(); }} onError={setError} />
      )}
      {approveFor && approveFor.pendingPaymentId && (
        <ApproveDialog club={approveFor} onClose={() => setApproveFor(null)}
          onDone={(msg) => { setApproveFor(null); setSuccess(msg); load(); }} onError={setError} />
      )}
      {splitFor && (
        <SplitDialog duesId={duesId} club={splitFor.club} isOnline={splitFor.isOnline} routeAccounts={routeAccounts} onClose={() => setSplitFor(null)}
          onDone={() => { setSplitFor(null); setSuccess("Per-club split saved."); load(); }} onError={setError} />
      )}

      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />

      <AlertModal
        open={!!bulkConfirmChannel}
        icon={Send}
        iconClassName="text-orange-600"
        title="Send Email Reminder to All Clubs"
        description="Send an email reminder to every unpaid club in this campaign? This cannot be undone."
        confirmLabel="Send"
        confirmClassName="bg-[#17458F] text-white hover:bg-[#17458F]"
        onConfirm={async () => {
          setBulkConfirmChannel(null);
          try {
            await bulkClubDuesReminder(duesId);
            setSuccess("Email reminders sent to all unpaid clubs.");
          } catch { setError("Failed."); }
        }}
        cancelLabel="Cancel"
        onCancel={() => setBulkConfirmChannel(null)}
      />
    </ProtectedRoute>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function OfflineDialog({ duesId, club, editPaymentId, onClose, onDone, onError }: { duesId: number; club: ClubRow; editPaymentId?: number; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [transactionType, setType] = useState("1");
  const [transactionId, setTid] = useState("");
  const [remark, setRemark] = useState("");
  const [accounts, setAccounts] = useState<ClubDuesOfflineAccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const isEdit = !!editPaymentId;

  useEffect(() => {
    getClubDuesOfflineAccounts(duesId, club.fkClubId).then(setAccounts).catch(() => {});
  }, [duesId, club.fkClubId]);

  useEffect(() => {
    if (editPaymentId) {
      getClubDuesOfflineDetails(editPaymentId).then((d: any) => {
        setType(d.transactionType || "1");
        setTid(d.transactionId || "");
        setRemark(d.remark || "");
        setAccountId(d.fkRouteAccountId ? String(d.fkRouteAccountId) : "");
      }).catch(() => {});
    }
  }, [editPaymentId]);

  const selectedAccount = accounts.find((a) => a.fkRouteAccountId === Number(accountId));

  const submit = async () => {
    if (!isEdit && accounts.length > 0 && !accountId) { onError("Select which account this payment went into."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("FkClubId", String(club.fkClubId));
      if (accountId) fd.append("FkRouteAccountId", accountId);
      fd.append("TransactionType", transactionType);
      fd.append("TransactionId", transactionId);
      fd.append("Remark", remark);
      fd.append("SendReceiptEmail", "true");
      if (isEdit) await updateClubDuesOffline(editPaymentId!, fd);
      else await recordClubDuesOffline(duesId, fd);
      onDone();
    } catch (e: any) { onError(e?.response?.data?.message || "Failed."); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${isEdit ? "Edit" : "Record"} offline payment: ${club.clubName}`} onClose={onClose}>
      {isEdit && <p className="text-xs text-amber-600">Saving a pending payment also approves it.</p>}
      {accounts.length > 0 && (
        <div className="space-y-2">
          <Label>Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Which bank account did this go into?" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => <SelectItem key={a.fkRouteAccountId} value={String(a.fkRouteAccountId)}>{a.accountLabel}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {!isEdit && (accounts.length === 0 || accountId) && (
        <p className="text-sm text-muted-foreground">
          Amount: <b>{currencySymbol()}{Number(accounts.length === 0 ? club.unpaidCount * club.offlinePerMemberRate : selectedAccount?.amount ?? 0).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>.
        </p>
      )}
      <div className="space-y-2">
        <Label>Mode</Label>
        <select className="w-full border border-input bg-background rounded-md h-9 px-2 text-sm" value={transactionType} onChange={(e) => setType(e.target.value)}>
          <option value="1">Cash</option><option value="2">Cheque</option><option value="3">NEFT</option><option value="4">UPI</option><option value="5">Other</option>
        </select>
      </div>
      <div className="space-y-2"><Label>Transaction / reference</Label><Input value={transactionId} onChange={(e) => setTid(e.target.value)} /></div>
      <div className="space-y-2"><Label>Remark</Label><Input value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy && <RotaryLoader size="sm" />}{isEdit ? "Save changes" : "Record as paid"}</Button>
      </div>
    </Modal>
  );
}

function SplitDialog({ duesId, club, isOnline, routeAccounts, onClose, onDone, onError }: { duesId: number; club: ClubRow; isOnline: boolean; routeAccounts: RazorpayRouteAccount[]; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [amountType, setAmountType] = useState("2"); // 1=amount, 2=percentage
  const [rows, setRows] = useState<{ routeAccountId: string; value: string }[]>([{ routeAccountId: "", value: "" }]);
  const [busy, setBusy] = useState(false);
  const rate = Number(isOnline ? club.onlinePerMemberRate : club.offlinePerMemberRate) || 0;

  useEffect(() => {
    getClubDuesClubVendors(duesId, club.fkClubId).then((vs: any[]) => {
      const channelRows = (vs || []).filter((v) => (v.isOnline !== false) === isOnline);
      if (channelRows.length > 0) {
        // stored as percentage; show as % (amount mode reconstruct not needed — default to %)
        setAmountType("2");
        setRows(channelRows.map((v) => ({ routeAccountId: String(v.fkRouteAccountId), value: v.splitPercentage ? String(v.splitPercentage) : "" })));
      }
    }).catch(() => {});
  }, [duesId, club.fkClubId, isOnline]);

  const filled = rows.filter((r) => r.routeAccountId && Number(r.value) > 0);
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const target = amountType === "2" ? 100 : rate;
  const ok = filled.length === 0 || Math.abs(total - target) < 0.01;
  const update = (i: number, f: "routeAccountId" | "value", v: string) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)));

  const save = async () => {
    if (filled.length > 0 && !ok) { onError(amountType === "2" ? "Percentages must total 100%." : `Amounts must total ${currencySymbol()}${rate}.`); return; }
    setBusy(true);
    try {
      const vendors = filled.map((r) => {
        const acc = routeAccounts.find((x) => x.id === Number(r.routeAccountId));
        const val = Number(r.value);
        return {
          fkRouteAccountId: Number(r.routeAccountId),
          accountId: acc?.accountId || "",
          splitPercentage: amountType === "2" ? val : (rate > 0 ? (val / rate) * 100 : 0),
          splitAmount: amountType === "1" ? val : 0,
        };
      });
      await saveClubDuesClubVendors(duesId, club.fkClubId, JSON.stringify(vendors), isOnline);
      onDone();
    } catch (e: any) { onError(e?.response?.data?.message || "Failed."); } finally { setBusy(false); }
  };

  return (
    <Modal title={`${isOnline ? "Online" : "Offline"} split: ${club.clubName}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">Overrides the campaign&apos;s {isOnline ? "online" : "offline"} split for this club only (rate {currencySymbol()}{rate}/member). Clear all to use the campaign default.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>Split by</Label>
        <div className="inline-flex rounded-md border overflow-hidden text-sm">
          <button type="button" onClick={() => setAmountType("2")} className={`px-3 py-1 ${amountType === "2" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Percentage</button>
          <button type="button" onClick={() => setAmountType("1")} className={`px-3 py-1 ${amountType === "1" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Amount</button>
        </div>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Select value={row.routeAccountId} onValueChange={(v) => update(i, "routeAccountId", v)}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {routeAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>••••{a.bankAccountLast4 || "----"} · IFSC {a.bankIfsc || "N/A"}: {a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="w-24"><Input type="number" value={row.value} onChange={(e) => update(i, "value", e.target.value)} placeholder={amountType === "2" ? "%" : currencySymbol()} /></div>
          <Button variant="ghost" size="icon" onClick={() => setRows((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))} disabled={rows.length === 1}><X className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, { routeAccountId: "", value: "" }])}><Plus className="mr-1 h-4 w-4" />Add</Button>
        {filled.length > 0 && <span className={`text-sm ${ok ? "text-green-600" : "text-red-600"}`}>Total: {amountType === "2" ? `${total}% / 100%` : `${currencySymbol()}${total} / ${currencySymbol()}${rate}`}</span>}
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy && <RotaryLoader size="sm" />}Save</Button>
      </div>
    </Modal>
  );
}

function ApproveDialog({ club, onClose, onDone, onError }: { club: ClubRow; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    if (club.pendingPaymentId) getClubDuesOfflineDetails(club.pendingPaymentId).then(setDetail).catch(() => {});
  }, [club.pendingPaymentId]);

  const decide = async (isApproved: boolean) => {
    // A rejection must carry a reason; approval needs nothing. Validate here on the dialog.
    if (!isApproved && !reason.trim()) { setReasonErr(true); return; }
    setBusy(true);
    try {
      const res = await approveClubDuesPayment(club.pendingPaymentId!, { isApproved, rejectionReason: reason.trim() });
      onDone(res?.alreadyHandled ? res.message : isApproved ? "Approved." : "Rejected.");
    } catch (e: any) { onError(e?.response?.data?.message || "Failed."); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Review offline payment: ${club.clubName}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Amount: <b>{currencySymbol()}{Number(detail?.amount ?? club.unpaidCount * club.offlinePerMemberRate).toLocaleString(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>{" "}
        for {detail?.memberCountCovered ?? club.unpaidCount} member(s).
      </p>
      <p className="text-sm text-muted-foreground">Account: <b>{detail?.accountLabel || "-"}</b></p>
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
    </Modal>
  );
}
