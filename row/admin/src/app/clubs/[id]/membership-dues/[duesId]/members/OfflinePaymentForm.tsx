import DateField from "@/components/DateField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RotaryLoader from "@/components/RotaryLoader";
import { appLocale } from "@/lib/appFormat";
import { API_BASE_URL } from "./duesMembersShared";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function OfflinePaymentForm({ v }: { v: DuesMembersCtx }) {
  const { offlineMember, offlineFeeType, handleOfflineFeeTypeChange, getAvailableFeeTypes, offlineUpdatePaymentId, offlineUpdateIsApproved, offlineOnlineView, cur, offlinePaymentMode, setOfflinePaymentMode, offlineTxnId, setOfflineTxnId, offlineGivenTo, setOfflineGivenTo, offlineDate, setOfflineDate, offlineRemark, setOfflineRemark, setOfflineAttachment, offlineExistingAttachment, offlineApprovalRemark, setOfflineApprovalRemark, emailOn, offlineSendEmail, setOfflineSendEmail, offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate, handleOfflineSave, offlineSaving, isSuperAdmin, handleRemovePayment, removingPayment } = v;
  return (
            <div className="space-y-3">
              {offlineMember && (
                <div className="text-sm text-muted-foreground">
                  <strong>Member:</strong> {offlineMember.memberName}
                </div>
              )}
              <div>
                <Label>Fee Type <span className="text-destructive">*</span></Label>
                <Select value={offlineFeeType} onValueChange={handleOfflineFeeTypeChange}>
                  <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                  <SelectContent>
                    {getAvailableFeeTypes(offlineMember).map(ft => (
                      <SelectItem key={ft.type} value={String(ft.type)}>{ft.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {offlineUpdatePaymentId > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    {offlineUpdateIsApproved
                      ? "Editing a paid offline payment: status stays Approved."
                      : "Saving will approve this payment and email the receipt to the member. If CP/Secretary later clicks Approve/Reject from their email, they'll see “already approved”."}
                  </p>
                )}
              </div>
              {offlineOnlineView ? (
                // Gateway-paid fee type → read-only summary. No editable fields,
                // no Save button. Admin can still pick a different fee type from
                // the dropdown above to switch back to editing.
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-1.5">
                  <p className="text-sm font-medium text-emerald-800">Paid via Payment Gateway (online)</p>
                  <p className="text-sm"><strong>Mode:</strong> {offlineOnlineView.mode}</p>
                  {offlineOnlineView.txnId && (
                    <p className="text-sm"><strong>Transaction ID:</strong> {offlineOnlineView.txnId}</p>
                  )}
                  {offlineOnlineView.amount > 0 && (
                    <p className="text-sm"><strong>Amount:</strong> {cur}{offlineOnlineView.amount.toLocaleString(appLocale())}</p>
                  )}
                  {offlineOnlineView.date && (
                    <p className="text-sm"><strong>Date:</strong> {new Date(offlineOnlineView.date).toLocaleDateString(appLocale())}</p>
                  )}
                  <p className="text-sm"><strong>Status:</strong> Paid (Online)</p>
                  <p className="text-xs text-emerald-700 mt-1">Gateway payments can't be edited offline: viewing only.</p>
                </div>
              ) : (
                <>
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
                    <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={e => setOfflineAttachment(e.target.files?.[0] || null)} />
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX</p>
                    {offlineMember && (offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                      <a href={`${API_BASE_URL}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                        target="_blank" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View existing attachment</a>
                    )}
                  </div>
                  {offlineUpdatePaymentId > 0 && offlineExistingAttachment && (
                    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs">
                      Existing attachment: <a href={`${API_BASE_URL}${offlineExistingAttachment}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">view</a> (uploading a new one replaces it)
                    </div>
                  )}
                  {/* Approval remark — only when updating a Pending row (auto-approve on save) */}
                  {offlineUpdatePaymentId > 0 && !offlineUpdateIsApproved && (
                    <div>
                      <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input value={offlineApprovalRemark} onChange={e => setOfflineApprovalRemark(e.target.value)} placeholder="Optional: appears on receipt email" />
                    </div>
                  )}
                  {/* Send Email Receipt — only for new entries (not for updates) */}
                  {offlineUpdatePaymentId === 0 && emailOn && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox checked={offlineSendEmail} onCheckedChange={c => setOfflineSendEmail(!!c)} id="offlineSendEmail" />
                      <Label htmlFor="offlineSendEmail">Send Email Receipt</Label>
                    </div>
                  )}
                  {/* Send updated receipt — only when updating an already-Approved row */}
                  {offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && emailOn && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox checked={offlineSendReceiptOnUpdate} onCheckedChange={c => setOfflineSendReceiptOnUpdate(!!c)} id="offlineSendReceiptOnUpdate" />
                      <Label htmlFor="offlineSendReceiptOnUpdate">Send updated receipt to member</Label>
                    </div>
                  )}
                  <Button onClick={handleOfflineSave} disabled={offlineSaving} className="w-full">
                    {offlineSaving ? <span className="mr-1"><RotaryLoader size="sm" /></span> : null}
                    {offlineUpdatePaymentId > 0
                      ? (offlineUpdateIsApproved ? "Save Changes" : "Save & Approve")
                      : "Save"}
                  </Button>
                  {isSuperAdmin && offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && (
                    <Button
                      variant="outline"
                      onClick={handleRemovePayment}
                      disabled={removingPayment}
                      className="w-full text-rose-600"
                    >
                      {removingPayment ? <span className="mr-1"><RotaryLoader size="sm" /></span> : null}
                      Remove Payment (SuperAdmin)
                    </Button>
                  )}
                </>
              )}
            </div>
  );
}
