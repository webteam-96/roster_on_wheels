import DateField from "@/components/DateField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { appLocale } from "@/lib/appFormat";
import { API_BASE_URL } from "./duesMembersShared";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function OfflinePaymentDialog({ v }: { v: DuesMembersCtx }) {
  const { offlineDialogOpen, setOfflineDialogOpen, offlineUpdatePaymentId, offlineUpdateIsApproved, offlineMember, offlineFeeType, handleOfflineFeeTypeChange, getAvailableFeeTypes, offlineOnlineView, cur, offlineTransactionType, setOfflineTransactionType, offlineTransactionId, setOfflineTransactionId, offlineGivenTo, setOfflineGivenTo, offlineBankName, setOfflineBankName, offlineChequeNo, setOfflineChequeNo, offlineDate, setOfflineDate, offlineRemark, setOfflineRemark, fileInputRef, setOfflineAttachment, offlineAttachment, offlineExistingAttachment, offlineApprovalRemark, setOfflineApprovalRemark, emailOn, offlineSendReceipt, setOfflineSendReceipt, offlineSendReceiptOnUpdate, setOfflineSendReceiptOnUpdate, offlineSaving, handleOfflineSave } = v;
  return (
        <Dialog open={offlineDialogOpen} onOpenChange={setOfflineDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {offlineUpdatePaymentId > 0
                  ? (offlineUpdateIsApproved ? "Update Paid Offline Payment" : "Review & Approve Offline Payment")
                  : "Record Offline Payment"}
              </DialogTitle>
            </DialogHeader>
            {offlineMember && (
              <div className="text-sm text-muted-foreground mb-2">
                <strong>Member:</strong> {offlineMember.memberName}
              </div>
            )}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <Label>Fee Type *</Label>
                <Select value={offlineFeeType} onValueChange={handleOfflineFeeTypeChange}>
                  <SelectTrigger><SelectValue placeholder="Select fee type" /></SelectTrigger>
                  <SelectContent>
                    {getAvailableFeeTypes(offlineMember).map(ft => (
                      <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
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
                    <Label>Transaction Type</Label>
                    <Select value={offlineTransactionType} onValueChange={setOfflineTransactionType}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Cheque">Cheque</SelectItem>
                        <SelectItem value="NEFT">NEFT</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Transaction ID</Label>
                    <Input value={offlineTransactionId} onChange={e => setOfflineTransactionId(e.target.value)} placeholder="Transaction ID" />
                  </div>
                  <div>
                    <Label>Given To</Label>
                    <Input value={offlineGivenTo} onChange={e => setOfflineGivenTo(e.target.value)} placeholder="Given to" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Bank Name</Label>
                      <Input value={offlineBankName} onChange={e => setOfflineBankName(e.target.value)} placeholder="Bank name" />
                    </div>
                    <div>
                      <Label>Cheque No</Label>
                      <Input value={offlineChequeNo} onChange={e => setOfflineChequeNo(e.target.value)} placeholder="Cheque number" />
                    </div>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <DateField value={offlineDate} onChange={setOfflineDate} />
                  </div>
                  <div>
                    <Label>Remark</Label>
                    <Textarea value={offlineRemark} onChange={e => setOfflineRemark(e.target.value)} rows={2} placeholder="Remark" />
                  </div>
                  <div>
                    <Label>Attachment</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                        className="hidden"
                        onChange={e => setOfflineAttachment(e.target.files?.[0] || null)}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-1" />Choose File
                      </Button>
                      <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {offlineAttachment ? offlineAttachment.name : "No file selected"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX</p>
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
                      <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input
                        value={offlineApprovalRemark}
                        onChange={e => setOfflineApprovalRemark(e.target.value)}
                        placeholder="Optional: appears on receipt email"
                      />
                    </div>
                  )}
                  {offlineUpdatePaymentId === 0 && emailOn && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id="sendReceiptCheckbox"
                        checked={offlineSendReceipt}
                        onCheckedChange={(c) => setOfflineSendReceipt(!!c)}
                      />
                      <Label htmlFor="sendReceiptCheckbox" className="cursor-pointer">Send receipt email</Label>
                    </div>
                  )}
                  {offlineUpdatePaymentId > 0 && offlineUpdateIsApproved && emailOn && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        id="sendReceiptOnUpdateCheckbox"
                        checked={offlineSendReceiptOnUpdate}
                        onCheckedChange={(c) => setOfflineSendReceiptOnUpdate(!!c)}
                      />
                      <Label htmlFor="sendReceiptOnUpdateCheckbox" className="cursor-pointer">Send updated receipt to member</Label>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOfflineDialogOpen(false)} disabled={offlineSaving}>
                {offlineOnlineView ? "Close" : "Cancel"}
              </Button>
              {!offlineOnlineView && (
                <Button onClick={handleOfflineSave} disabled={offlineSaving}>
                  {offlineSaving ? <RotaryLoader size="sm" className="mr-2" /> : null}
                  {offlineSaving
                    ? "Saving..."
                    : (offlineUpdatePaymentId > 0
                        ? (offlineUpdateIsApproved ? "Save Changes" : "Save & Approve")
                        : "Save Payment")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );
}
