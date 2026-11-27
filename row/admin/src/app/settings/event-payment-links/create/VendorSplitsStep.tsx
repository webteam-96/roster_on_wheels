import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Trash2, Check, ChevronsUpDown } from "@/components/icons";
import { currencySymbol } from "@/lib/appFormat";
import type { PaymentLinkFormCtx } from "./usePaymentLinkForm";

export default function VendorSplitsStep({ v }: { v: PaymentLinkFormCtx }) {
  const { amountType, setAmountType, registrations, vendorSplits, splitVendorOpen, setSplitVendorOpen, splitVendorId, kycVendors, addedVendorIds, setSplitVendorId, splitAmounts, setSplitAmounts, handleAddVendorSplit, handleDeleteVendorGroup } = v;

  const renderStepVendorSplits = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle>Vendor Splits ({amountType === "1" ? "Amount" : "Percentage %"})</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm">Amount Type:</Label>
            <Select value={amountType} onValueChange={setAmountType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Fixed amount</SelectItem>
                <SelectItem value="2">Percentage (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Registration totals summary */}
        <div className="border rounded-lg p-3 bg-muted/30">
          <h4 className="row-h3 mb-2">Registration Split Summary</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Registration</TableHead>
                <TableHead>{amountType === "1" ? "Amount" : "Total %"}</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map(reg => {
                const total = vendorSplits.filter(s => s.fkRegistrationTempId === reg.tempId).reduce((sum, s) => sum + s.splitAmount, 0);
                const target = amountType === "1" ? reg.amount : 100;
                const remaining = target - total;
                const isValid = Math.abs(remaining) < 0.01;
                return (
                  <TableRow key={reg.tempId}>
                    <TableCell className="font-medium">{reg.registrationName}</TableCell>
                    <TableCell>{amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : "100%"}</TableCell>
                    <TableCell>{amountType === "1" ? `${currencySymbol()}${total.toFixed(2)}` : `${total.toFixed(1)}%`}</TableCell>
                    <TableCell className={remaining > 0.01 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                      {amountType === "1" ? `${currencySymbol()}${remaining.toFixed(2)}` : `${remaining.toFixed(1)}%`}
                    </TableCell>
                    <TableCell>{isValid ? <Check className="h-4 w-4 text-green-600" /> : <span className="text-red-600 text-xs">Incomplete</span>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

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
                        <CommandItem key={k.id} value={`${k.name} ${k.vendorId}`} onSelect={() => { setSplitVendorId(k.id); setSplitVendorOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${splitVendorId === k.id ? "opacity-100" : "opacity-0"}`} />
                          <div>
                            <div className="font-medium">{k.name}</div>
                            <div className="text-xs text-muted-foreground">{k.vendorId}</div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {splitVendorId > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registration Type</TableHead>
                    <TableHead>{amountType === "1" ? "Registration Amount" : "Total %"}</TableHead>
                    <TableHead>{amountType === "1" ? "Split amount" : "Split Percentage (%)"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map(reg => (
                    <TableRow key={reg.tempId}>
                      <TableCell className="font-medium">{reg.registrationName}</TableCell>
                      <TableCell>{amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : "100%"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step={amountType === "1" ? "0.01" : "0.1"}
                          value={splitAmounts[reg.tempId] || ""}
                          onChange={e => setSplitAmounts(prev => ({ ...prev, [reg.tempId]: Number(e.target.value) }))}
                          placeholder={amountType === "1" ? "Enter amount" : "Enter %"}
                          className="w-40"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end">
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
              return (
                <div key={kycId} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium">{vendor?.name || vendorSplitsForKyc[0]?.vendorName}</span>
                      <span className="text-sm text-muted-foreground ml-2">({vendor?.vendorId || vendorSplitsForKyc[0]?.vendorId})</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteVendorGroup(kycId)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {vendorSplitsForKyc.map((split, idx) => {
                      const reg = registrations.find(r => r.tempId === split.fkRegistrationTempId);
                      return (
                        <div key={idx} className="text-sm bg-muted px-3 py-1.5 rounded">
                          <span className="text-muted-foreground">{reg?.registrationName}: </span>
                          <span className="font-medium">{amountType === "1" ? `${currencySymbol()}${split.splitAmount.toFixed(2)}` : `${split.splitAmount}%`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return renderStepVendorSplits();
}
