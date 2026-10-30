"use client";

/**
 * Engagement for a club or a district (build list #26-#28): a spotlight card for each membership milestone, each
 * new Paul Harris Fellow and each club target reached (target celebration, B.1 #35) waits for an admin to approve it; an approved card downloads as a PNG to share by hand
 * (nothing is posted to social platforms). The district page also sets the milestone years and the Governor message.
 */

import { useEffect, useState } from "react";
import { Download, Trophy } from "@/components/icons";
import SectionHeader from "@/components/dashboard/SectionHeader";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { fmtDate } from "@/components/dashboard/formatters";
import { apiMessage, selectCls } from "@/components/membership/FoundationDesignationsCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CARD_STATUS_LABELS, parseMilestoneYears } from "@/lib/engagement";
import {
  decideSpotlightCard, getEngagementSettings, getSpotlightCardImage, getSpotlightCards, saveEngagementSettings,
  type SpotlightCard, type SpotlightStatus,
} from "@/services/api";

type Scope = "clubs" | "districts";

export default function EngagementPanel({ scope, scopeId }: { scope: Scope; scopeId: number }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Engagement"
        subtitle="Spotlight cards for membership milestones, new Paul Harris Fellows and club targets reached"
        icon={Trophy}
      />
      {scope === "districts" && <MilestoneSettings districtId={scopeId} />}
      <SpotlightQueue scope={scope} scopeId={scopeId} />
    </div>
  );
}

