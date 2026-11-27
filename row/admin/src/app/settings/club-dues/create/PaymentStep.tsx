import { ToggleButton } from "@/components/ui/text-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "@/components/icons";
import { SPLITS_ON, VendorRow } from "./clubDuesShared";
import type { ClubDuesFormCtx } from "./useClubDuesForm";

export default function PaymentStep({ v }: { v: ClubDuesFormCtx }) {
  const { independent, updateRow, addRow, removeRow, routeAccounts, amountType, cur, modeOfPayment, setModeOfPayment, setAmountType, isOffline, offlineRate, setOfflineRate, offlineVendorRows, updateOfflineRow, addOfflineRow, removeOfflineRow, offlineFilledRows, offlineSplitTotal, offlineSplitOk, approverEmail, setApproverEmail, showBankInReceipt, setShowBankInReceipt, bankName, setBankName, accountNumber, setAccountNumber, ifsc, setIfsc, isOnline, onlineRate, setOnlineRate, onlineVendorRows, updateOnlineRow, addOnlineRow, removeOnlineRow, onlineFilledRows, onlineSplitTotal, onlineSplitOk, rate, setRate, onlineSurcharge, setOnlineSurcharge, vendorRows, filledRows, splitOk, splitTotal } = v;

  // ── Step 2: Payment & Split ─────────────────────────────────
  const renderPayment = () => (independent ? renderPaymentIndependent() : renderPaymentLegacy());

  // Reusable vendor-split block (account picker + value + running total), shared by the independent
  // mode's Online and Offline sections.
  const renderVendorSection = (
    title: string,
    rows: VendorRow[],
    updateRow: (i: number, field: keyof VendorRow, value: string) => void,
    addRow: () => void,
    removeRow: (i: number) => void,
    filled: VendorRow[],
    total: number,
    ok: boolean,
    rateVal: string,
  ) => (
    <div>
      <h3 className="row-h2 mb-2">{title}</h3>
      <div className="space-y-3 rounded-md border p-3">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Select value={row.routeAccountId} onValueChange={(v) => updateRow(i, "routeAccountId", v)}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {routeAccounts
                  .filter((a) => String(a.id) === row.routeAccountId || !rows.some((rr, idx) => idx !== i && rr.routeAccountId === String(a.id)))
                  .map((a) => {
                  const bank = `••••${a.bankAccountLast4 || "----"} · Bank code ${a.bankIfsc || "N/A"}`;
                  return (
                    <SelectItem key={a.id} value={String(a.id)} className="py-2">
                      <div className="flex flex-col items-start gap-0.5 text-left leading-tight">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{bank}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="w-28">
              <Input type="number" value={row.value} onChange={(e) => updateRow(i, "value", e.target.value)} placeholder={amountType === "2" ? "%" : cur} />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={rows.length === 1}><X className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 h-4 w-4" />Add account</Button>
          {filled.length > 0 && (
            <span className={`text-sm ${ok ? "text-green-600" : "text-red-600"}`}>
              Total: {amountType === "2" ? `${total}% / 100%` : `${cur}${total} / ${cur}${rateVal || 0}`}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {amountType === "2" ? "Percentages must total 100%." : `Amounts must total the per-member rate (${cur}${rateVal || 0}).`} Leave all empty to send the full amount to the main account.
        </p>
      </div>
    </div>
  );

  const renderPaymentIndependent = () => (
    <Card>
      <CardHeader><CardTitle>Payment & Split</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 max-w-xs">
          <Label>Mode of Payment</Label>
          <Select value={modeOfPayment} onValueChange={setModeOfPayment}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Online only</SelectItem>
              <SelectItem value="2">Offline only</SelectItem>
              <SelectItem value="3">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Online and Offline are fully independent: each has its own per-member rate and account split. A club only needs <b>one</b> of them fully paid to be marked Paid.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Label>Split by</Label>
          <div role="group" aria-label="Split by" className="inline-flex gap-2">
            <ToggleButton pressed={amountType === "2"} onClick={() => setAmountType("2")}>Percentage</ToggleButton>
            <ToggleButton pressed={amountType === "1"} onClick={() => setAmountType("1")}>Amount</ToggleButton>
          </div>
        </div>

        {isOffline && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2 max-w-xs">
              <Label>Offline per-member Rate ({cur})<span className="text-destructive ml-1">*</span></Label>
              <Input type="number" value={offlineRate} onChange={(e) => setOfflineRate(e.target.value)} placeholder="e.g. 100" />
            </div>
            {SPLITS_ON && renderVendorSection("Offline Split", offlineVendorRows, updateOfflineRow, addOfflineRow, removeOfflineRow, offlineFilledRows, offlineSplitTotal, offlineSplitOk, offlineRate)}
            <div className="space-y-2 max-w-md">
              <Label>Approver email: District Treasurer</Label>
              <Input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="treasurer@example.com" />
              <p className="text-xs text-muted-foreground">Used only when a club submits an <b>offline</b> payment: the approve/reject email is sent here.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="checkbox" id="showBankInd" checked={showBankInReceipt} onChange={(e) => setShowBankInReceipt(e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="showBankInd">Do you want to send Bank details in Receipt?</Label>
            </div>
            {showBankInReceipt && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" /></div>
                <div className="space-y-2"><Label>Account no.</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 50100XXXXXX" /></div>
                <div className="space-y-2"><Label>Bank code</Label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="IFSC, SWIFT or routing number" /></div>
              </div>
            )}
          </div>
        )}

        {isOnline && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-2 max-w-xs">
              <Label>Online per-member Rate ({cur})<span className="text-destructive ml-1">*</span></Label>
              <Input type="number" value={onlineRate} onChange={(e) => setOnlineRate(e.target.value)} placeholder="e.g. 103" />
            </div>
            {SPLITS_ON && renderVendorSection("Online Split (Razorpay Route)", onlineVendorRows, updateOnlineRow, addOnlineRow, removeOnlineRow, onlineFilledRows, onlineSplitTotal, onlineSplitOk, onlineRate)}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderPaymentLegacy = () => (
    <Card>
      <CardHeader><CardTitle>Payment & Split</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
          <div className="space-y-2">
            <Label>Per-member Rate ({cur})<span className="text-destructive ml-1">*</span></Label>
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 100" />
            <p className="text-xs text-muted-foreground">Default for all clubs; override per club in the next step.</p>
          </div>
          <div className="space-y-2">
            <Label>Mode of Payment</Label>
            <Select value={modeOfPayment} onValueChange={setModeOfPayment}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Online only</SelectItem>
                <SelectItem value="2">Offline only</SelectItem>
                <SelectItem value="3">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isOnline && (
          <div className="space-y-2 max-w-xs">
            <Label>Online surcharge (%)</Label>
            <Input type="number" step="0.01" min="0" value={onlineSurcharge} onChange={(e) => setOnlineSurcharge(e.target.value)} placeholder="e.g. 2" />
            <p className="text-xs text-muted-foreground">Added on top of the rate for <b>online</b> payments only (e.g. to cover the gateway fee). Offline pays the base rate. Editable anytime.</p>
          </div>
        )}

        {SPLITS_ON && isOnline && (
          <div>
            <h3 className="row-h2 mb-2">Online Split (Razorpay Route)</h3>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label>Split by</Label>
                <div role="group" aria-label="Split by" className="inline-flex gap-2">
                  <ToggleButton pressed={amountType === "2"} onClick={() => setAmountType("2")}>Percentage</ToggleButton>
                  <ToggleButton pressed={amountType === "1"} onClick={() => setAmountType("1")}>Amount</ToggleButton>
                </div>
              </div>
              {vendorRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={row.routeAccountId} onValueChange={(v) => updateRow(i, "routeAccountId", v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {routeAccounts
                        .filter((a) => String(a.id) === row.routeAccountId || !vendorRows.some((rr, idx) => idx !== i && rr.routeAccountId === String(a.id)))
                        .map((a) => {
                        const bank = `••••${a.bankAccountLast4 || "----"} · Bank code ${a.bankIfsc || "N/A"}`;
                        return (
                          <SelectItem key={a.id} value={String(a.id)} className="py-2">
                            <div className="flex flex-col items-start gap-0.5 text-left leading-tight">
                              <span className="font-medium">{a.name}</span>
                              <span className="text-xs text-muted-foreground">{bank}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <div className="w-28">
                    <Input type="number" value={row.value} onChange={(e) => updateRow(i, "value", e.target.value)} placeholder={amountType === "2" ? "%" : cur} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={vendorRows.length === 1}><X className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 h-4 w-4" />Add account</Button>
                {filledRows.length > 0 && (
                  <span className={`text-sm ${splitOk ? "text-green-600" : "text-red-600"}`}>
                    Total: {amountType === "2" ? `${splitTotal}% / 100%` : `${cur}${splitTotal} / ${cur}${rate || 0}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {amountType === "2" ? "Percentages must total 100%." : `Amounts must total the per-member rate (${cur}${rate || 0}).`} Leave all empty to send the full amount to the main account.
              </p>
            </div>
          </div>
        )}

        {isOffline && (
          <div>
            <h3 className="row-h2 mb-2">Offline Payment</h3>
            <div className="space-y-4">
              <div className="space-y-2 max-w-md">
                <Label>Approver email: District Treasurer</Label>
                <Input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="treasurer@example.com" />
                <p className="text-xs text-muted-foreground">Used only when a club submits an <b>offline</b> payment: the approve/reject email is sent here.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" id="showBank" checked={showBankInReceipt} onChange={(e) => setShowBankInReceipt(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="showBank">Do you want to send Bank details in Receipt?</Label>
              </div>
              {showBankInReceipt && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" /></div>
                  <div className="space-y-2"><Label>Account no.</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. 50100XXXXXX" /></div>
                  <div className="space-y-2"><Label>Bank code</Label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="IFSC, SWIFT or routing number" /></div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return renderPayment();
}
