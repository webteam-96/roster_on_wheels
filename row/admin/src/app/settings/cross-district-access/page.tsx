"use client";

// Settings > Cross-district access: a time-limited read (optionally write) grant on another district for PETS, RLI
// or zone work. The API decides who may grant (SuperAdmin, or a zone officer for districts in their zone) and
// enforces expiry on every request; this page lists, creates and revokes, and flags grants about to expire.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import { useFormat } from "@/hooks/useFormat";
import {
  createDistrictAccessGrant, getDistrictAccessDistricts, getDistrictAccessGrants, revokeDistrictAccessGrant,
  searchDistrictAccessMembers, type DistrictAccessGrant, type DistrictAccessList, type DistrictAccessMember,
} from "@/services/api";

const PURPOSES: Record<string, string> = { PETS: "PETS", RLI: "RLI", ZONE: "Zone work", OTHER: "Other" };
const STATUS_LABEL: Record<DistrictAccessGrant["status"], string> = {
  active: "Active", scheduled: "Starts later", expiring: "Expiring soon", expired: "Expired", revoked: "Revoked",
};
const FILTERS = [["live", "Live"], ["expiring", "Expiring soon"], ["scheduled", "Starts later"], ["expired", "Expired"], ["revoked", "Revoked"], ["all", "All"]] as const;

