import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye } from "@/components/icons";
import type { PaymentLinkFormCtx } from "./usePaymentLinkForm";

export default function EmailStep({ v }: { v: PaymentLinkFormCtx }) {
  const { setEmailLogoFile, emailCc, setEmailCc, emailSubject, setEmailSubject, emailBody, setEmailBody, setPreviewReceipt, emailReminderSubject, setEmailReminderSubject, emailReminderBody, setEmailReminderBody, setPreviewReminder, googleSheetEmail, setGoogleSheetEmail, previewReceipt, getReceiptPreviewHtml, previewReminder, getReminderPreviewHtml } = v;

  const renderStepEmail = () => (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div>
          <Label>Email Logo</Label>
          <Input type="file" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={e => setEmailLogoFile(e.target.files?.[0] || null)} />
          <p className="text-xs text-muted-foreground mt-1.5">Allowed: JPG, JPEG, PNG, GIF, WEBP</p>
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
            <p>Dear &#123;name&#125;,</p>
            <p>District Number : &#123;districtNumber&#125;</p>
            <p>Club Name : &#123;clubName&#125;</p>
            <p>Purpose of the payment : &#123;purpose&#125;</p>
            <p>Amount received : &#123;amount&#125;/-</p>
            <p>Date and time : &#123;dateTime&#125;</p>
            <p>Method of payment : &#123;paymentMethod&#125;</p>
            <p>Transaction ID : &#123;transactionId&#125;</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={4} placeholder="Add any extra content after the default template..." />
          </div>
          <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => setPreviewReceipt(true)}><Eye className="h-4 w-4 mr-1" />Preview Receipt</Button></div>
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
            <p>Dear &#123;name&#125;,</p>
            <p>District Number : &#123;districtNumber&#125;</p>
            <p>Club Name : &#123;clubName&#125;</p>
            <p>Purpose of the payment : &#123;purpose&#125;</p>
            <p>Outstanding amount : &#123;amount&#125;/-</p>
            <p>Status : &#123;status&#125;</p>
            <p>Click on the link : &#123;paymentLink&#125;</p>
          </div>
          <div>
            <Label>Additional Content (optional)</Label>
            <Textarea value={emailReminderBody} onChange={e => setEmailReminderBody(e.target.value)} rows={4} placeholder="Add any extra content after the default template..." />
          </div>
          <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => setPreviewReminder(true)}><Eye className="h-4 w-4 mr-1" />Preview Reminder</Button></div>
        </div>

        {/* Google Sheet Email */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="row-h3">Google Sheet Integration</h3>
          <div>
            <Label>Google Sheet Email (optional)</Label>
            <Input value={googleSheetEmail} onChange={e => setGoogleSheetEmail(e.target.value)} placeholder="Enter email to share Google Sheet access" />
            <p className="text-xs text-muted-foreground mt-1">A Google Sheet will be auto-created for this event. Enter an email to share editor access.</p>
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
      </CardContent>
    </Card>
  );

  return renderStepEmail();
}
