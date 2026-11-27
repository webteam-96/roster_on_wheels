import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Check, ChevronsUpDown, Lock, RefreshCw } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { isDefaultSettlementVendorId } from "./membershipDuesShared";
import type { MembershipDuesFormCtx } from "./useMembershipDuesForm";

export default function VendorSplitsStep({ v }: { v: MembershipDuesFormCtx }) {
  const { amountType, setAmountType, handleAutoAddDefaultVendor, isEdit, enabledFeeTypes, addedVendorIds, cur, kycVendors, vendorSplits, getAccountLabel, feeType1Amount, feeType2Amount, feeType3Amount, splitSurchargePercent, splitVendorOpen, setSplitVendorOpen, splitVendorId, setSplitVendorId, splitAmounts, setSplitAmounts, splitIsSelf, setSplitIsSelf, handleAddVendorSplit, handleRefreshDefaultVendor, handleDeleteVendorGroup, setVendorSplits } = v;

  const renderStep3VendorSplits = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle>Vendor Splits{amountType ? ` (${amountType === "1" ? "Amount" : "Percentage %"})` : ""}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm">Amount Type:</Label>
            <Select value={amountType} onValueChange={(val) => {
              setAmountType(val);
              handleAutoAddDefaultVendor(val);
            }} disabled={isEdit}>
              <SelectTrigger className={`w-44 ${isEdit ? "opacity-60" : ""}`}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Amount (Fixed)</SelectItem>
                <SelectItem value="2">Percentage (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {amountType && (<>
        {/* Summary table with A/C columns */}
        {enabledFeeTypes.length > 0 && addedVendorIds.length > 0 && (
          <div className="border rounded-lg p-3 bg-muted/30">
            <h4 className="row-h3 mb-2">Split Summary</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee Type</TableHead>
                    <TableHead>Total ({cur})</TableHead>
                    {addedVendorIds.map(kycId => {
                      const vendor = kycVendors.find(k => k.id === kycId);
                      const vendorName = vendor?.name || vendorSplits.find(s => s.fkKycId === kycId)?.vendorName || "";
                      const vendorIdStr = vendor?.vendorId || vendorSplits.find(s => s.fkKycId === kycId)?.vendorId || "";
                      return (
                        <TooltipProvider key={kycId}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <TableHead className="cursor-help">{getAccountLabel(kycId)}</TableHead>
                            </TooltipTrigger>
                            <TooltipContent><p>{vendorName} ({vendorIdStr})</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    <TableHead>Assigned</TableHead>
                    <TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enabledFeeTypes.map(ft => {
                    const feeAmount = ft.type === 1 ? Number(feeType1Amount || 0) : ft.type === 2 ? Number(feeType2Amount || 0) : Number(feeType3Amount || 0);
                    // Vendor splits sum to the ONLINE (surcharge-inflated) total \u2014 the
                    // default vendor's own auto-added split already carries the surcharge
                    // share, so it's fully visible/adjustable here, not a hidden add-on
                    // at payment time.
                    const onlineTotal = feeAmount * (1 + splitSurchargePercent / 100);
                    const assigned = vendorSplits.filter(s => s.fkFeeType === ft.type).reduce((sum, s) => sum + s.splitAmount, 0);
                    const matchTotal = amountType === "1" ? onlineTotal : 100;
                    const balance = Number((matchTotal - assigned).toFixed(2));
                    return (
                      <TableRow key={ft.type}>
                        <TableCell className="font-medium">{ft.label}</TableCell>
                        <TableCell>
                          {cur}{onlineTotal.toFixed(2)}
                          <span className="block text-[10px] text-muted-foreground">Base: {cur}{feeAmount.toFixed(2)}</span>
                        </TableCell>
                        {addedVendorIds.map(kycId => {
                          const split = vendorSplits.find(s => s.fkFeeType === ft.type && s.fkKycId === kycId);
                          return (
                            <TableCell key={kycId}>
                              {split ? (amountType === "1" ? `${cur}${split.splitAmount.toFixed(2)}` : `${split.splitAmount.toFixed(2)}%`) : "-"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-green-600 font-medium">
                          {amountType === "1" ? `${cur}${assigned.toFixed(2)}` : `${assigned.toFixed(2)}%`}
                        </TableCell>
                        <TableCell className={`font-medium ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                          {amountType === "1" ? `${cur}${balance.toFixed(2)}` : `${balance.toFixed(2)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Add new vendor split */}
        <div className="border rounded-lg p-4 space-y-4">
          <h4 className="row-h3">Add Vendor</h4>
          <div>
            <Label>Select KYC Vendor</Label>
            <Popover open={splitVendorOpen} onOpenChange={setSplitVendorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between">
                  {splitVendorId ? (kycVendors.find(k => k.id === splitVendorId)?.name || "") + " (" + (kycVendors.find(k => k.id === splitVendorId)?.vendorId || "") + ")" : "Search vendor..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name or vendor ID..." />
                  <CommandList>
                    <CommandEmpty>No vendor found.</CommandEmpty>
                    <CommandGroup>
                      {kycVendors.filter(k => !addedVendorIds.includes(k.id)).map(k => (
                        <CommandItem key={k.id} value={`${k.name} ${k.vendorId} ${k.accountHolder ?? ""} ${k.accountNumber ?? ""} ${k.ifsc ?? ""}`} onSelect={() => { setSplitVendorId(k.id); setSplitVendorOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${splitVendorId === k.id ? "opacity-100" : "opacity-0"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{k.name}</div>
                            <div className="text-xs text-muted-foreground">{k.vendorId}</div>
                            {/* Bank account info — helps admin pick the right account when one
                                vendor name has multiple KYC entries. */}
                            {(k.accountHolder || k.accountNumber || k.ifsc) && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                                {k.accountHolder && <span>{k.accountHolder}</span>}
                                {k.accountHolder && (k.accountNumber || k.ifsc) && <span> · </span>}
                                {k.accountNumber && <span>A/C {k.accountNumber}</span>}
                                {k.accountNumber && k.ifsc && <span> · </span>}
                                {k.ifsc && <span>Bank code {k.ifsc}</span>}
                              </div>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {splitVendorId > 0 && enabledFeeTypes.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Enter 0 for a fee type to exclude this vendor from that fee type&apos;s order. It will still be included for any fee type where the amount is above 0.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee Type</TableHead>
                    <TableHead>{amountType === "1" ? "Split Amount" : "Split Percentage (%)"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enabledFeeTypes.map(ft => (
                    <TableRow key={ft.type}>
                      <TableCell className="font-medium">{ft.label}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step={amountType === "1" ? "0.01" : "0.01"}
                          value={splitAmounts[ft.type] || ""}
                          onChange={e => setSplitAmounts(prev => ({ ...prev, [ft.type]: Number(e.target.value) }))}
                          placeholder={amountType === "1" ? "Enter amount" : "Enter %"}
                          className="w-40"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox checked={splitIsSelf} onCheckedChange={(c) => setSplitIsSelf(!!c)} id="splitIsSelf" />
                  <Label htmlFor="splitIsSelf" className="text-sm">Is Self?</Label>
                </div>
                <Button onClick={handleAddVendorSplit}><Plus className="h-4 w-4 mr-2" />Add Vendor Split</Button>
              </div>
            </>
          )}
        </div>

        {/* Added vendors list */}
        {addedVendorIds.length > 0 && (
          <div className="space-y-3">
            <h4 className="row-h3">Added Vendors</h4>
            {addedVendorIds.map(kycId => {
              const vendor = kycVendors.find(k => k.id === kycId);
              const vendorSplitsForKyc = vendorSplits.filter(s => s.fkKycId === kycId);
              const isDefaultVendor = isDefaultSettlementVendorId(vendor?.vendorId || vendorSplitsForKyc[0]?.vendorId);
              const isSelf = vendorSplitsForKyc[0]?.isSelf || false;
              const acLabel = getAccountLabel(kycId);
              return (
                <div key={kycId} className={`border rounded-lg p-3 ${isDefaultVendor ? "bg-muted/50 border-muted-foreground/30" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isDefaultVendor && <Lock className="h-4 w-4 text-muted-foreground" />}
                        <Badge variant="outline">{acLabel}</Badge>
                        <span className="font-medium">{vendor?.name || vendorSplitsForKyc[0]?.vendorName}</span>
                        <span className="text-sm text-muted-foreground">({vendor?.vendorId || vendorSplitsForKyc[0]?.vendorId})</span>
                        {isDefaultVendor && <Badge variant="secondary">Default</Badge>}
                        {isSelf && <Badge variant="outline" className="border-blue-500 text-blue-600">Self</Badge>}
                      </div>
                      {/* Bank account info — same small line as in the selector
                          so admin can confirm the right account at a glance. */}
                      {vendor && (vendor.accountHolder || vendor.accountNumber || vendor.ifsc) && (
                        <div className="text-[11px] text-muted-foreground mt-1 leading-tight">
                          {vendor.accountHolder && <span>{vendor.accountHolder}</span>}
                          {vendor.accountHolder && (vendor.accountNumber || vendor.ifsc) && <span> · </span>}
                          {vendor.accountNumber && <span>A/C {vendor.accountNumber}</span>}
                          {vendor.accountNumber && vendor.ifsc && <span> · </span>}
                          {vendor.ifsc && <span>Bank code {vendor.ifsc}</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {isDefaultVendor && (
                        <Button
                          variant="ghost" size="icon"
                          title="Recalculate from the current Default Amount + Online Surcharge % (its split can go stale if you added it before those were filled in)"
                          onClick={handleRefreshDefaultVendor}
                        >
                          <RefreshCw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteVendorGroup(kycId)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {vendorSplitsForKyc.map((split, idx) => {
                      const ft = enabledFeeTypes.find(f => f.type === split.fkFeeType);
                      return (
                        <div key={idx} className={`text-sm px-3 py-1.5 rounded flex items-center gap-2 ${isDefaultVendor ? "bg-muted/70" : "bg-muted"}`}>
                          <span className="text-muted-foreground whitespace-nowrap">{ft?.label || `Fee Type ${split.fkFeeType}`}:</span>
                          {isDefaultVendor ? (
                            <span className="font-medium">{amountType === "1" ? `${cur}${split.splitAmount.toFixed(2)}` : `${split.splitAmount}%`}</span>
                          ) : (
                            <Input
                              type="number" step="0.01" className="row-field-sm w-24"
                              value={split.splitAmount || ""}
                              onChange={e => {
                                const newVal = Number(e.target.value);
                                setVendorSplits(prev => prev.map(s =>
                                  s.fkKycId === kycId && s.fkFeeType === split.fkFeeType ? { ...s, splitAmount: newVal } : s
                                ));
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>)}
      </CardContent>
    </Card>
  );

  return renderStep3VendorSplits();
}
