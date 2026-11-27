"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, FileText } from "@/components/icons";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { appLocale } from "@/lib/appFormat";
import { PageHeader } from "@/components/row/AppKit";
import { useDuesMembers } from "./useDuesMembers";
import DuesMembersTable from "./DuesMembersTable";
import OfflinePaymentForm from "./OfflinePaymentForm";
import { API_BASE_URL, PendingDetailsPanel, isPendingMember } from "./duesMembersShared";

export default function ClubMembershipDuesMembersPage() {
  const h = useDuesMembers();
  const { isSuperAdmin, isAdmin, successMessage, setSuccessMessage, errorMessage, setErrorMessage, detail, clubId, emailOn, setBulkRemark, setBulkRemarkDialogOpen, search, setSearch, filter, setFilter, members, offlineDialogOpen, setOfflineDialogOpen, offlineUpdatePaymentId, offlineUpdateIsApproved, offlineMember, cur, approveDialogOpen, setApproveDialogOpen, pendingDetails, approveRemark, setApproveRemark, handleApproveSubmit, rejectDialogOpen, setRejectDialogOpen, rejectReason, setRejectReason, handleRejectSubmit, bulkRemarkDialogOpen, bulkRemark, handleBulkEmailReminder, emailRemarkDialogOpen, setEmailRemarkDialogOpen, emailRemark, setEmailRemark, handleEmailReminder, emailRemarkMemberFeeId } = h;

  if (!isSuperAdmin && !isAdmin) {
    return <ProtectedRoute><div className="flex justify-center py-20"><h3>Access Denied</h3></div></ProtectedRoute>;
  }
  const v = h;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <PageHeader
          title={<>{detail?.purpose || "Club Dues"} - Members</>}
          back={`/clubs/${clubId}/membership-dues`}
          actions={
            <>
<p className="text-muted-foreground text-base">
              {detail?.rotaryYear || ""} {detail?.clubName ? `| ${detail.clubName}` : ""}
            </p>
            </>
          }
        />

        {/* Bulk Actions — same as SuperAdmin */}
        <div className="flex flex-wrap items-center gap-2">
          {emailOn && (
          <Button size="sm" variant="outline" onClick={() => { setBulkRemark(""); setBulkRemarkDialogOpen(true); }}>
            <Mail className="h-4 w-4 mr-1" />Bulk Email
          </Button>
          )}
        </div>

        {/* Search + Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name..." className="w-64" />
          <NativeSelect value={filter} onChange={e => setFilter(e.target.value)}
            className="w-auto">
            <option value="">All Members</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="pending">Pending Approval</option>
          </NativeSelect>
          <span className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 inline-block" /> Pending Approval</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> New Member</span>
        </div>

        <DuesMembersTable v={v} />

        {/* Offline Payment Dialog — record / update */}
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
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium text-yellow-800">Pending Payment Details:</p>
                {(offlineMember.pendingTransactionType || offlineMember.PendingTransactionType) && (
                  <p className="text-sm"><strong>Mode:</strong> {offlineMember.pendingTransactionType || offlineMember.PendingTransactionType}</p>
                )}
                {(offlineMember.pendingAmount || offlineMember.PendingAmount) && (
                  <p className="text-sm"><strong>Amount:</strong> {cur}{offlineMember.pendingAmount || offlineMember.PendingAmount}</p>
                )}
                {(offlineMember.pendingTransactionId || offlineMember.PendingTransactionId) && (
                  <p className="text-sm"><strong>Transaction ID:</strong> {offlineMember.pendingTransactionId || offlineMember.PendingTransactionId}</p>
                )}
                {(offlineMember.pendingGivenTo || offlineMember.PendingGivenTo) && (
                  <p className="text-sm"><strong>Given To:</strong> {offlineMember.pendingGivenTo || offlineMember.PendingGivenTo}</p>
                )}
                {(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate) && (
                  <p className="text-sm"><strong>Date:</strong> {new Date(offlineMember.pendingPaymentDate || offlineMember.PendingPaymentDate).toLocaleDateString(appLocale())}</p>
                )}
                {(offlineMember.pendingRemark || offlineMember.PendingRemark) && (
                  <p className="text-sm"><strong>Remark:</strong> {offlineMember.pendingRemark || offlineMember.PendingRemark}</p>
                )}
                {(offlineMember.pendingAttachment || offlineMember.PendingAttachment) && (
                  <a href={`${API_BASE_URL}${offlineMember.pendingAttachment || offlineMember.PendingAttachment}`}
                    target="_blank" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" /> View Attachment
                  </a>
                )}
              </div>
            )}
            <OfflinePaymentForm v={v} />
          </DialogContent>
        </Dialog>

        {/* Approve Dialog — shows what the member submitted + optional remark */}
        <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Approve Payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <PendingDetailsPanel details={pendingDetails} currency={detail?.currency} />
              <div>
                <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Textarea
                  value={approveRemark}
                  onChange={e => setApproveRemark(e.target.value)}
                  placeholder="Optional remark: will appear on the receipt email if provided"
                />
              </div>
              <Button onClick={handleApproveSubmit} className="w-full">Approve Payment</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reject Dialog — shows what the member submitted + required reason */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Reject Payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <PendingDetailsPanel details={pendingDetails} currency={detail?.currency} />
              <div>
                <Label>Rejection Reason <span className="text-red-600">*</span></Label>
                <Textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Enter reason for rejection (required)"
                  required
                />
              </div>
              <Button variant="destructive" onClick={handleRejectSubmit} disabled={!rejectReason.trim()} className="w-full">Reject Payment</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Email Remark Dialog — EXACT COPY from SuperAdmin */}
        <Dialog open={bulkRemarkDialogOpen} onOpenChange={setBulkRemarkDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send Bulk Email Reminders</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Remark (optional)</Label><Input value={bulkRemark} onChange={e => setBulkRemark(e.target.value)} placeholder="Optional remark" /></div>
              <Button onClick={handleBulkEmailReminder} className="w-full">Send Reminders</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Individual Email Reminder Remark Dialog — EXACT COPY from SuperAdmin */}
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
      </div>
    </ProtectedRoute>
  );
}