function SpotlightQueue({ scope, scopeId }: { scope: Scope; scopeId: number }) {
  const [status, setStatus] = useState<SpotlightStatus | "">("pending");
  const [cards, setCards] = useState<SpotlightCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<SpotlightCard | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewId = preview?.id;

  useEffect(() => {
    if (!(scopeId > 0)) return;
    let live = true;
    setCards(null);
    setError(null);
    getSpotlightCards(scope, scopeId, status)
      .then((r) => live && setCards(r))
      .catch((err) => live && setError(apiMessage(err, "Could not load the spotlight cards.")));
    return () => {
      live = false;
    };
  }, [scope, scopeId, status]);

  // The image needs the sign-in token, so it is fetched as a blob instead of an <img src> to the API.
  useEffect(() => {
    if (!previewId) return;
    let live = true;
    let url: string | null = null;
    setPreviewUrl(null);
    getSpotlightCardImage(previewId)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch(() => live && setError("Could not load the card preview."));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewId]);

  const decide = async (card: SpotlightCard, decision: "approve" | "reject") => {
    setBusyId(card.id);
    setError(null);
    try {
      const { cardStatus } = await decideSpotlightCard(card.id, decision);
      setCards((cs) => cs && cs.map((c) => (c.id === card.id ? { ...c, cardStatus } : c)).filter((c) => !status || c.cardStatus === status));
      setPreview((p) => (p && p.id === card.id ? { ...p, cardStatus } : p));
    } catch (err) {
      setError(apiMessage(err, "Could not save the decision."));
    } finally {
      setBusyId(null);
    }
  };

  const download = async (card: SpotlightCard) => {
    setBusyId(card.id);
    setError(null);
    try {
      const url = URL.createObjectURL(await getSpotlightCardImage(card.id, true));
      const link = document.createElement("a");
      link.href = url;
      link.download = `spotlight-${card.id}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not download the card. Approve it first.");
    } finally {
      setBusyId(null);
    }
  };

  const actions = (card: SpotlightCard) => (
    <div className="flex flex-wrap justify-end gap-2">
      {card.cardStatus !== "approved" && (
        <Button type="button" size="sm" disabled={busyId === card.id} onClick={() => decide(card, "approve")}>Approve</Button>
      )}
      {card.cardStatus !== "rejected" && (
        <Button type="button" size="sm" variant="outline" disabled={busyId === card.id} onClick={() => decide(card, "reject")}>Reject</Button>
      )}
      {card.cardStatus === "approved" && (
        <Button type="button" size="sm" variant="outline" disabled={busyId === card.id} onClick={() => download(card)}>
          <Download className="h-4 w-4" /> Download
        </Button>
      )}
    </div>
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Spotlight cards</h2>
        <label className="w-56 space-y-1 text-xs font-semibold text-slate-700">
          <span>Show</span>
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as SpotlightStatus | "")}>
            <option value="pending">{CARD_STATUS_LABELS.pending}</option>
            <option value="approved">{CARD_STATUS_LABELS.approved}</option>
            <option value="rejected">{CARD_STATUS_LABELS.rejected}</option>
            <option value="">All cards</option>
          </select>
        </label>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}
      {cards === null ? (
        !error && <TableSkeleton rows={4} />
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member or club</TableHead>
                {scope === "districts" && <TableHead>Club</TableHead>}
                <TableHead>Occasion</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Card</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-slate-800">{c.memberName}</TableCell>
                  {scope === "districts" && <TableCell className="text-slate-600">{c.clubName}</TableCell>}
                  <TableCell>{c.label}</TableCell>
                  <TableCell className="text-slate-600">{fmtDate(c.occurredOn)}</TableCell>
                  <TableCell className="text-slate-600">{CARD_STATUS_LABELS[c.cardStatus]}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(c)}>Preview</Button>
                      {actions(c)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {cards.length === 0 && (
                <TableRow>
                  <TableCell colSpan={scope === "districts" ? 6 : 5} className="py-8 text-center text-slate-500">
                    No cards here. A card appears when a member reaches a membership milestone or becomes a Paul Harris
                    Fellow, or when a club reaches a target.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>{preview.memberName}: {preview.label}</DialogTitle>
                <DialogDescription>{CARD_STATUS_LABELS[preview.cardStatus]}. {preview.text}</DialogDescription>
              </DialogHeader>
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={`Spotlight card for ${preview.memberName}`} className="w-full rounded-lg border border-slate-200" />
              ) : (
                <Skeleton className="aspect-[1200/630] w-full" />
              )}
              {actions(preview)}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MilestoneSettings({ districtId }: { districtId: number }) {
  const [years, setYears] = useState("");
  const [message, setMessage] = useState("");
  const [governor, setGovernor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parsed = parseMilestoneYears(years);

  useEffect(() => {
    if (!(districtId > 0)) return;
    let live = true;
    getEngagementSettings(districtId)
      .then((s) => {
        if (!live) return;
        setYears(s.milestoneYears.join(", "));
        setMessage(s.governorMessage ?? "");
        setGovernor(s.governorName ?? null);
        setLoaded(true);
      })
      .catch((err) => live && setError(apiMessage(err, "Could not load the milestone settings.")));
    return () => {
      live = false;
    };
  }, [districtId]);

  const save = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await saveEngagementSettings(districtId, { milestoneYears: parsed, governorMessage: message.trim() || null });
      setYears(s.milestoneYears.join(", "));
      setSaved(true);
    } catch (err) {
      setError(apiMessage(err, "Could not save the milestone settings."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
      <header className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">Milestone messages</h2>
      </header>
      <div className="space-y-4 p-4">
        {!loaded && !error ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : loaded && (
          <>
            <label className="block max-w-md space-y-1 text-xs font-semibold text-slate-700">
              <span>Years of membership to congratulate</span>
              <Input value={years} placeholder="1, 3, 5, 10" aria-invalid={parsed === null} onChange={(e) => { setYears(e.target.value); setSaved(false); }} />
              <span className="block font-normal text-slate-500">
                On each of these anniversaries of their join date, members get one email and one notice in the app. Leave
                it empty to send none.
              </span>
              {parsed === null && <span className="block font-normal text-red-700">Enter whole numbers from 1 to 100, at most 10 of them.</span>}
            </label>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Governor message (optional)</span>
              <Textarea rows={4} maxLength={2000} value={message} onChange={(e) => { setMessage(e.target.value); setSaved(false); }} />
              <span className="block font-normal text-slate-500">
                Sent instead of the standard text and signed by {governor ?? "the District Governor of the current Rotary year"}. You
                can use {"{name}"}, {"{years}"}, {"{club}"} and {"{foundation_link}"} (the district&apos;s Foundation giving
                link, set in Email Settings).
              </span>
            </label>
            <div className="flex items-center gap-3">
              <Button type="button" onClick={save} disabled={busy || parsed === null}>Save</Button>
              {saved && <span className="text-sm text-slate-600" role="status">Saved.</span>}
            </div>
          </>
        )}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </section>
  );
}
