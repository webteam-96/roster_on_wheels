import DateField from "@/components/DateField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appLocale, currencySymbol } from "@/lib/appFormat";
import { validateDomain, validateLabel, sanitizeLabelInput, sanitizeDomainInput } from "./clubWebsitesShared";
import type { ClubWebsitesCtx } from "./useClubWebsites";

export default function EditWebsiteDialog({ v }: { v: ClubWebsitesCtx }) {
  const { editOpen, setEditOpen, editingId, formDistrictId, setFormDistrictId, setFormClubId, districts, rows, formClubId, clubs, formSubdomain, setFormSubdomain, parentDomain, formClientDomain, setFormClientDomain, setDomainCheck, originalClientDomain, domainInPlesk, domainCheckingPlesk, serverIp, runDomainCheck, domainCheck, formThemeId, setFormThemeId, themes, defaultReminderDays, formReminderDays, setFormReminderDays, formStartDate, setFormStartDate, formEndDate, setFormEndDate, formMode, setFormMode, formTrialDays, setFormTrialDays, formAmount, setFormAmount, formTransactionId, setFormTransactionId, formPaymentDate, setFormPaymentDate, formPaymentMode, setFormPaymentMode, formNotes, setFormNotes, clubHistory, selectedClubName, saveForm, saving, domainGateBlocksSave } = v;
  return (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId === null ? "Add Club Website" : "Edit Club Website"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>District * {editingId !== null && <span className="text-xs text-muted-foreground">(frozen)</span>}</Label>
                {editingId === null ? (
                  <>
                    <Select value={formDistrictId} onValueChange={(v) => { setFormDistrictId(v); setFormClubId(""); }}>
                      <SelectTrigger className={!formDistrictId ? "border-red-500" : ""}><SelectValue placeholder="Select District" /></SelectTrigger>
                      <SelectContent>
                        {districts.map((d: any) => (
                          <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!formDistrictId && <p className="text-xs text-red-600 mt-1">Required.</p>}
                  </>
                ) : (
                  <Input disabled value={rows.find(r => r.id === editingId)?.districtNumber ? `District ${rows.find(r => r.id === editingId)?.districtNumber}` : ""} />
                )}
              </div>
              <div>
                <Label>Club * {editingId !== null && <span className="text-xs text-muted-foreground">(frozen)</span>}</Label>
                {editingId === null ? (
                  <>
                    <Select value={formClubId} onValueChange={setFormClubId} disabled={!formDistrictId}>
                      <SelectTrigger className={!formClubId && formDistrictId ? "border-red-500" : ""}>
                        <SelectValue placeholder={
                          !formDistrictId ? "Pick district first" :
                          clubs.length === 0 ? "No clubs available (all have websites)" :
                          "Select Club"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {clubs.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formDistrictId && clubs.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        All clubs in this district already have an active website. Delete one first to free up a club.
                      </p>
                    )}
                    {formDistrictId && clubs.length > 0 && !formClubId && <p className="text-xs text-red-600 mt-1">Required.</p>}
                  </>
                ) : (
                  <Input disabled value={rows.find(r => r.id === editingId)?.clubName || ""} />
                )}
              </div>
              <div>
                {(() => {
                  const currentStatus = editingId !== null ? rows.find(r => r.id === editingId)?.status : null;
                  const isFrozen = editingId !== null && currentStatus && currentStatus !== "Inactive";
                  return (
                    <>
                      <Label>Subdomain * {isFrozen && <span className="text-xs text-muted-foreground">(frozen: cannot change after activation)</span>}</Label>
                      <div className="flex items-stretch">
                        <Input
                          placeholder="rcmumbai"
                          value={formSubdomain}
                          onChange={(e) => setFormSubdomain(sanitizeLabelInput(e.target.value))}
                          disabled={!!isFrozen}
                          className={`rounded-r-none ${formSubdomain && !isFrozen && validateLabel(formSubdomain, true) ? "border-red-500" : ""}`}
                        />
                        <span className="inline-flex items-center px-3 text-sm bg-muted border border-l-0 border-input rounded-r-md text-muted-foreground select-none">
                          .{parentDomain}
                        </span>
                      </div>
                      {isFrozen ? (
                        <p className="text-xs text-amber-600 mt-1">
                          To rename: Deactivate this website → Delete → Add a new record with a different subdomain.
                        </p>
                      ) : formSubdomain && validateLabel(formSubdomain, true) ? (
                        <p className="text-xs text-red-600 mt-1">{validateLabel(formSubdomain, true)}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">Stored exactly as entered (&apos;:&apos; and &apos;/&apos; allowed). Auto-lowercased. Main domain auto-appended.</p>
                      )}
                    </>
                  );
                })()}
              </div>
              <div>
                <Label>Third party Domain (optional)</Label>
                <Input
                  placeholder="e.g., rotarymumbai.org"
                  value={formClientDomain}
                  onChange={(e) => { setFormClientDomain(sanitizeDomainInput(e.target.value)); setDomainCheck({ status: "idle", ips: [] }); }}
                  className={formClientDomain && validateDomain(formClientDomain, false) ? "border-red-500" : ""}
                />
                {formClientDomain && validateDomain(formClientDomain, false) && (
                  <p className="text-xs text-red-600 mt-1">{validateDomain(formClientDomain, false)}</p>
                )}
                {/* DNS pointing + Plesk-application status for the third-party domain */}
                {formClientDomain && !validateDomain(formClientDomain, false) && (() => {
                  const domainChanged = sanitizeDomainInput(formClientDomain) !== sanitizeDomainInput(originalClientDomain);
                  const alreadyAdded = editingId !== null && !domainChanged && domainInPlesk === true;
                  if (domainCheckingPlesk && domainInPlesk === null) {
                    return <p className="text-xs text-muted-foreground mt-2">Checking server for this domain…</p>;
                  }
                  if (alreadyAdded) {
                    return (
                      <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700">
                        ✓ This domain is already added as an application on the server. No DNS check needed.
                      </div>
                    );
                  }
                  return (
                    <div className="mt-2 rounded-md border border-input bg-muted/40 p-3 text-xs space-y-2">
                      <p className="font-medium text-foreground">Point this domain to our server first</p>
                      <p className="text-muted-foreground">At your domain provider&apos;s DNS settings, add this record:</p>
                      <div className="font-mono text-[11px] bg-background border rounded p-2 leading-5">
                        <div>Type: <strong>A</strong></div>
                        <div>Host / Name: <strong>@</strong> (and <strong>www</strong> if you use it)</div>
                        <div>Value / Points to: <strong>{serverIp || "–"}</strong></div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button type="button" size="sm" variant="outline" className="row-btn-sm" onClick={runDomainCheck} disabled={domainCheck.status === "checking"}>
                          {domainCheck.status === "checking" ? "Checking…" : "Check pointing"}
                        </Button>
                        {domainCheck.status === "pass" && (
                          <span className="text-green-700">✓ Points to our server ({serverIp}). You can save now.</span>
                        )}
                        {domainCheck.status === "fail" && (
                          <span className="text-red-600">
                            ✗ Not pointing yet{domainCheck.ips.length ? `: found: ${domainCheck.ips.join(", ")}` : ". No A record found"}
                          </span>
                        )}
                      </div>
                      {domainCheck.status !== "pass" && (
                        <p className="text-amber-600">DNS changes can take a while to propagate. Verify pointing before saving this domain.</p>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div>
                <Label>Template *</Label>
                <Select value={formThemeId} onValueChange={setFormThemeId}>
                  <SelectTrigger className={!formThemeId ? "border-red-500" : ""}><SelectValue placeholder="Select Template" /></SelectTrigger>
                  <SelectContent>
                    {themes.map((t: any) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.themeName || t.theme_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!formThemeId && <p className="text-xs text-red-600 mt-1">Required.</p>}
              </div>
              <div>
                <Label>Reminder Days (override): default {defaultReminderDays}</Label>
                <Input type="number" min="1" max="180" placeholder={`Default ${defaultReminderDays}`} value={formReminderDays} onChange={(e) => setFormReminderDays(e.target.value)} />
              </div>
              <div>
                <Label>Start Date *</Label>
                <DateField value={formStartDate} onChange={setFormStartDate} />
              </div>
              <div>
                <Label>End Date *</Label>
                <DateField value={formEndDate} onChange={setFormEndDate} />
              </div>
              <div className="md:col-span-2 border-t pt-3">
                <Label className="text-sm font-semibold text-primary">Plan</Label>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="planMode"
                      value="purchased"
                      checked={formMode === "purchased"}
                      onChange={() => setFormMode("purchased")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Purchased</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="planMode"
                      value="trial"
                      checked={formMode === "trial"}
                      onChange={() => setFormMode("trial")}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Trial</span>
                  </label>
                  {formMode === "trial" && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Label className="text-xs whitespace-nowrap">Trial Period (days)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={formTrialDays}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFormTrialDays(v);
                          // Auto-update End Date when admin types — pivot off Start Date,
                          // falling back to today so the date picker isn't left blank.
                          const n = parseInt(v, 10);
                          if (Number.isFinite(n) && n > 0) {
                            const base = formStartDate ? new Date(formStartDate) : new Date();
                            base.setDate(base.getDate() + n);
                            setFormEndDate(base.toISOString().slice(0, 10));
                          }
                        }}
                        className="w-24"
                      />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {formMode === "purchased"
                    ? "Capture the payment details below. Trial period is not applicable."
                    : "Payment fields are disabled. Trial Period auto-fills End Date from Start Date."}
                </p>
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Amount Paid</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formMode === "trial" ? "" : formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  disabled={formMode === "trial"}
                  placeholder={formMode === "trial" ? "–" : ""}
                />
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Transaction ID</Label>
                <Input
                  value={formMode === "trial" ? "" : formTransactionId}
                  onChange={(e) => setFormTransactionId(e.target.value)}
                  disabled={formMode === "trial"}
                  placeholder={formMode === "trial" ? "–" : ""}
                />
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Payment Date</Label>
                <DateField value={formMode === "trial" ? "" : formPaymentDate} onChange={setFormPaymentDate} disabled={formMode === "trial"} />
              </div>
              <div>
                <Label className={formMode === "trial" ? "text-muted-foreground" : ""}>Payment Mode</Label>
                <Input
                  placeholder={formMode === "trial" ? "–" : "UPI / Cheque / Bank Transfer"}
                  value={formMode === "trial" ? "" : formPaymentMode}
                  onChange={(e) => setFormPaymentMode(e.target.value)}
                  disabled={formMode === "trial"}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </div>
            </div>

            {/* Club website history (Add mode only) */}
            {editingId === null && clubHistory.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <Label className="text-sm font-semibold text-primary mb-2 block">
                  Previous Websites for {selectedClubName || "this club"}
                </Label>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Subdomain</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead>
                      <TableHead>Status</TableHead><TableHead>Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {clubHistory.map((h: any) => (
                        <TableRow key={h.id}>
                          <TableCell className="font-mono text-xs">{h.subdomain}</TableCell>
                          <TableCell className="text-xs">{h.startDate ? new Date(h.startDate).toLocaleDateString(appLocale()) : "–"}</TableCell>
                          <TableCell className="text-xs">{h.endDate ? new Date(h.endDate).toLocaleDateString(appLocale()) : "–"}</TableCell>
                          <TableCell><Badge variant="outline">{h.status}</Badge></TableCell>
                          <TableCell className="text-xs">{h.amountPaid ? `${currencySymbol()}${Number(h.amountPaid).toLocaleString(appLocale())}` : "–"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveForm} disabled={saving || domainGateBlocksSave} title={domainGateBlocksSave ? "Verify the third-party domain points to the server before saving" : undefined}>{saving ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );
}
