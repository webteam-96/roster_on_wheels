"use client";

/**
 * Club Dues v2 — Members listing (Club Admin).
 *
 * Same data semantics as v1: identical API calls, identical fee-type
 * resolution, identical offline-payment dialog, identical reject /
 * approve / receipt / reminder flows, identical bulk-email
 * handlers.
 *
 * Only the presentation differs (ClubAdminShell chrome, KPI tiles, dense
 * slate table). All shadcn/ui dialogs are preserved verbatim from v1
 * because they carry intricate state.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { PageHeader } from "@/components/row/AppKit";
import { Users, CheckCircle2, AlertCircle, Clock } from "@/components/icons";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import Pagination from "@/components/Pagination";
import { useDuesV2Members, deriveDuesV2Members } from "./useDuesV2Members";
import DuesMembersCard from "./DuesMembersCard";
import OfflinePaymentDialog from "./OfflinePaymentDialog";
import { PendingDetailsPanel } from "./duesV2MembersShared";

export default function ClubMembershipDuesV2MembersPage() {
  const h = useDuesV2Members();
  const { isSuperAdmin, isAdmin, canManage, detail, editableYears, returnTo, totalMembers, totalPaid, totalPending, totalUnpaid, loading, totalPages, currentPage, members, pageSize, setCurrentPage, approveDialogOpen, setApproveDialogOpen, pendingDetails, approveRemark, setApproveRemark, handleApproveSubmit, rejectDialogOpen, setRejectDialogOpen, rejectReason, setRejectReason, handleRejectSubmit, bulkEmailConfirmOpen, setBulkEmailConfirmOpen, handleBulkEmailReminder, emailRemarkDialogOpen, setEmailRemarkDialogOpen, emailRemark, setEmailRemark, handleEmailReminder, emailRemarkMemberFeeId, successMessage, setSuccessMessage, errorMessage, setErrorMessage } = h;

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Members – Dues"
          pageSubtitle="View and manage member payments"
          activeNavHref="/club-admin-dashboard/membership-dues"
          hideYearSelector
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="row-h2">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }
  const d = deriveDuesV2Members(h);
  const v = { ...h, ...d };
  const { pageTitle, pageSubtitle } = d;

  return (
    <ProtectedRoute>
      {!canManage && detail && (
        <ViewOnlyBadge yearLabel={detail?.rotaryYear} editableYears={editableYears} className="mb-4" />
      )}

      <ClubAdminShell
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle || "View and manage member payments"}
        activeNavHref="/club-admin-dashboard/membership-dues"
        hideYearSelector   // one dues = one fixed year; its year is in the subtitle (user 2026-11-10)
      >
        <div className="space-y-5">
          {/* Header */}
          <PageHeader title={<>{detail?.purpose || "Club Dues"} – Members</>} description={pageSubtitle || "–"} back={returnTo} />

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Members"   value={fmtInt(totalMembers)}   subtitle="In listing"          icon={Users}         color="blue" />
            <KpiCard title="Paid"            value={fmtInt(totalPaid)}      subtitle="Any fee settled"     icon={CheckCircle2}  color="green" />
            <KpiCard title="Pending Approval" value={fmtInt(totalPending)}  subtitle="Awaiting approval"   icon={Clock}         color="gold" />
            <KpiCard title="Unpaid"          value={fmtInt(totalUnpaid)}    subtitle="No payment yet"      icon={AlertCircle}   color="red" />
          </div>

          {/* Toolbar */}
          <DuesMembersCard v={v} />

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <Pagination page={currentPage} totalPages={totalPages} totalCount={members.length} pageSize={pageSize} onPageChange={setCurrentPage} />
          )}

          {/* Offline Payment Dialog — EXACT logic from v1 */}
          <OfflinePaymentDialog v={v} />

          {/* Approve Dialog — shows submitted details + optional remark */}
          <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Approve Payment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <PendingDetailsPanel details={pendingDetails} currency={detail?.currency} />
                <div>
                  <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Textarea
                    value={approveRemark}
                    onChange={(e) => setApproveRemark(e.target.value)}
                    placeholder="Optional remark: will appear on the receipt email if provided"
                  />
                </div>
                <Button onClick={handleApproveSubmit} className="w-full">
                  Approve Payment
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Reject Dialog — shows submitted details + required reason */}
          <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Reject Payment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <PendingDetailsPanel details={pendingDetails} currency={detail?.currency} />
                <div>
                  <Label>Rejection Reason <span className="text-red-600">*</span></Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason for rejection (required)"
                    required
                  />
                </div>
                <Button variant="destructive" onClick={handleRejectSubmit} disabled={!rejectReason.trim()} className="w-full">
                  Reject Payment
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Bulk Email confirm — simple OK/Cancel (user requested no remark) */}
          <Dialog open={bulkEmailConfirmOpen} onOpenChange={setBulkEmailConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Bulk Email Reminders</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-700">Do you want to send Mail to all unpaid members?</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setBulkEmailConfirmOpen(false)}>Cancel</Button>
                  <Button onClick={handleBulkEmailReminder}>Send</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Individual Email Reminder Remark Dialog — EXACT logic from v1 */}
          <Dialog open={emailRemarkDialogOpen} onOpenChange={setEmailRemarkDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Email Reminder</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Remark (optional)</Label>
                  <Input
                    value={emailRemark}
                    onChange={(e) => setEmailRemark(e.target.value)}
                    placeholder="Add a remark to the reminder email"
                  />
                </div>
                <Button
                  onClick={async () => {
                    await handleEmailReminder(emailRemarkMemberFeeId, 0);
                    setEmailRemarkDialogOpen(false);
                    setEmailRemark("");
                  }}
                  className="w-full"
                >
                  Send Reminder
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <SuccessAlert
            open={!!successMessage}
            title="Success"
            description={successMessage || ""}
            onOk={() => setSuccessMessage(null)}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
