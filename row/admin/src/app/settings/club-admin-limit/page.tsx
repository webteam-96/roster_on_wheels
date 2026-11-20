"use client";

// Settings > Club admin limit (owner decision 2026-11-19): the most active Club Admins one club may have (default 3),
// and the clubs that already hold more. Those clubs are left as they are for the owner to decide; they only cannot
// add another admin until they are under the limit. SuperAdmins and district roles are not counted.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import {
  getClubAdminLimit, setClubAdminLimit, getClubAdminLimitReport,
  type ClubAdminLimitSetting, type ClubOverAdminLimit,
} from "@/services/api";

type ApiError = { response?: { data?: { message?: string } } };
const messageOf = (e: unknown, fallback: string) => (e as ApiError)?.response?.data?.message || fallback;

export default function ClubAdminLimitPage() {
  const { isSuperAdmin } = useAuth();
  const [setting, setSetting] = useState<ClubAdminLimitSetting | null>(null);
  const [draft, setDraft] = useState("");
  const [clubs, setClubs] = useState<ClubOverAdminLimit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setClubs(null);
    getClubAdminLimit()
      .then((s) => { setSetting(s); setDraft(String(s.max)); })
      .catch((e) => setError(messageOf(e, "Could not load the limit.")));
    getClubAdminLimitReport()
      .then((r) => setClubs(r.clubs))
      .catch((e) => { setError(messageOf(e, "Could not load the report.")); setClubs([]); });
  }, []);
  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  const save = async () => {
    const max = Number(draft);
    if (!Number.isInteger(max) || max < 1 || max > 50) { setError("Enter a whole number from 1 to 50."); return; }
    setBusy(true);
    setSaved(false);
    try { await setClubAdminLimit(max); setSaved(true); load(); }
    catch (e) { setError(messageOf(e, "Could not save the limit.")); }
    finally { setBusy(false); }
  };

  if (!isSuperAdmin) {
    return <ProtectedRoute><p className="py-20 text-center">Only Super Admin can manage the club admin limit.</p></ProtectedRoute>;
  }
  return (
    <ProtectedRoute>
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild aria-label="Back to settings"><Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Club admin limit</h2>
            <p className="text-base text-muted-foreground">
              The most active Club Admins one club may have. Super Admins and district roles are not counted.
              A grant past the limit is refused on every screen, the Rotary.org sync and executive sign-in.
            </p>
          </div>
        </div>

        <section aria-labelledby="limit-heading" className="space-y-3 rounded-lg border p-4">
          <h3 id="limit-heading" className="text-lg font-semibold">Limit per club</h3>
          {setting === null ? <TableSkeleton rows={1} /> : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input aria-label="Most Club Admins per club" type="number" min={1} max={50} className="sm:w-32"
                value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} />
              <Button disabled={busy || draft === String(setting.max)} onClick={save}>Save limit</Button>
              <span className="text-sm text-muted-foreground">
                {saved ? "Saved." : setting.isDefault ? `Default (${setting.defaultMax}).` : `Default is ${setting.defaultMax}.`}
              </span>
            </div>
          )}
        </section>

        <section aria-labelledby="report-heading" className="space-y-3">
          <div>
            <h3 id="report-heading" className="text-lg font-semibold">Clubs over the limit</h3>
            <p className="text-sm text-muted-foreground">
              Nothing has been changed for these clubs. They keep their admins, and cannot add another until they are under the limit.
            </p>
          </div>
          {clubs === null ? <TableSkeleton rows={4} /> : clubs.length === 0 ? (
            <p className="text-muted-foreground">No club has more Club Admins than the limit.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="p-3">Club</th>
                    <th scope="col" className="p-3">District</th>
                    <th scope="col" className="p-3 text-right">Admins</th>
                    <th scope="col" className="p-3">Names</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clubs.map((c) => (
                    <tr key={c.clubId}>
                      <td className="p-3 font-medium">{c.clubName}</td>
                      <td className="p-3">{c.districtNumber ?? ""}</td>
                      <td className="p-3 text-right tabular-nums">{c.adminCount}</td>
                      <td className="p-3">{c.admins.map((a) => a.name).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
