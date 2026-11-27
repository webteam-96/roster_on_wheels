import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RotaryLoader from "@/components/RotaryLoader";
import EmailTokenChips, { CLUB_DUES_RECEIPT_TOKENS, CLUB_DUES_REMINDER_TOKENS } from "@/components/club-dues/EmailTokenChips";
import { ReactQuill, insertQuillToken } from "./clubDuesShared";
import type { ClubDuesFormCtx } from "./useClubDuesForm";

export default function ImagesEmailStep({ v }: { v: ClubDuesFormCtx }) {
  const { imageField, logoFile, setLogoFile, existingLogo, bgFile, setBgFile, existingBg, emailLogoFile, setEmailLogoFile, existingEmailLogo, emailCC, setEmailCC, emailSubject, setEmailSubject, emailBodyRef, emailBody, setEmailBody, quillModules, emailReminderSubject, setEmailReminderSubject, emailReminderBodyRef, emailReminderBody, setEmailReminderBody, reminderButtonText, setReminderButtonText, googleSheetEmail, setGoogleSheetEmail, testEmail, setTestEmail, testBusy, sendTest, testMsg } = v;

  const renderImagesEmail = () => (
    <Card>
      <CardHeader><CardTitle>Images &amp; Email</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="row-h2 mb-2">Images</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {imageField("Purpose logo", logoFile, setLogoFile, existingLogo)}
            {imageField("Background image", bgFile, setBgFile, existingBg)}
            {imageField("Email header logo", emailLogoFile, setEmailLogoFile, existingEmailLogo)}
          </div>
        </div>
        <div>
          <h3 className="row-h2 mb-2">Email</h3>
          <p className="text-xs text-muted-foreground mb-3">Click a chip to insert a value (e.g. club name, amount) into your text. It&apos;s filled in automatically when the email is sent. If you don&apos;t add an amount/members value, a summary is appended for you.</p>
          <div className="space-y-4">
            <div className="space-y-2 max-w-md"><Label>Email CC</Label><Input value={emailCC} onChange={(e) => setEmailCC(e.target.value)} placeholder="cc@example.com, another@example.com" /></div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Receipt (thank-you) email</p>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Your District Dues receipt" />
                <EmailTokenChips tokens={CLUB_DUES_RECEIPT_TOKENS} onInsert={(t) => setEmailSubject((v) => (v ? v + " " : "") + t)} />
              </div>
              <div className="space-y-1">
                <Label>Body</Label>
                <ReactQuill forwardedRef={emailBodyRef} theme="snow" value={emailBody} onChange={setEmailBody} modules={quillModules} placeholder="Receipt email message (optional)" />
                <EmailTokenChips tokens={CLUB_DUES_RECEIPT_TOKENS} onInsert={(t) => insertQuillToken(emailBodyRef, setEmailBody, t)} />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Reminder email</p>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={emailReminderSubject} onChange={(e) => setEmailReminderSubject(e.target.value)} placeholder="District Dues reminder" />
                <EmailTokenChips tokens={CLUB_DUES_REMINDER_TOKENS} onInsert={(t) => setEmailReminderSubject((v) => (v ? v + " " : "") + t)} />
              </div>
              <div className="space-y-1">
                <Label>Body</Label>
                <ReactQuill forwardedRef={emailReminderBodyRef} theme="snow" value={emailReminderBody} onChange={setEmailReminderBody} modules={quillModules} placeholder="Reminder email message (optional)" />
                <EmailTokenChips tokens={CLUB_DUES_REMINDER_TOKENS} onInsert={(t) => insertQuillToken(emailReminderBodyRef, setEmailReminderBody, t)} />
              </div>
              <div className="space-y-1">
                <Label>Pay button text</Label>
                <Input value={reminderButtonText} onChange={(e) => setReminderButtonText(e.target.value)} placeholder="Pay Now/Record Offline Payment Here" />
                <p className="text-xs text-muted-foreground">Text shown on the button in the reminder email. Leave blank to use the default.</p>
              </div>
              <div className="space-y-1">
                <Label>Google Sheet share email</Label>
                <Input type="email" value={googleSheetEmail} onChange={(e) => setGoogleSheetEmail(e.target.value)} placeholder="support@example.org" />
                <p className="text-xs text-muted-foreground">A Google Sheet can be created for this campaign from the District Dues list: enter an email to share editor access.</p>
              </div>
            </div>

            <div className="rounded-md border border-dashed p-3 space-y-2">
              <p className="text-sm font-medium">Send a test email</p>
              <p className="text-xs text-muted-foreground">Uses the text above with sample values.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="email" className="max-w-xs" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                <Button type="button" variant="outline" size="sm" disabled={testBusy !== null} onClick={() => sendTest("reminder")}>
                  {testBusy === "reminder" && <RotaryLoader size="sm" />}Test reminder
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={testBusy !== null} onClick={() => sendTest("receipt")}>
                  {testBusy === "receipt" && <RotaryLoader size="sm" />}Test thank-you
                </Button>
              </div>
              {testMsg && <p className={`text-xs ${testMsg.ok ? "text-green-600" : "text-red-600"}`}>{testMsg.text}</p>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return renderImagesEmail();
}
