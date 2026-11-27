import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Undo2, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function RevertDialog({ v }: { v: DuesMembersCtx }) {
  const { revertDialogOpen, setRevertDialogOpen, setRevertTarget, revertTarget, formatCurrency, revertReason, setRevertReason, revertSaving, handleRevertPayment } = v;
  return (
        <Dialog open={revertDialogOpen} onOpenChange={(open) => { setRevertDialogOpen(open); if (!open) setRevertTarget(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Revert Payment to Unpaid</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" />This does NOT refund any money.
                </p>
                <p className="mt-1">
                  No bank or payment-gateway transaction is reversed. It only corrects the
                  recorded status, so this member is shown as <strong>Unpaid</strong> again and
                  can be billed/paid afresh. The original payment entry is kept for audit.
                </p>
              </div>
              {revertTarget && (
                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <div className="text-muted-foreground">Member</div>
                    <div className="font-medium break-words">{revertTarget.memberName}</div>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <div className="text-muted-foreground">Fee Type</div>
                    <div className="font-medium">{revertTarget.feeLabel}</div>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <div className="text-muted-foreground">Amount Recorded</div>
                    <div className="font-medium">{formatCurrency(revertTarget.amount)}</div>
                  </div>
                </div>
              )}
              <div>
                <Label>Reason <span className="text-red-600">*</span></Label>
                <Textarea
                  value={revertReason}
                  onChange={e => setRevertReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Why is this payment being reverted? e.g. approved against the wrong member (required)"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Recorded against the payment entry and in the audit log. Max 500 characters.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevertDialogOpen(false)} disabled={revertSaving}>Cancel</Button>
              <Button
                onClick={handleRevertPayment}
                disabled={revertSaving || !revertReason.trim()}
                variant="destructive"
              >
                {revertSaving ? <RotaryLoader size="sm" className="mr-2" /> : <Undo2 className="h-4 w-4 mr-2" />}
                {revertSaving ? "Reverting..." : "Mark as Unpaid"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );
}