/** A YYYY-MM-DD picked in the viewer's zone: start of that day, or end of it (start of the next) for an expiry. */
function dayToUtcIso(day: string, endOfDay: boolean): string {
  const d = new Date(`${day}T00:00:00`);
  if (endOfDay) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function errorText(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return msg || fallback;
}

export default function CrossDistrictAccessPage() {
  const fmt = useFormat();
  const [filter, setFilter] = useState<string>("live");
  const [list, setList] = useState<DistrictAccessList | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [districts, setDistricts] = useState<{ id: number; districtNumber: string }[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DistrictAccessMember[]>([]);
  const [member, setMember] = useState<DistrictAccessMember | null>(null);
  const [form, setForm] = useState({ districtId: "", purpose: "PETS", note: "", canWrite: false, start: "", expiry: "" });
  const [revoking, setRevoking] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    setList(null);
    getDistrictAccessGrants(filter).then(setList).catch((e) => {
      if (e?.response?.status === 403) setForbidden(true);
      else setError(errorText(e, "Could not load the grants."));
      setList({ items: [], counts: {}, expiringSoonDays: 7 });
    });
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getDistrictAccessDistricts().then(setDistricts).catch(() => setDistricts([])); }, []);

  useEffect(() => {
    if (member || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => { searchDistrictAccessMembers(q.trim()).then(setFound).catch(() => setFound([])); }, 300);
    return () => clearTimeout(t);
  }, [q, member]);

  const create = async () => {
    if (!member || !form.districtId || !form.start || !form.expiry) { setError("Choose a member, a district, a start and an expiry."); return; }
    setBusy(true);
    try {
      await createDistrictAccessGrant({
        memberId: member.id, districtId: Number(form.districtId), canWrite: form.canWrite, purpose: form.purpose,
        note: form.note.trim() || undefined, startsAtUtc: dayToUtcIso(form.start, false), expiresAtUtc: dayToUtcIso(form.expiry, true),
      });
      setMember(null); setQ(""); setForm({ districtId: "", purpose: "PETS", note: "", canWrite: false, start: "", expiry: "" });
      load();
    } catch (e) { setError(errorText(e, "Could not create the grant.")); } finally { setBusy(false); }
  };

  const revoke = async (id: number) => {
    setBusy(true);
    try { await revokeDistrictAccessGrant(id, reason.trim() || undefined); setRevoking(null); setReason(""); load(); }
    catch (e) { setError(errorText(e, "Could not revoke the grant.")); } finally { setBusy(false); }
  };

  if (forbidden) {
    return <ProtectedRoute><p className="py-20 text-center">Only a Super Admin or a zone officer can manage cross-district access.</p></ProtectedRoute>;
  }
  const expiring = list?.counts.expiring ?? 0;
  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to settings"><Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Cross-district access</h2>
            <p className="text-base text-muted-foreground">
              Let a member see another district for a set time, for PETS, RLI or zone work. Access ends by itself at the expiry. Every grant, use and revoke is in the audit log.
            </p>
          </div>
        </div>

        {expiring > 0 && (
          <p role="status" className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {expiring === 1 ? "1 grant expires" : `${expiring} grants expire`} within {list?.expiringSoonDays} days. Create a new grant if the work is not finished.
          </p>
        )}

        <section aria-labelledby="new-grant" className="space-y-4 rounded-lg border p-4">
          <h3 id="new-grant" className="text-lg font-semibold">New grant</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cda-member">Member</Label>
              {member ? (
                <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <span>{member.name}{member.clubName && `, ${member.clubName}`}{member.districtNumber && ` (District ${member.districtNumber})`}</span>
                  <Button variant="outline" size="sm" onClick={() => { setMember(null); setQ(""); }}>Change</Button>
                </div>
              ) : (
                <>
                  <Input id="cda-member" placeholder="Type a name or member id" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />
                  {found.length > 0 && (
                    <ul className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
                      {found.map((m) => (
                        <li key={m.id}>
                          <button type="button" className="w-full p-2 text-left hover:bg-muted" onClick={() => setMember(m)}>
                            {m.name}{m.clubName && `, ${m.clubName}`}{m.districtNumber && ` (District ${m.districtNumber})`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cda-district">District to open</Label>
              <Select value={form.districtId} onValueChange={(v) => setForm({ ...form, districtId: v })}>
                <SelectTrigger id="cda-district"><SelectValue placeholder="Choose a district" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => <SelectItem key={d.id} value={String(d.id)}>District {d.districtNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cda-purpose">Purpose</Label>
              <Select value={form.purpose} onValueChange={(v) => setForm({ ...form, purpose: v })}>
                <SelectTrigger id="cda-purpose"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PURPOSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cda-start">Starts</Label>
                <Input id="cda-start" type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cda-expiry">Expires after</Label>
                <Input id="cda-expiry" type="date" min={form.start || undefined} value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cda-note">Note {form.purpose === "OTHER" ? "(required)" : "(optional)"}</Label>
              <Textarea id="cda-note" maxLength={500} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="flex items-start gap-2 md:col-span-2">
              <Checkbox id="cda-write" checked={form.canWrite} onCheckedChange={(v) => setForm({ ...form, canWrite: v === true })} />
              <Label htmlFor="cda-write" className="font-normal leading-snug">
                Also allow changes to the district&apos;s announcements, events, committees, documents, newsletters, projects and weblinks. Never admins, roles, mass email, money or the website.
              </Label>
            </div>
          </div>
          <Button disabled={busy} onClick={create}>Grant access</Button>
        </section>

        <section aria-labelledby="grant-list" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="grant-list" className="text-lg font-semibold">Grants</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter grants">
              {FILTERS.map(([k, label]) => (
                <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}{k === "expiring" && expiring > 0 ? ` (${expiring})` : ""}
                </Button>
              ))}
            </div>
          </div>
          {list === null ? <TableSkeleton rows={4} /> : list.items.length === 0 ? (
            <p className="text-muted-foreground">No grants here.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {list.items.map((g) => (
                <li key={g.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><strong>{g.memberName ?? `Member ${g.memberId}`}</strong>: District {g.districtNumber ?? g.districtId}, {g.canWrite ? "read and change" : "read only"}</span>
                    <span className={`text-sm ${g.status === "expiring" ? "font-semibold text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>{STATUS_LABEL[g.status]}</span>
                  </div>
                  <p className="text-sm">
                    {PURPOSES[g.purpose] ?? g.purpose}{g.note && `: ${g.note}`}. {fmt.dateTime(g.startsAtUtc)} to {fmt.dateTime(g.expiresAtUtc)}.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Granted by {g.grantedByName ?? "unknown"} on {fmt.date(g.grantedAtUtc)}
                    {g.revokedAtUtc && `. Revoked by ${g.revokedByName ?? "unknown"} on ${fmt.date(g.revokedAtUtc)}${g.revokeReason ? `: ${g.revokeReason}` : ""}`}
                  </p>
                  {(g.status === "active" || g.status === "expiring" || g.status === "scheduled") && (
                    revoking === g.id ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input aria-label="Reason for revoking" maxLength={500} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button variant="destructive" disabled={busy} onClick={() => revoke(g.id)}>Revoke now</Button>
                        <Button variant="outline" onClick={() => { setRevoking(null); setReason(""); }}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => { setRevoking(g.id); setReason(""); }}>Revoke</Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
