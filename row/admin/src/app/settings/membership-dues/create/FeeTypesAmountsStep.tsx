import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { MembershipDuesFormCtx } from "./useMembershipDuesForm";

export default function FeeTypesAmountsStep({ v }: { v: MembershipDuesFormCtx }) {
  const { isEdit, originalFees, feeType1Enabled, setFeeType1Enabled, feeType1Label, setFeeType1Label, feeType2Enabled, setFeeType2Enabled, feeType2Label, setFeeType2Label, feeType3Enabled, setFeeType3Enabled, feeType3Label, setFeeType3Label, validateFeeTypeCombination, defaultCategoryType, setDefaultCategoryType, modeOfPayment, onlineSurchargePercent, setOnlineSurchargePercent, enabledFeeTypes, feeType1Amount, feeType2Amount, feeType3Amount, setFeeType1Amount, setFeeType2Amount, setFeeType3Amount, isOriginalFeeType, allMembersSameAmount, cur } = v;

  const renderStep2FeeTypesAmounts = () => (
    <Card>
      <CardHeader><CardTitle>Fee Types & Default Amounts</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* Fee Types */}
        <div>
          <h3 className="row-h2 mb-2">Fee Types</h3>
          <p className="text-sm text-muted-foreground mb-3">Select which fee types to enable and customize their labels. Valid combinations: Annual only, Semi1 only, Semi2 only, Semi1+Semi2, or Annual+Semi1+Semi2.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isEdit && originalFees.isFees1 ? "bg-gray-50" : ""}`}>
              <Checkbox checked={feeType1Enabled} onCheckedChange={(c) => setFeeType1Enabled(!!c)} id="feeType1" disabled={isEdit && originalFees.isFees1} />
              <div className="flex-1">
                <Label htmlFor="feeType1" className="text-sm font-medium">Fee Type 1</Label>
                <Input value={feeType1Label} onChange={e => setFeeType1Label(e.target.value)} placeholder="Label" className="mt-1" />
              </div>
            </div>
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isEdit && originalFees.isFees2 ? "bg-gray-50" : ""}`}>
              <Checkbox checked={feeType2Enabled} onCheckedChange={(c) => setFeeType2Enabled(!!c)} id="feeType2" disabled={isEdit && originalFees.isFees2} />
              <div className="flex-1">
                <Label htmlFor="feeType2" className="text-sm font-medium">Fee Type 2</Label>
                <Input value={feeType2Label} onChange={e => setFeeType2Label(e.target.value)} placeholder="Label" className="mt-1" />
              </div>
            </div>
            <div className={`flex items-center gap-3 p-3 border rounded-lg ${isEdit && originalFees.isFees3 ? "bg-gray-50" : ""}`}>
              <Checkbox checked={feeType3Enabled} onCheckedChange={(c) => setFeeType3Enabled(!!c)} id="feeType3" disabled={isEdit && originalFees.isFees3} />
              <div className="flex-1">
                <Label htmlFor="feeType3" className="text-sm font-medium">Fee Type 3</Label>
                <Input value={feeType3Label} onChange={e => setFeeType3Label(e.target.value)} placeholder="Label" className="mt-1" />
              </div>
            </div>
          </div>
          {validateFeeTypeCombination() && (
            <p className="text-sm text-red-600 font-medium mt-2">{validateFeeTypeCombination()}</p>
          )}
        </div>

        {/* Default Amounts */}
        <hr className="my-2" />
        <h3 className="row-h2 mb-2">Default Amounts</h3>
        <div className="w-full md:w-1/2">
          <Label>Default Category Type</Label>
          <Input value={defaultCategoryType} onChange={e => setDefaultCategoryType(e.target.value)} placeholder="e.g. Standard" disabled={isEdit} className={isEdit ? "bg-gray-100 opacity-60" : ""} />
        </div>
        {(modeOfPayment === "1" || modeOfPayment === "3") && (
          <div className="space-y-2 max-w-xs">
            <Label>Online Surcharge (%)</Label>
            <Input type="number" step="0.01" min="0" value={onlineSurchargePercent} onChange={e => setOnlineSurchargePercent(e.target.value)} placeholder="e.g. 2.95" />
            <p className="text-xs text-muted-foreground">Added on top of the amount for <b>online</b> payments only (e.g. to cover the gateway fee). Offline pays the base amount. Editable anytime.</p>
          </div>
        )}
        {enabledFeeTypes.length > 0 && (
          <div className="space-y-3">
            {enabledFeeTypes.map(ft => {
              const amountVal = ft.type === 1 ? feeType1Amount : ft.type === 2 ? feeType2Amount : feeType3Amount;
              const setAmount = ft.type === 1 ? setFeeType1Amount : ft.type === 2 ? setFeeType2Amount : setFeeType3Amount;
              // Default Amount is always editable. When every still-unpaid member
              // currently shares the same amount, editing here cascades the new
              // value to all of them on save (see backend CascadeDefaultIfUniform).
              // When members have diverged, the backend leaves their individual
              // amounts untouched — editing here only updates the default used for
              // members added later; go to Step 4 (Member List) to change existing
              // members individually.
              const diverged = isOriginalFeeType(ft.type) && !allMembersSameAmount(ft.type);
              return (
                <div key={ft.type} className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 border rounded-lg bg-muted/30">
                  <div>
                    <Label>Default {ft.label} Amount ({cur}) *</Label>
                    <Input type="number" step="0.01" value={amountVal} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" />
                  </div>
                  {diverged && (
                    <p className="md:col-span-2 text-xs text-muted-foreground -mt-2">
                      Members currently have different {ft.label} amounts, so changing this won't retroactively update them: edit individual members in Step 4 (Member List) for that. This will only set the default for members added later.
                    </p>
                  )}
                  {isOriginalFeeType(ft.type) && !diverged && (
                    <p className="md:col-span-2 text-xs text-muted-foreground -mt-2">
                      All members currently share this amount: changing it here will update it for everyone who hasn't paid yet.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return renderStep2FeeTypesAmounts();
}
