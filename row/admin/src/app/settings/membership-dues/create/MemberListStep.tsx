import { IconButton } from "@/components/ui/icon-button";
import { LinkButton } from "@/components/ui/text-buttons";
import React from "react";
import DateField from "@/components/DateField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Lock, Mail, FileText, Search as SearchIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
import type { MembershipDuesFormCtx } from "./useMembershipDuesForm";

export default function MemberListStep({ v }: { v: MembershipDuesFormCtx }) {
  const { isEdit, clubMembers, PAGE_SIZE, newMemberPage, clubMembersLoading, enabledFeeTypes, addedVendorIds, kycVendors, getAccountLabel, isOfflineOnly, memberCategoryOverrides, defaultCategoryType, setMemberCategoryOverrides, getMemberFee, getVendorTotalForBalance, amountType, setMemberFee, isDefaultKyc, getMemberVendor, setMemberVendor, cur, setNewMemberPage, editMembers, editMemberSearch, editMemberPage, setEditMemberSearch, setEditMemberPage, savedNotify, setBulkRemarkDialogOpen, editMembersLoading, getEditVendors, editMemberChanges, setEditMemberChanges, getEditFeeAmount, getEditFeeStatus, getEditPaymentInfo, isBalanceExcludedEditVendor, setEditMemberFee, isDefaultEditVendor, getUnpaidFeeTypes, setOfflineMember, setOfflineFeeType, setOfflinePaymentMode, setOfflineTxnId, setOfflineGivenTo, setOfflineDate, setOfflineRemark, setOfflineDialogOpen, setEmailRemarkMemberFeeId, setEmailRemark, setEmailRemarkDialogOpen, hasAnyPaidFee, handleReceipt, handleApprove, setRejectPaymentId, setRejectDialogOpen, offlineDialogOpen, resetOfflineDialog, offlineMember, offlineFeeType, offlinePaymentMode, offlineTxnId, offlineGivenTo, offlineDate, offlineRemark, setOfflineAttachment, offlineSendEmail, setOfflineSendEmail, handleOfflineSave, offlineSaving, rejectDialogOpen, rejectReason, setRejectReason, handleRejectSubmit, bulkRemarkDialogOpen, bulkRemark, setBulkRemark, handleBulkEmailReminder, emailRemarkDialogOpen, emailRemark, handleEmailReminder, emailRemarkMemberFeeId } = v;


  // ---- Dual-mode Step 4 ----
  const renderStep4MemberList = () => {
    if (isEdit) return renderStep4EditMode();
    return renderStep4NewMode();
  };

  const renderStep4NewMode = () => {
    const totalNewPages = Math.ceil(clubMembers.length / PAGE_SIZE);
    const pagedNewMembers = clubMembers.slice((newMemberPage - 1) * PAGE_SIZE, newMemberPage * PAGE_SIZE);

    return (
    <Card>
      <CardHeader>
        <CardTitle>Member List Preview</CardTitle>
        <p className="text-sm text-muted-foreground">Preview of fees allocated to all club members. You can edit individual fees and vendor costs before saving.</p>
      </CardHeader>
      <CardContent>
        {clubMembersLoading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : clubMembers.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No members found for this club.</div>
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-30 w-16 min-w-[64px]">Sr.No</TableHead>
                  <TableHead className="sticky left-[64px] z-30 w-48 min-w-[192px]">Name</TableHead>
                  <TableHead className="sticky left-[256px] z-30 w-32 min-w-[128px] border-r border-slate-300">Category</TableHead>
                  {enabledFeeTypes.map(ft => (
                    <React.Fragment key={ft.type}>
                      <TableHead>{ft.label}</TableHead>
                      {addedVendorIds.map(kycId => (
                        <TableHead key={kycId} title={kycVendors.find(k => k.id === kycId)?.name || ""}>{getAccountLabel(kycId)}</TableHead>
                      ))}
                      {!isOfflineOnly && <TableHead>Balance</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead>Payment Info</TableHead>
                    </React.Fragment>
                  ))}
                  <TableHead>Approve/Reject</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedNewMembers.map((member, idx) => {
                  const mId = member.id || member.pk_member_master_profile_id || idx;
                  const globalIdx = (newMemberPage - 1) * PAGE_SIZE + idx + 1;
                  return (
                    <TableRow key={mId} className="bg-card">
                      <TableCell className="sticky left-0 z-10 bg-slate-100 w-16 min-w-[64px]">{globalIdx}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap sticky left-[64px] z-10 bg-slate-100 w-48 min-w-[192px]">{member.memberName || member.name || member.MemberName}</TableCell>
                      <TableCell className="sticky left-[256px] z-10 bg-slate-100 w-32 min-w-[128px] border-r border-slate-300">
                        <Input className="row-field-sm w-24"
                          value={memberCategoryOverrides[`${mId}_category`] ?? defaultCategoryType}
                          onChange={e => setMemberCategoryOverrides(prev => ({ ...prev, [`${mId}_category`]: e.target.value }))}
                        />
                      </TableCell>
                      {enabledFeeTypes.map(ft => {
                        const feeAmt = getMemberFee(mId, ft.type);
                        const vendorTotal = getVendorTotalForBalance(mId, ft.type);
                        const balance = amountType === "1" ? feeAmt - vendorTotal : 100 - vendorTotal;
                        return (
                          <React.Fragment key={ft.type}>
                            {/* Editable Fee Amount */}
                            <TableCell>
                              <Input
                                type="number" step="0.01" className="row-field-sm w-24"
                                value={feeAmt || ""}
                                onChange={e => setMemberFee(mId, ft.type, Number(e.target.value))}
                              />
                            </TableCell>
                            {/* Editable Vendor Amounts */}
                            {addedVendorIds.map(kycId => {
                              // Lock is DEFAULT-only: the saraswat plug is excluded from the
                              // balance but stays editable.
                              const isDefault = isDefaultKyc(kycId);
                              const vAmt = getMemberVendor(mId, ft.type, kycId);
                              return (
                                <TableCell key={kycId}>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number" step="0.01"
                                      className={`w-20 h-8 text-xs ${isDefault ? "bg-gray-100" : ""}`}
                                      value={vAmt || ""}
                                      disabled={isDefault}
                                      onChange={e => setMemberVendor(mId, ft.type, kycId, Number(e.target.value))}
                                    />
                                    {isDefault && <Lock className="h-3 w-3 text-muted-foreground" />}
                                  </div>
                                </TableCell>
                              );
                            })}
                            {/* Balance (no split for offline only) */}
                            {!isOfflineOnly && <TableCell className={Math.abs(balance) > 0.01 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                              {amountType === "1" ? `${cur}${balance.toFixed(2)}` : `${balance.toFixed(2)}%`}
                            </TableCell>}
                            {/* Status */}
                            <TableCell>
                              <Badge variant="destructive">Unpaid</Badge>
                            </TableCell>
                            {/* Payment Info */}
                            <TableCell className="text-xs text-muted-foreground">{"\u2014"}</TableCell>
                          </React.Fragment>
                        );
                      })}
                      {/* Approve/Reject */}
                      <TableCell className="text-xs text-muted-foreground">{"\u2014"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="p-3 border-t"><Pagination page={newMemberPage} totalPages={totalNewPages} totalCount={clubMembers.length} pageSize={PAGE_SIZE} onPageChange={setNewMemberPage} /></div>
          </Card>
        )}
      </CardContent>
    </Card>
    );
  };

  const renderStep4EditMode = () => {
    const sorted = [...editMembers].sort((a, b) => {
      const aS = a.hasPendingApproval ? 0 : a.isNewMember ? 1 : 2;
      const bS = b.hasPendingApproval ? 0 : b.isNewMember ? 1 : 2;
      return aS - bS;
    });
    const searched = editMemberSearch
      ? sorted.filter(m => (m.memberName || "").toLowerCase().includes(editMemberSearch.toLowerCase()))
      : sorted;
    const totalPages = Math.ceil(searched.length / PAGE_SIZE);
    const paged = searched.slice((editMemberPage - 1) * PAGE_SIZE, editMemberPage * PAGE_SIZE);

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Member List</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search member..." value={editMemberSearch} onChange={e => { setEditMemberSearch(e.target.value); setEditMemberPage(1); }} className="pl-9 w-48" />
              </div>
              {savedNotify.email && <Button size="sm" variant="outline" onClick={() => setBulkRemarkDialogOpen(true)}><Mail className="h-4 w-4 mr-1" />Bulk Email</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {editMembersLoading ? (
            <div className="flex justify-center py-10"><ListPageSkeleton /></div>
          ) : paged.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No members found.</div>
          ) : (
            <>
              <Card className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-30 w-16 min-w-[64px]">Sr.No</TableHead>
                      <TableHead className="sticky left-[64px] z-30 w-48 min-w-[192px]">Name</TableHead>
                      <TableHead className="sticky left-[256px] z-30 w-32 min-w-[128px] border-r border-slate-300">Category</TableHead>
                      {enabledFeeTypes.map(ft => (
                        <React.Fragment key={ft.type}>
                          <TableHead>{ft.label}</TableHead>
                          {(getEditVendors(paged[0] || {}, ft.type)).map((v: any, i: number) => (
                            <TableHead key={i} title={v.vendorName || v.VendorName || ""}>{v.accountLabel || `A/C${i+1}`}</TableHead>
                          ))}
                          {!isOfflineOnly && <TableHead>Balance</TableHead>}
                          <TableHead>Status</TableHead>
                          <TableHead>Payment</TableHead>
                        </React.Fragment>
                      ))}
                      <TableHead>Offline</TableHead>
                      <TableHead>Reminder</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Approve/Reject</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((m, idx) => {
                      const isNew = m.isNewMember;
                      const isPending = m.hasPendingApproval;
                      // Default to bg-card so sticky cells (bg-inherit) cover scrolling content underneath
                      const rowClass = isPending ? "bg-yellow-100" : isNew ? "bg-green-200" : "bg-card";
                      const globalIdx = (editMemberPage - 1) * PAGE_SIZE + idx + 1;
                      return (
                        <TableRow key={m.memberFeeId || idx} className={rowClass}>
                          <TableCell className="sticky left-0 z-10 w-16 min-w-[64px] bg-slate-100">{globalIdx}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap sticky left-[64px] z-10 w-48 min-w-[192px] bg-slate-100">{m.memberName}</TableCell>
                          <TableCell className="sticky left-[256px] z-10 w-32 min-w-[128px] border-r border-slate-300 bg-slate-100">
                            <Input className="row-field-sm w-24"
                              value={editMemberChanges[`${m.memberFeeId}_cat`] ?? m.categoryType ?? ""}
                              onChange={e => setEditMemberChanges(prev => ({ ...prev, [`${m.memberFeeId}_cat`]: e.target.value }))}
                            />
                          </TableCell>
                          {enabledFeeTypes.map(ft => {
                            const feeAmt = editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`] !== undefined
                              ? Number(editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`])
                              : getEditFeeAmount(m, ft.type);
                            const status = getEditFeeStatus(m, ft.type);
                            const payInfo = getEditPaymentInfo(m, ft.type);
                            const vendors = getEditVendors(m, ft.type);
                            const frozen = status === "Paid" || status === "Pending" || status === "N/A";
                            // Recalculate balance with overrides. The default account and the
                            // saraswat rounding plug are excluded — they receive/absorb the
                            // balance rather than consuming the fee.
                            let vendorTotal = 0;
                            vendors.forEach((v: any, i: number) => {
                              if (isBalanceExcludedEditVendor(v)) return;
                              const vKey = `${m.memberFeeId}_v_${ft.type}_${i}`;
                              vendorTotal += editMemberChanges[vKey] !== undefined ? Number(editMemberChanges[vKey]) : (v.amount ?? v.Amount ?? 0);
                            });
                            const balance = feeAmt - vendorTotal;
                            return (
                              <React.Fragment key={ft.type}>
                                <TableCell className={frozen ? "bg-gray-100" : ""}>
                                  {frozen ? (
                                    <span className="text-sm font-medium text-green-600">{cur}{feeAmt.toFixed(2)}</span>
                                  ) : (
                                    <Input type="number" step="0.01" className="row-field-sm w-24"
                                      value={editMemberChanges[`${m.memberFeeId}_fee_${ft.type}`] ?? (feeAmt || "")}
                                      onChange={e => setEditMemberFee(m, ft.type, e.target.value)}
                                    />
                                  )}
                                </TableCell>
                                {vendors.map((v: any, i: number) => {
                                  const isDefVendor = isDefaultEditVendor(v);
                                  const vKey = `${m.memberFeeId}_v_${ft.type}_${i}`;
                                  const vAmt = editMemberChanges[vKey] !== undefined ? Number(editMemberChanges[vKey]) : (v.amount ?? v.Amount ?? 0);
                                  return (
                                    <TableCell key={i} className={`text-xs ${frozen ? "bg-gray-100" : ""}`}>
                                      {frozen || isDefVendor ? (
                                        <div className="flex items-center gap-0.5">
                                          <span>{cur}{vAmt.toFixed(2)}</span>
                                          {isDefVendor && <Lock className="h-3 w-3 text-muted-foreground" />}
                                        </div>
                                      ) : (
                                        <Input type="number" step="0.01" className="row-field-sm w-20"
                                          value={editMemberChanges[vKey] ?? (vAmt || "")}
                                          onChange={e => setEditMemberChanges(prev => ({ ...prev, [vKey]: e.target.value }))}
                                        />
                                      )}
                                    </TableCell>
                                  );
                                })}
                                {/* Frozen rows (Paid / Pending / N/A) are shown neutrally: their
                                    mismatch is deliberately not validated, so the alarming red
                                    would be misleading. Unpaid rows keep red/green as before. */}
                                {!isOfflineOnly && <TableCell className={`font-medium ${frozen ? "text-muted-foreground bg-gray-100" : Math.abs(balance) > 0.01 ? "text-red-600" : "text-green-600"}`}>
                                  {cur}{balance.toFixed(2)}
                                </TableCell>}
                                <TableCell>
                                  <Badge variant={status === "Paid" ? "default" : status === "Pending" ? "secondary" : status === "N/A" ? "outline" : "destructive"}
                                    className={`text-xs ${status === "Paid" ? "bg-green-600" : status === "Pending" ? "bg-yellow-500" : status === "N/A" ? "bg-gray-400 text-white" : "bg-red-600"}`}>
                                    {status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{payInfo}</TableCell>
                              </React.Fragment>
                            );
                          })}
                          {/* Offline */}
                          <TableCell>
                            {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                              <LinkButton size="sm" className="whitespace-nowrap" onClick={() => {
                                setOfflineMember(m);
                                // Pre-fill with pending payment details if exists
                                if (m.hasPendingApproval || m.HasPendingApproval) {
                                  setOfflineFeeType(String(m.pendingFeeType ?? m.PendingFeeType ?? ""));
                                  setOfflinePaymentMode(m.pendingTransactionType ?? m.PendingTransactionType ?? "Cash");
                                  setOfflineTxnId(m.pendingTransactionId ?? m.PendingTransactionId ?? "");
                                  setOfflineGivenTo(m.pendingGivenTo ?? m.PendingGivenTo ?? "");
                                  setOfflineDate(m.pendingPaymentDate ?? m.PendingPaymentDate ? new Date(m.pendingPaymentDate || m.PendingPaymentDate).toISOString().split("T")[0] : "");
                                  setOfflineRemark(m.pendingRemark ?? m.PendingRemark ?? "");
                                }
                                setOfflineDialogOpen(true);
                              }}>
                                {(m.hasPendingApproval || m.HasPendingApproval) ? "View Offline" : "Update Offline"}
                              </LinkButton>
                            )}
                          </TableCell>
                          <TableCell>
                            {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {savedNotify.email && (
                                <IconButton aria-label="Send Email Reminder" title="Send Email Reminder" onClick={() => { setEmailRemarkMemberFeeId(m.memberFeeId); setEmailRemark(""); setEmailRemarkDialogOpen(true); }}>
                                  <Mail className="h-4 w-4 text-orange-600" />
                                </IconButton>
                                )}
                              </div>
                            )}
                          </TableCell>
                          {/* Receipt — email only */}
                          <TableCell>
                            {!isNew && hasAnyPaidFee(m) && savedNotify.email && (
                              <LinkButton size="sm" tone="muted" className="whitespace-nowrap" onClick={() => handleReceipt(m.memberFeeId)}>Send</LinkButton>
                            )}
                          </TableCell>
                          {/* Approve/Reject */}
                          <TableCell>
                            {!isNew && isPending && (
                              <div className="flex gap-1">
                                <LinkButton size="sm" onClick={() => handleApprove(m.pendingPaymentId ?? m.PendingPaymentId ?? m.memberFeeId)}>Approve</LinkButton>
                                <LinkButton size="sm" tone="danger" onClick={() => { setRejectPaymentId(m.pendingPaymentId ?? m.PendingPaymentId ?? m.memberFeeId); setRejectDialogOpen(true); }}>Reject</LinkButton>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
              {/* Pagination */}
              <div className="p-3 border-t"><Pagination page={editMemberPage} totalPages={totalPages} totalCount={searched.length} pageSize={PAGE_SIZE} onPageChange={setEditMemberPage} /></div>
            </>
          )}

          {/* Offline Payment Dialog */}
          <Dialog open={offlineDialogOpen} onOpenChange={v => { if (!v) resetOfflineDialog(); }}>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{(offlineMember?.hasPendingApproval || offlineMember?.HasPendingApproval) ? "View Offline Payment" : "Record Offline Payment"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 bg-muted/30 p-4 rounded-lg">
                  <h4 className="font-semibold">Member Info</h4>
                  <p className="text-sm"><strong>Name:</strong> {offlineMember?.memberName}</p>
                  <p className="text-sm"><strong>Category:</strong> {offlineMember?.categoryType}</p>
                  {(offlineMember?.hasPendingApproval || offlineMember?.HasPendingApproval) && (
                    <>
                      <hr className="my-2" />
                      <h4 className="font-semibold text-yellow-700">Pending Submission Details</h4>
                      {(offlineMember?.pendingFeeType || offlineMember?.PendingFeeType) && (
                        <p className="text-sm"><strong>Fee Type:</strong> {
                          (offlineMember.pendingFeeType ?? offlineMember.PendingFeeType) === 1 ? (enabledFeeTypes.find(f => f.type === 1)?.label || "Annual") :
                          (offlineMember.pendingFeeType ?? offlineMember.PendingFeeType) === 2 ? (enabledFeeTypes.find(f => f.type === 2)?.label || "Semi Annual 1") :
                          (enabledFeeTypes.find(f => f.type === 3)?.label || "Semi Annual 2")
                        }</p>
                      )}
                      {(offlineMember?.pendingAmount ?? offlineMember?.PendingAmount) != null && (
                        <p className="text-sm"><strong>Amount:</strong> {cur}{Number(offlineMember.pendingAmount ?? offlineMember.PendingAmount).toFixed(2)}</p>
                      )}
                      {(offlineMember?.pendingTransactionType || offlineMember?.PendingTransactionType) && (
                        <p className="text-sm"><strong>Payment Mode:</strong> {offlineMember.pendingTransactionType || offlineMember.PendingTransactionType}</p>
                      )}
                      {(offlineMember?.pendingTransactionId || offlineMember?.PendingTransactionId) && (
                        <p className="text-sm"><strong>Transaction ID:</strong> {offlineMember.pendingTransactionId || offlineMember.PendingTransactionId}</p>
                      )}
                      {(offlineMember?.pendingGivenTo || offlineMember?.PendingGivenTo) && (
                        <p className="text-sm"><strong>Given To:</strong> {offlineMember.pendingGivenTo || offlineMember.PendingGivenTo}</p>
                      )}
                      {(offlineMember?.pendingPaymentDate || offlineMember?.PendingPaymentDate) && (
                        <p className="text-sm"><strong>Date:</strong> {new Date(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate).toLocaleDateString(appLocale())}</p>
                      )}
                      {(offlineMember?.pendingRemark || offlineMember?.PendingRemark) && (
                        <p className="text-sm"><strong>Remark:</strong> {offlineMember.pendingRemark || offlineMember.PendingRemark}</p>
                      )}
                      {(offlineMember?.pendingAttachment || offlineMember?.PendingAttachment) && (
                        <a href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                          target="_blank" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" /> View Attachment
                        </a>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <Label>Fee Type <span className="text-destructive">*</span></Label>
                    <Select value={offlineFeeType} onValueChange={setOfflineFeeType}>
                      <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                      <SelectContent>
                        {offlineMember && getUnpaidFeeTypes(offlineMember).map(ft => (
                          <SelectItem key={ft.type} value={String(ft.type)}>{ft.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Payment Mode</Label>
                    <div className="flex gap-3 mt-1">
                      {["NEFT/IMPS/RTGS", "Cash", "Cheque"].map(mode => (
                        <label key={mode} className="flex items-center gap-1.5 text-sm">
                          <input type="radio" name="offlineMode" value={mode} checked={offlinePaymentMode === mode} onChange={e => setOfflinePaymentMode(e.target.value)} className="accent-primary" />
                          {mode}
                        </label>
                      ))}
                    </div>
                  </div>
                  {offlinePaymentMode === "NEFT/IMPS/RTGS" && (
                    <div><Label>Transaction ID</Label><Input value={offlineTxnId} onChange={e => setOfflineTxnId(e.target.value)} placeholder="Enter transaction ID" /></div>
                  )}
                  {(offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") && (
                    <div><Label>Given To <span className="text-destructive">*</span></Label><Input value={offlineGivenTo} onChange={e => setOfflineGivenTo(e.target.value)} placeholder="Enter name" /></div>
                  )}
                  <div><Label>Date <span className="text-destructive">*</span></Label><DateField value={offlineDate} onChange={setOfflineDate} /></div>
                  <div><Label>Remark</Label><Input value={offlineRemark} onChange={e => setOfflineRemark(e.target.value)} placeholder="Optional remark" /></div>
                  <div>
                    <Label>Attachment</Label>
                    <Input type="file" accept="image/*,.pdf"
                      onChange={e => {
                        const f = e.target.files?.[0] || null;
                        if (f && !(f.type.startsWith("image/") || f.type === "application/pdf")) {
                          alert("Only image files or PDF are allowed.");
                          e.target.value = "";
                          setOfflineAttachment(null);
                          return;
                        }
                        setOfflineAttachment(f);
                      }} />
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX</p>
                    {offlineMember && (offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                      <a href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                        target="_blank" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View existing attachment</a>
                    )}
                  </div>
                  {savedNotify.email && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Checkbox checked={offlineSendEmail} onCheckedChange={c => setOfflineSendEmail(!!c)} id="offlineSendEmail" />
                    <Label htmlFor="offlineSendEmail">Send Email Receipt</Label>
                  </div>
                  )}
                  <Button onClick={handleOfflineSave} disabled={offlineSaving} className="w-full">
                    {offlineSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Save
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Reject Dialog */}
          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Reject Payment</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Rejection Reason</Label><Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Enter reason for rejection" /></div>
                <Button variant="destructive" onClick={handleRejectSubmit} className="w-full">Reject Payment</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Bulk Email Remark Dialog */}
          <Dialog open={bulkRemarkDialogOpen} onOpenChange={setBulkRemarkDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Send Bulk Email Reminders</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Remark (optional)</Label><Input value={bulkRemark} onChange={e => setBulkRemark(e.target.value)} placeholder="Optional remark" /></div>
                <Button onClick={handleBulkEmailReminder} className="w-full">Send Reminders</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Individual Email Reminder Remark Dialog */}
          <Dialog open={emailRemarkDialogOpen} onOpenChange={setEmailRemarkDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Send Email Reminder</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Remark (optional)</Label><Input value={emailRemark} onChange={e => setEmailRemark(e.target.value)} placeholder="Add a remark to the reminder email" /></div>
                <Button onClick={async () => {
                  await handleEmailReminder(emailRemarkMemberFeeId, 0);
                  setEmailRemarkDialogOpen(false);
                  setEmailRemark("");
                }} className="w-full">Send Reminder</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    );
  };

  return renderStep4MemberList();
}
