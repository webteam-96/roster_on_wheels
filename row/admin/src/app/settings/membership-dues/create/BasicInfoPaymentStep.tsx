import { currencyOptions } from "@/lib/currency";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ReactQuill } from "./membershipDuesShared";
import type { MembershipDuesFormCtx } from "./useMembershipDuesForm";

export default function BasicInfoPaymentStep({ v }: { v: MembershipDuesFormCtx }) {
  const { isAdminEdit, selectedDistrictId, setSelectedDistrictId, setSelectedClubId, isEdit, allDistricts, selectedClubId, districtClubs, rotaryYear, setRotaryYear, rotaryYears, purpose, setPurpose, description, setDescription, quillModules, shouldDisableMode, modeOfPayment, setModeOfPayment, sendBankDetails, setSendBankDetails, bankName, setBankName, accountNumber, setAccountNumber, ifscCode, setIfscCode, isSuperAdmin, notifyEmail, setNotifyEmail, currency, setCurrency } = v;

  // ---- RENDER STEPS ----

  const renderStep1BasicInfoPayment = () => (
    <Card>
      <CardHeader><CardTitle>{isAdminEdit ? "Basic Information" : "Basic Information & Payment Settings"}</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>District *</Label>
            <Select value={selectedDistrictId} onValueChange={v => { setSelectedDistrictId(v); setSelectedClubId(""); }} disabled={isEdit || isAdminEdit}>
              <SelectTrigger className={(isEdit || isAdminEdit) ? "bg-gray-100 opacity-60" : ""}><SelectValue placeholder="Choose district" /></SelectTrigger>
              <SelectContent>
                {allDistricts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Club *</Label>
            <Select value={selectedClubId} onValueChange={setSelectedClubId} disabled={!selectedDistrictId || isEdit || isAdminEdit}>
              <SelectTrigger className={(isEdit || isAdminEdit) ? "bg-gray-100 opacity-60" : ""}><SelectValue placeholder="Choose club" /></SelectTrigger>
              <SelectContent>
                {districtClubs.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Rotary Year *</Label>
            <Select value={rotaryYear} onValueChange={setRotaryYear} disabled={isEdit || isAdminEdit}>
              <SelectTrigger className={(isEdit || isAdminEdit) ? "bg-gray-100 opacity-60" : ""}><SelectValue placeholder="Choose year" /></SelectTrigger>
              <SelectContent>
                {rotaryYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Purpose *</Label>
            <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Title / Purpose of the dues" />
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <ReactQuill
            theme="snow"
            value={description}
            onChange={setDescription}
            modules={quillModules}
            placeholder="Description (optional): supports bold / italic / sizes / colors / lists / links"
          />
        </div>

        {/* Payment Settings - hidden for Admin edit */}
        {!isAdminEdit && (
          <>
            <hr className="my-2" />
            <h3 className="row-h2">Payment Settings</h3>
            <div>
              <Label>Mode of Payment</Label>
              <div className="flex items-center gap-6 mt-2">
                <label className={`flex items-center gap-2 ${shouldDisableMode("1") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="radio" name="modeOfPayment" value="1" checked={modeOfPayment === "1"} onChange={e => setModeOfPayment(e.target.value)} className="accent-primary" disabled={shouldDisableMode("1")} />
                  <span>Online</span>
                </label>
                <label className={`flex items-center gap-2 ${shouldDisableMode("2") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="radio" name="modeOfPayment" value="2" checked={modeOfPayment === "2"} onChange={e => setModeOfPayment(e.target.value)} className="accent-primary" disabled={shouldDisableMode("2")} />
                  <span>Offline</span>
                </label>
                <label className={`flex items-center gap-2 ${shouldDisableMode("3") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
                  <input type="radio" name="modeOfPayment" value="3" checked={modeOfPayment === "3"} onChange={e => setModeOfPayment(e.target.value)} className="accent-primary" disabled={shouldDisableMode("3")} />
                  <span>Both</span>
                </label>
              </div>
            </div>
            {(modeOfPayment === "2" || modeOfPayment === "3") && (
              <>
                <div className="flex items-center gap-3">
                  <Checkbox checked={sendBankDetails} onCheckedChange={(c) => setSendBankDetails(!!c)} id="sendBankDetails" />
                  <Label htmlFor="sendBankDetails">Do you want to send Bank details in Receipt?</Label>
                </div>
                {sendBankDetails && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/30">
                    <div>
                      <Label>Bank Name <span className="text-destructive">*</span></Label>
                      <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name" />
                    </div>
                    <div>
                      <Label>Account Number <span className="text-destructive">*</span></Label>
                      <Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account number" />
                    </div>
                    <div>
                      <Label>Bank code <span className="text-destructive">*</span></Label>
                      <Input value={ifscCode} onChange={e => setIfscCode(e.target.value)} placeholder="IFSC, SWIFT or routing number" />
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Send via + Currency — Super Admin only (server ignores these for others) */}
        {isSuperAdmin && (
          <>
            <hr className="my-2" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Email to members</Label>
                <label htmlFor="notifyEmail" className="flex items-center gap-2 cursor-pointer mt-2">
                  <Checkbox id="notifyEmail" checked={notifyEmail} onCheckedChange={(c) => setNotifyEmail(!!c)} />
                  <span>Send reminders, receipts and notices by email</span>
                </label>
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {currencyOptions().map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  return renderStep1BasicInfoPayment();
}
