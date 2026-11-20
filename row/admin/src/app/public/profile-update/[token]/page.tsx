"use client";

/**
 * Public profile check, no sign-in: /public/profile-update/{token} is the personal link a club emails when it asks a
 * member to update their profile (ProfileUpdateService). The member corrects their details or confirms nothing has
 * changed; either answers the request. Login details (main mobile and email) are shown but not editable here.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "@/components/icons";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getPublicProfileUpdate, savePublicProfileUpdate, type PublicProfileUpdate, type PublicProfileUpdateBody } from "@/services/api";

type FieldKey = keyof Omit<PublicProfileUpdateBody, "confirmOnly">;
type Form = Record<FieldKey, string>;

const FIELDS: { key: FieldKey; label: string; type?: string; max: number; long?: boolean }[] = [
  { key: "secondaryEmailId", label: "Other email", type: "email", max: 150 },
  { key: "secondaryMobileNumber", label: "Other mobile", type: "tel", max: 20 },
  { key: "birthDate", label: "Birth date", type: "date", max: 10 },
  { key: "anniversaryDate", label: "Wedding anniversary", type: "date", max: 10 },
  { key: "classificationProfession", label: "Classification (profession)", max: 200 },
  { key: "linkedIn", label: "LinkedIn profile", type: "url", max: 300 },
  { key: "website", label: "Website", type: "url", max: 300 },
  { key: "memberIntroduction", label: "About me", max: 2000, long: true },
];

function toForm(d: PublicProfileUpdate): Form {
  const f = {} as Form;
  for (const { key } of FIELDS) f[key] = d[key] ?? "";
  return f;
}

export default function PublicProfileUpdatePage() {
  const token = String(useParams().token);
  const [data, setData] = useState<PublicProfileUpdate | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getPublicProfileUpdate(token)
      .then((d) => {
        setData(d);
        setForm(toForm(d));
      })
      .catch(() => setMissing(true));
  }, [token]);

  const save = async (confirmOnly: boolean) => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      // An emptied field is sent as null (clears it); the API cannot read "" as a date.
      const body: PublicProfileUpdateBody = confirmOnly
        ? { confirmOnly: true }
        : Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
      setDone((await savePublicProfileUpdate(token, body)).message);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } } };
      setError(e?.response?.status === 429
        ? "Too many attempts from this connection. Please try again in a few minutes."
        : e?.response?.data?.message || "Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      {missing ? (
        <Card><CardContent className="p-6 text-sm">This link has expired or is not valid. Please ask your club for a new one.</CardContent></Card>
      ) : !data || !form ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <header className="space-y-1">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{data.clubName}</p>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Check your member profile</h1>
            <p className="pt-2 text-base text-muted-foreground">
              {data.memberName}, please correct anything that has changed, then save. If everything is right, tell us so.
            </p>
            {data.alreadyUpdated && !done && <p className="text-sm text-muted-foreground">You have already answered. You can still make changes.</p>}
          </header>

          {done ? (
            <Card><CardContent className="p-6 text-base" role="status">{done}</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(false); }}>
                  <dl className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Login email</dt><dd>{data.email || "Not set"}</dd></div>
                    <div><dt className="text-muted-foreground">Login mobile</dt><dd>{data.mobile || "Not set"}</dd></div>
                    <p className="text-xs text-muted-foreground sm:col-span-2">To change these, use the app or ask your club.</p>
                  </dl>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {FIELDS.map((f) => (
                      <div key={f.key} className={`space-y-1.5 ${f.long ? "sm:col-span-2" : ""}`}>
                        <Label htmlFor={`pu-${f.key}`}>{f.label}</Label>
                        {f.long ? (
                          <Textarea id={`pu-${f.key}`} rows={4} maxLength={f.max} value={form[f.key]}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                        ) : (
                          <Input id={`pu-${f.key}`} type={f.type ?? "text"} maxLength={f.max} value={form[f.key]}
                            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                        )}
                      </div>
                    ))}
                  </div>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy} className="gap-1.5">
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save my profile
                    </Button>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => save(true)}>
                      Everything is correct
                    </Button>
                  </div>
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
