import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye } from "@/components/icons";
import { ReactQuill } from "./membershipDuesShared";
import type { MembershipDuesFormCtx } from "./useMembershipDuesForm";

export default function ImagesEmailStep({ v }: { v: MembershipDuesFormCtx }) {
  const { setLogoFile, existingLogoUrl, logoFile, setBgImageFile, existingBgUrl, bgImageFile, setEmailLogoFile, existingEmailLogoUrl, emailLogoFile, emailCc, setEmailCc, emailSubject, setEmailSubject, cur, curSuffix, emailBody, setEmailBody, quillModules, setPreviewReceipt, emailReminderSubject, setEmailReminderSubject, emailReminderBody, setEmailReminderBody, setPreviewReminder, previewReceipt, getReceiptPreviewHtml, previewReminder, getReminderPreviewHtml, googleSheetEmail, setGoogleSheetEmail } = v;

  const renderStep5ImagesEmail = () => (
    <Card>
      <CardHeader><CardTitle>Images & Email Templates</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* Images */}
        <h3 className="row-h2">Images</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Banner / Logo (PurposeLogo)</Label>
            <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} />
            <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
            {existingLogoUrl && !logoFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Current:</p>
                <img src={existingLogoUrl} alt="Current logo" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
            {logoFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">New (preview):</p>
                <img src={URL.createObjectURL(logoFile)} alt="New logo" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
          </div>
          <div>
            <Label>Background Image</Label>
            <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setBgImageFile(e.target.files?.[0] || null)} />
            <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
            {existingBgUrl && !bgImageFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Current:</p>
                <img src={existingBgUrl} alt="Current background" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
            {bgImageFile && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">New (preview):</p>
                <img src={URL.createObjectURL(bgImageFile)} alt="New background" className="max-h-32 max-w-full rounded border bg-muted/30 object-contain" />
              </div>
            )}
          </div>
        </div>

        {/* Email Templates */}
        <hr className="my-2" />
        <h3 className="row-h2">Email Templates</h3>
        <div>
          <Label>Email Header Logo</Label>
          <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setEmailLogoFile(e.target.files?.[0] || null)} />
          <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
          {existingEmailLogoUrl && !emailLogoFile && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">Current:</p>
              <img src={existingEmailLogoUrl} alt="Current email logo" className="max-h-20 max-w-full rounded border bg-muted/30 object-contain" />
            </div>
          )}
          {emailLogoFile && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">New (preview):</p>
              <img src={URL.createObjectURL(emailLogoFile)} alt="New email logo" className="max-h-20 max-w-full rounded border bg-muted/30 object-contain" />
            </div>
          )}
        </div>
        <div>
          <Label>Email CC</Label>
          <Input value={emailCc} onChange={e => setEmailCc(e.target.value)} placeholder="cc@example.com" />
        </div>

        {/* Receipt Email */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="row-h3">Payment Receipt Email</h3>
          <div>
            <Label>Subject</Label>
            <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
          </div>
          <div className="bg-muted/50 rounded p-3 text-sm">
            <p className="text-muted-foreground mb-1">Default template (auto-included):</p>
            <p>Dear *****,</p>
            <p>District Number : ****</p>
            <p>Club Name : **** **** **** ****</p>
            <p>Purpose of the payment : ****</p>
            <p>Amount received : {cur}****{curSuffix}</p>
            <p>Date and time : ****</p>
            <p>Method of payment : ****</p>
            <p>Transaction ID : ****</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <ReactQuill
              theme="snow"
              value={emailBody}
              onChange={setEmailBody}
              modules={quillModules}
              placeholder="Add any extra content after the default template: supports bold / italic / sizes / colors / lists / links"
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewReceipt(true)}>
              <Eye className="h-4 w-4 mr-1" />Preview Receipt
            </Button>
          </div>
        </div>

        {/* Reminder Email */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="row-h3">Payment Reminder Email</h3>
          <div>
            <Label>Subject</Label>
            <Input value={emailReminderSubject} onChange={e => setEmailReminderSubject(e.target.value)} />
          </div>
          <div className="bg-muted/50 rounded p-3 text-sm">
            <p className="text-muted-foreground mb-1">Default template (auto-included):</p>
            <p>Dear *****,</p>
            <p>District Number : ****</p>
            <p>Club Name : **** **** **** ****</p>
            <p>Purpose of the payment : ****</p>
            <p>Outstanding amount : {cur}****{curSuffix}</p>
            <p>Status : ****</p>
            <p>Click on the link : ****</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <ReactQuill
              theme="snow"
              value={emailReminderBody}
              onChange={setEmailReminderBody}
              modules={quillModules}
              placeholder="Add any extra content after the default template: supports bold / italic / sizes / colors / lists / links"
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewReminder(true)}>
              <Eye className="h-4 w-4 mr-1" />Preview Reminder
            </Button>
          </div>
        </div>

        {/* Preview Dialogs */}
        <Dialog open={previewReceipt} onOpenChange={setPreviewReceipt}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Receipt Email Preview</DialogTitle></DialogHeader>
            <div className="border rounded p-4 space-y-2">
              <p className="text-sm text-muted-foreground"><strong>Subject:</strong> {emailSubject}</p>
              <hr />
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: getReceiptPreviewHtml() }} />
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={previewReminder} onOpenChange={setPreviewReminder}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Reminder Email Preview</DialogTitle></DialogHeader>
            <div className="border rounded p-4 space-y-2">
              <p className="text-sm text-muted-foreground"><strong>Subject:</strong> {emailReminderSubject}</p>
              <hr />
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: getReminderPreviewHtml() }} />
            </div>
          </DialogContent>
        </Dialog>

        {/* Google Sheet Email */}
        <hr className="my-2" />
        <h3 className="row-h2">Google Sheet Integration</h3>
        <div>
          <Label>Google Sheet Email</Label>
          <Input value={googleSheetEmail} onChange={e => setGoogleSheetEmail(e.target.value)} placeholder="Enter email to share Google Sheet access" />
          <p className="text-xs text-muted-foreground mt-1">A Google Sheet will be auto-created for this Club Dues. Enter an email to share editor access.</p>
        </div>
      </CardContent>
    </Card>
  );

  return renderStep5ImagesEmail();
}
