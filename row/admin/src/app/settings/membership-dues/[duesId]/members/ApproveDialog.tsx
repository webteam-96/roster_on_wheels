import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { PendingDetailsPanel } from "./duesMembersShared";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function ApproveDialog({ v }: { v: DuesMembersCtx }) {
  const { approveDialogOpen, setApproveDialogOpen, approveAction, pendingDetails, duesDetail, approveRemark, setApproveRemark, rejectReason, setRejectReason, approveSaving, handleApproveReject } = v;
  return (
        <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{approveAction === "approve" ? "Approve Payment" : "Reject Payment"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <PendingDetailsPanel details={pendingDetails} currency={duesDetail?.currency} />
              {approveAction === "approve" ? (
                <>
                  <p className="text-sm text-muted-foreground">Are you sure you want to approve this payment?</p>
                  <div>
                    <Label>Approval Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Textarea
                      value={approveRemark}
                      onChange={e => setApproveRemark(e.target.value)}
                      rows={3}
                      placeholder="Optional remark: will appear on the receipt email if provided"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <Label>Rejection Reason <span className="text-red-600">*</span></Label>
                  <Textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="Enter reason for rejection (required)"
                    required
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveDialogOpen(false)} disabled={approveSaving}>Cancel</Button>
              {approveAction === "approve" ? (
                <Button onClick={handleApproveReject} disabled={approveSaving}>
                  {approveSaving ? <RotaryLoader size="sm" className="mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  {approveSaving ? "Approving..." : "Approve"}
                </Button>
              ) : (
                <Button onClick={handleApproveReject} disabled={approveSaving || !rejectReason.trim()} variant="destructive">
                  {approveSaving ? <RotaryLoader size="sm" className="mr-2" /> : <X className="h-4 w-4 mr-2" />}
                  {approveSaving ? "Rejecting..." : "Reject"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );
}
