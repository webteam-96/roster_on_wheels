"use client";

/**
 * Public volunteer sign-up, no login: /public/volunteer/{token} is the link a club shares for one sign-up sheet.
 * Name, email and consent. A hidden field catches bots, and the API limits sign-ups per connection and refuses a
 * form sent too fast. Flagged module "volunteers": the API answers 404 while it is off.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { getPublicVolunteerSheet, publicVolunteerSignup } from "@/services/api";
import type { PublicVolunteerSheet } from "@/types/volunteers";

export default function PublicVolunteerPage() {
  const token = String(useParams().token);
  const fmt = useFormat();
  const [sheet, setSheet] = useState<PublicVolunteerSheet | null>(null);
  const [missing, setMissing] = useState(false);
  const [slotId, setSlotId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getPublicVolunteerSheet(token).then(setSheet).catch(() => setMissing(true));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheet || !slotId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await publicVolunteerSignup(token, { slotId, name: name.trim(), email: email.trim(), consent, formToken: sheet.formToken, website });
      setDone(r.message);
    } catch (err: any) {
      setError(err?.response?.status === 429
        ? "Too many sign-ups from this connection. Please try again in a few minutes."
        : err?.response?.data?.message || "Could not sign you up. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      {missing ? (
        <Card><CardContent className="p-6 text-sm">This sign-up sheet is not open. Please ask the club for a current link.</CardContent></Card>
      ) : !sheet ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <header className="space-y-1">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{sheet.clubName}</p>
            <h1 className="text-3xl font-bold tracking-tight text-primary">{sheet.title}</h1>
            {sheet.eventTitle && <p className="text-base">For {sheet.eventTitle}</p>}
            {sheet.description && <p className="whitespace-pre-line pt-2 text-base text-muted-foreground">{sheet.description}</p>}
          </header>

          {done ? (
            <Card><CardContent className="p-6 text-base" role="status">{done}</CardContent></Card>
          ) : sheet.slots.length === 0 ? (
            <Card><CardContent className="p-6 text-sm">There are no slots left to sign up for.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <form className="space-y-5" onSubmit={submit}>
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-base font-semibold">Choose a slot</legend>
                    {sheet.slots.map((s) => (
                      <label key={s.id}
                        className={`flex items-start gap-3 rounded-md border p-3 text-sm ${s.spotsLeft > 0 ? "cursor-pointer" : "opacity-60"} ${slotId === s.id ? "border-primary" : ""}`}>
                        <input type="radio" name="slot" className="mt-1" value={s.id} disabled={s.spotsLeft <= 0}
                          checked={slotId === s.id} onChange={() => setSlotId(s.id)} />
                        <span>
                          <span className="block font-medium">{s.task}</span>
                          <span className="block text-muted-foreground">
                            {fmt.dateTime(s.startsAt)}{s.endsAt ? ` to ${fmt.time(s.endsAt)}` : ""}
                            {", "}{s.spotsLeft > 0 ? `${s.spotsLeft} ${s.spotsLeft === 1 ? "place" : "places"} left` : "full"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="vs-name">Your name</Label>
                      <Input id="vs-name" required minLength={2} maxLength={150} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vs-email">Your email</Label>
                      <Input id="vs-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                  </div>
                  {/* Bots fill every field; people never see this one. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                    <label htmlFor="vs-website">Website</label>
                    <input id="vs-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                    <span>
                      I agree that {sheet.clubName} keeps my name and email for this sign-up and emails me a reminder before
                      my slot. See the <Link href="/privacy-policy" className="text-primary underline">privacy policy</Link>.
                    </span>
                  </label>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  <Button type="submit" disabled={busy || !slotId || !consent} className="gap-1.5">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign me up
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <footer className="flex gap-4 text-xs text-muted-foreground">
        <Link href="/terms-and-conditions" className="hover:underline">Terms of service</Link>
        <Link href="/privacy-policy" className="hover:underline">Privacy policy</Link>
      </footer>
    </div>
  );
}
