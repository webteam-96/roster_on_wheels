"use client";

/**
 * The donation receipt letter of one club or district: organisation name, letter text with placeholders, the tax
 * statement the country needs and the signatory. Preview downloads a sample PDF of the text as typed.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Save } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { getDonationReceiptTemplate, previewDonationReceiptTemplate, saveDonationReceiptTemplate } from "@/services/api";
import type { DonationReceiptTemplate, DonationScope } from "@/types/donations";

export default function ReceiptLetterEditor({ scope, scopeId, basePath }: { scope: DonationScope; scopeId: number; basePath: string }) {
  const [tpl, setTpl] = useState<DonationReceiptTemplate | null>(null);
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getDonationReceiptTemplate(scope, scopeId)
      .then((r) => {
        setTpl({ ...r.template, body: r.template.body ?? r.defaultBody });
        setPlaceholders(r.placeholders);
      })
      .catch((err) => setLoadError(err?.response?.data?.message || "Could not load the receipt letter."));
  }, [scope, scopeId]);

  const set = (patch: Partial<DonationReceiptTemplate>) => setTpl((t) => (t ? { ...t, ...patch } : t));

  const act = async (kind: "save" | "preview") => {
    if (!tpl) return;
    setBusy(kind);
    setStatus(null);
    try {
      if (kind === "save") {
        await saveDonationReceiptTemplate(scope, scopeId, tpl);
        setStatus({ ok: true, text: "Saved. New receipts use this letter." });
      } else {
        await previewDonationReceiptTemplate(scope, scopeId, tpl);
      }
    } catch (err: any) {
      setStatus({ ok: false, text: err?.response?.data?.message || "Could not do that. Please try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <Link href={basePath} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> All campaigns
      </Link>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Receipt letter</h2>
        <p className="text-base text-muted-foreground">
          Every donor gets this letter as a PDF with their thank-you email, and you can download it from a campaign.
          Add the tax statement your country needs, for example your charity registration number.
        </p>
      </div>

      {loadError ? (
        <Card><CardContent className="p-5 text-sm text-destructive" role="alert">{loadError}</CardContent></Card>
      ) : !tpl ? (
        <div className="space-y-4" aria-busy="true"><Skeleton className="h-9 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-9 w-2/3" /></div>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="rl-org">Organisation name on the letter</Label>
              <Input id="rl-org" maxLength={200} placeholder="Leave empty to use the club or district name"
                value={tpl.legalName ?? ""} onChange={(e) => set({ legalName: e.target.value || null })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rl-body">Letter</Label>
              <Textarea id="rl-body" rows={9} maxLength={5000} value={tpl.body ?? ""} onChange={(e) => set({ body: e.target.value || null })} />
              <p className="text-xs text-muted-foreground">
                Leave an empty line between paragraphs. These words are filled in for each donor:{" "}
                {placeholders.map((p) => <code key={p} className="mr-1.5 rounded-sm bg-muted px-1">{`{${p}}`}</code>)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rl-tax">Tax statement</Label>
              <Textarea id="rl-tax" rows={3} maxLength={1000} value={tpl.taxStatement ?? ""} onChange={(e) => set({ taxStatement: e.target.value || null })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rl-sig">Signed by</Label>
                <Input id="rl-sig" maxLength={150} value={tpl.signatoryName ?? ""} onChange={(e) => set({ signatoryName: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-title">Their role</Label>
                <Input id="rl-title" maxLength={150} placeholder="Treasurer" value={tpl.signatoryTitle ?? ""} onChange={(e) => set({ signatoryTitle: e.target.value || null })} />
              </div>
            </div>
            {status && <p className={`text-sm ${status.ok ? "text-primary" : "text-destructive"}`} role={status.ok ? "status" : "alert"}>{status.text}</p>}
            <div className="flex flex-wrap gap-2">
              <Button className="gap-1.5" disabled={!!busy} onClick={() => act("save")}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
              <Button variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => act("preview")}>
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Sample PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
