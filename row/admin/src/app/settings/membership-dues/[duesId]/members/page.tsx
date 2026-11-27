"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Send, UserPlus } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { PageHeader } from "@/components/row/AppKit";
import { useDuesMembers, deriveDuesMembers } from "./useDuesMembers";
import MembersTabs from "./MembersTabs";
import OfflinePaymentDialog from "./OfflinePaymentDialog";
import EditFeeDialog from "./EditFeeDialog";
import ApproveDialog from "./ApproveDialog";
import RevertDialog from "./RevertDialog";

export default function MembershipDuesMembersPage() {
  const h = useDuesMembers();
  const { isSuperAdmin, isAdmin, successMessage, setSuccessMessage, errorMessage, setErrorMessage, detailLoading, duesDetail, handleAllocate, allocating, emailOn, openBulkEmailDialog, search, setSearch, remarkDialogOpen, setRemarkDialogOpen, remarkTarget, remarkText, setRemarkText, remarkSending, handleSendWithRemark } = h;

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="row-h2">Access Denied</h3>
        </div>
      </ProtectedRoute>
    );
  }
  const d = deriveDuesMembers(h);
  const v = { ...h, ...d };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <PageHeader
          title="Club Dues - Members"
          back="/settings/membership-dues"
          actions={detailLoading ? (
              <div className="flex items-center gap-2 mt-1"><RotaryLoader size="sm" /><span className="text-sm text-muted-foreground">Loading details...</span></div>
            ) : duesDetail ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                <span><strong>Purpose:</strong> {duesDetail.purpose || "-"}</span>
                <span><strong>District:</strong> {duesDetail.districtNumber || "-"}</span>
                <span><strong>Club:</strong> {duesDetail.clubName || "-"}</span>
                <span><strong>Rotary Year:</strong> {duesDetail.rotaryYear || "-"}</span>
              </div>
            ) : null}
        />

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleAllocate} disabled={allocating} size="sm">
            <UserPlus className="h-4 w-4 mr-1" />
            {allocating ? "Allocating..." : "Allocate to New Members"}
          </Button>
          {emailOn && (
          <Button variant="outline" size="sm" onClick={openBulkEmailDialog}>
            <Mail className="h-4 w-4 mr-1" />Bulk Email Reminder
          </Button>
          )}
        </div>

        {/* Search */}
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name..." />

        {/* Tabs */}
        <MembersTabs v={v} />

        {/* Remark Dialog (for bulk email / individual reminder) */}
        <Dialog open={remarkDialogOpen} onOpenChange={setRemarkDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {remarkTarget?.type === "bulk-email" ? "Bulk Email Reminder" : "Send Reminder Email"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Add Remark (optional)</Label>
                <Textarea
                  value={remarkText}
                  onChange={e => setRemarkText(e.target.value)}
                  rows={3}
                  placeholder="Add any additional remark to include in the email..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemarkDialogOpen(false)} disabled={remarkSending}>Cancel</Button>
              <Button onClick={handleSendWithRemark} disabled={remarkSending}>
                {remarkSending ? <RotaryLoader size="sm" className="mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                {remarkSending ? "Sending..." : "Send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Offline Payment Dialog */}
        <OfflinePaymentDialog v={v} />

        {/* Edit Member Fee Dialog */}
        <EditFeeDialog v={v} />

        {/* Approve/Reject Dialog */}
        <ApproveDialog v={v} />

        {/* Revert to Unpaid Dialog (SuperAdmin) — status correction, NOT a refund */}
        <RevertDialog v={v} />
      </div>
    </ProtectedRoute>
  );
}
