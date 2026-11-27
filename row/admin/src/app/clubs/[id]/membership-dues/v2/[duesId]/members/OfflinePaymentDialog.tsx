import DateField from "@/components/DateField";
import { FileText } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { appLocale } from "@/lib/appFormat";
import { API_BASE_URL, isPendingMember } from "./duesV2MembersShared";
import type { DuesV2MembersCtx } from "./useDuesV2Members";

export default function OfflinePaymentDialog({ v }: { v: DuesV2MembersCtx }) {
  const { offlineDialogOpen, setOfflineDialogOpen, offlineUpdatePaymentId, offlineUpdateIsApproved, offlineMember, cur, offlineFeeType, handleOfflineFeeTypeChange, getAvailableFeeTypes, offlineOnlineView, offlinePaymentMode, setOfflinePaymentMode, offlineTxnId, setOfflineTxnId, offlineGivenTo, setOfflineGivenTo, offlineDate, setOfflineDate, offlineRemark, setOfflineRemark, setOfflineAttachment, offlineExistingAttachment, offlineApprovalRemark, setOfflineApprovalRemark, emailOn, offlineSendEmail, setOfflineSendEmail, offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate, handleOfflineSave, offlineSaving, isSuperAdmin, handleRemovePayment, removingPayment } = v;
  return (
          <Dialog open={offlineDialogOpen} onOpenChange={setOfflineDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {offlineUpdatePaymentId > 0
                    ? (offlineUpdateIsApproved ? "Update Paid Offline Payment" : "Review & Approve Offline Payment")
                    : "Record Offline Payment"}
                </DialogTitle>
              </DialogHeader>
              {offlineMember && isPendingMember(offlineMember) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium text-amber-800">Pending Payment Details:</p>
                  {(offlineMember.pendingTransactionType || offlineMember.PendingTransactionType) && (
                    <p className="text-sm">
                      <strong>Mode:</strong>{" "}
                      {offlineMember.pendingTransactionType || offlineMember.PendingTransactionType}
                    </p>
                  )}
                  {(offlineMember.pendingAmount || offlineMember.PendingAmount) && (
                    <p className="text-sm">
                      <strong>Amount:</strong> {cur}
                      {offlineMember.pendingAmount || offlineMember.PendingAmount}
                    </p>
                  )}
                  {(offlineMember.pendingTransactionId || offlineMember.PendingTransactionId) && (
                    <p className="text-sm">
                      <strong>Transaction ID:</strong>{" "}
                      {offlineMember.pendingTransactionId || offlineMember.PendingTransactionId}
                    </p>
                  )}
                  {(offlineMember.pendingGivenTo || offlineMember.PendingGivenTo) && (
                    <p className="text-sm">
                      <strong>Given To:</strong>{" "}
                      {offlineMember.pendingGivenTo || offlineMember.PendingGivenTo}
                    </p>
                  )}
                  {(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate) && (
                    <p className="text-sm">
                      <strong>Date:</strong>{" "}
                      {new Date(
                        offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate
                      ).toLocaleDateString(appLocale())}
                    </p>
                  )}
                  {(offlineMember.pendingRemark || offlineMember.PendingRemark) && (
                    <p className="text-sm">
                      <strong>Remark:</strong>{" "}
                      {offlineMember.pendingRemark || offlineMember.PendingRemark}
                    </p>
                  )}
                  {(offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                    <a
                      href={`${API_BASE_URL}${
                        offlineMember.pendingAttachment || offlineMember.PendingAttachment
                      }`}
                      target="_blank"
                      className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      <FileText className="h-3 w-3" /> View Attachment
                    </a>
                  )}
                </div>
              )}
              <div className="space-y-3">
                {offlineMember && (
                  <div className="text-sm text-slate-600">
                    <strong>Member:</strong> {offlineMember.memberName}
                  </div>
                )}
                <div>
                  <Label>
                    Fee Type <span className="text-destructive">*</span>
                  </Label>
                  <Select value={offlineFeeType} onValueChange={handleOfflineFeeTypeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select fee type" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableFeeTypes(offlineMember).map((ft) => (
                        <SelectItem key={ft.type} value={String(ft.type)}>
                          {ft.label}
                        </SelectItem>
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
                        {["NEFT/IMPS/RTGS", "Cash", "Cheque"].map((mode) => (
                          <label key={mode} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="radio"
                              name="offlineMode"
                              value={mode}
                              checked={offlinePaymentMode === mode}
                              onChange={(e) => setOfflinePaymentMode(e.target.value)}
                              className="accent-primary"
                            />
                            {mode}
                          </label>
                        ))}
                      </div>
                    </div>
                    {offlinePaymentMode === "NEFT/IMPS/RTGS" && (
                      <div>
                        <Label>Transaction ID</Label>
                        <Input
                          value={offlineTxnId}
                          onChange={(e) => setOfflineTxnId(e.target.value)}
                          placeholder="Enter transaction ID"
                        />
                      </div>
                    )}
                    {(offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") && (
                      <div>
                        <Label>
                          Given To <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          value={offlineGivenTo}
                          onChange={(e) => setOfflineGivenTo(e.target.value)}
                          placeholder="Enter name"
                        />
                      </div>
                    )}
                    <div>
                      <Label>
                        Date <span className="text-destructive">*</span>
                      </Label>
                      <DateField value={offlineDate} onChange={setOfflineDate} />
                    </div>
                    <div>
                      <Label>Remark</Label>
                      <Input
                        value={offlineRemark}
                        onChange={(e) => setOfflineRemark(e.target.value)}
                        placeholder="Optional remark"
                      />
                    </div>
                    <div>
                      <Label>Attachment</Label>
                      <Input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                        onChange={(e) => setOfflineAttachment(e.target.files?.[0] || null)}
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
                      </p>
                      {offlineMember &&
                        (offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                          <a
                            href={`${API_BASE_URL}${
                              offlineMember.pendingAttachment || offlineMember.PendingAttachment
                            }`}
                            target="_blank"
                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                          >
                            View existing attachment
                          </a>
                        )}
                    </div>
                    {offlineUpdatePaymentId > 0 && offlineExistingAttachment && (
                      <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs">
                        Existing attachment:{" "}
                        <a href={`${API_BASE_URL}${offlineExistingAttachment}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">view</a>{" "}
                        (uploading a new one replaces it)
                      </div>
                    )}
                    {offlineUpdatePaymentId > 0 && !offlineUpdateIsApproved && (
                      <div>
                        <Label>
                          Approval Remark <span className="text-muted-foreground text-xs">(optional)</span>
                        </Label>
                        <Input
                          value={offlineApprovalRemark}
                          onChange={(e) => setOfflineApprovalRemark(e.target.value)}
                          placeholder="Optional: appears on receipt email"
                        />
                      </div>
                    )}
                    {offlineUpdatePaymentId === 0 && emailOn && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={offlineSendEmail}
                          onCheckedChange={(c) => setOfflineSendEmail(!!c)}
                          id="offlineSendEmail"
                        />
                        <Label htmlFor="offlineSendEmail">Send Email Receipt</Label>
                      </div>
                    )}
                    {offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && emailOn && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={offlineSendReceiptOnUpdate}
                          onCheckedChange={(c) => setOfflineSendReceiptOnUpdate(!!c)}
                          id="offlineSendReceiptOnUpdate"
                        />
                        <Label htmlFor="offlineSendReceiptOnUpdate">Send updated receipt to member</Label>
                      </div>
                    )}
                    <Button
                      onClick={handleOfflineSave}
                      disabled={offlineSaving}
                      className="w-full"
                    >
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
            </DialogContent>
          </Dialog>
  );
}
