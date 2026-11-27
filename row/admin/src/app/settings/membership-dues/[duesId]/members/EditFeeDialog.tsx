import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function EditFeeDialog({ v }: { v: DuesMembersCtx }) {
  const { editDialogOpen, setEditDialogOpen, editMember, editCategoryType, setEditCategoryType, duesDetail, fees1Label, editFees1Amount, setEditFees1Amount, editOfflineFees1, setEditOfflineFees1, offlineOnly, editVendorAmounts, setEditVendorAmounts, fees2Label, editFees2Amount, setEditFees2Amount, editOfflineFees2, setEditOfflineFees2, fees3Label, editFees3Amount, setEditFees3Amount, editOfflineFees3, setEditOfflineFees3, editSaving, handleEditSave } = v;
  return (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Member Fee</DialogTitle>
            </DialogHeader>
            {editMember && (
              <div className="text-sm text-muted-foreground mb-2">
                <strong>Member:</strong> {editMember.memberName}
              </div>
            )}
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <Label>Category Type</Label>
                <Input value={editCategoryType} onChange={e => setEditCategoryType(e.target.value)} placeholder="Category type" />
              </div>
              {duesDetail?.isFees1 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{fees1Label} Amount</Label>
                      <Input type="number" value={editFees1Amount} onChange={e => setEditFees1Amount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Offline {fees1Label}</Label>
                      <Input type="number" value={editOfflineFees1} onChange={e => setEditOfflineFees1(e.target.value)} />
                    </div>
                  </div>
                  {!offlineOnly && editMember?.annualVendors && editMember.annualVendors.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">{fees1Label} Vendor Accounts</Label>
                      {editMember.annualVendors.map(v => (
                        <div key={v.vendorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs w-32 truncate" title={v.vendorName || v.vendorId}>
                            {v.vendorName || v.vendorId}
                            {v.isDefault && <Lock className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                          </span>
                          <Input
                            type="number"
                            value={editVendorAmounts["annual"]?.[v.vendorId] ?? String(v.amount)}
                            onChange={e => {
                              if (v.isDefault) return;
                              setEditVendorAmounts(prev => ({
                                ...prev,
                                annual: { ...prev.annual, [v.vendorId]: e.target.value },
                              }));
                            }}
                            disabled={v.isDefault}
                            className={`h-8 text-xs ${v.isDefault ? "bg-gray-100 text-muted-foreground cursor-not-allowed" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {duesDetail?.isFees2 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{fees2Label} Amount</Label>
                      <Input type="number" value={editFees2Amount} onChange={e => setEditFees2Amount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Offline {fees2Label}</Label>
                      <Input type="number" value={editOfflineFees2} onChange={e => setEditOfflineFees2(e.target.value)} />
                    </div>
                  </div>
                  {!offlineOnly && editMember?.semi1Vendors && editMember.semi1Vendors.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">{fees2Label} Vendor Accounts</Label>
                      {editMember.semi1Vendors.map(v => (
                        <div key={v.vendorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs w-32 truncate" title={v.vendorName || v.vendorId}>
                            {v.vendorName || v.vendorId}
                            {v.isDefault && <Lock className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                          </span>
                          <Input
                            type="number"
                            value={editVendorAmounts["semi1"]?.[v.vendorId] ?? String(v.amount)}
                            onChange={e => {
                              if (v.isDefault) return;
                              setEditVendorAmounts(prev => ({
                                ...prev,
                                semi1: { ...prev.semi1, [v.vendorId]: e.target.value },
                              }));
                            }}
                            disabled={v.isDefault}
                            className={`h-8 text-xs ${v.isDefault ? "bg-gray-100 text-muted-foreground cursor-not-allowed" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {duesDetail?.isFees3 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{fees3Label} Amount</Label>
                      <Input type="number" value={editFees3Amount} onChange={e => setEditFees3Amount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Offline {fees3Label}</Label>
                      <Input type="number" value={editOfflineFees3} onChange={e => setEditOfflineFees3(e.target.value)} />
                    </div>
                  </div>
                  {!offlineOnly && editMember?.semi2Vendors && editMember.semi2Vendors.length > 0 && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground">{fees3Label} Vendor Accounts</Label>
                      {editMember.semi2Vendors.map(v => (
                        <div key={v.vendorId} className="flex flex-wrap items-center gap-2">
                          <span className="text-xs w-32 truncate" title={v.vendorName || v.vendorId}>
                            {v.vendorName || v.vendorId}
                            {v.isDefault && <Lock className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                          </span>
                          <Input
                            type="number"
                            value={editVendorAmounts["semi2"]?.[v.vendorId] ?? String(v.amount)}
                            onChange={e => {
                              if (v.isDefault) return;
                              setEditVendorAmounts(prev => ({
                                ...prev,
                                semi2: { ...prev.semi2, [v.vendorId]: e.target.value },
                              }));
                            }}
                            disabled={v.isDefault}
                            className={`h-8 text-xs ${v.isDefault ? "bg-gray-100 text-muted-foreground cursor-not-allowed" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editSaving}>Cancel</Button>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? <RotaryLoader size="sm" className="mr-2" /> : null}
                {editSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );
}
