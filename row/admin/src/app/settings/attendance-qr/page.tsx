"use client";

/**
 * Settings > QR Attendance (SuperAdmin). Marker: QR-ATTENDANCE
 *
 * Roll the mobile QR attendance feature out safely: switch it on for a few test
 * clubs first, then switch "All clubs" on. A club has the feature when "All clubs"
 * is ON, or when it is switched on in the list below. Nothing is on until set here.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SearchableCombo from "@/components/SearchableCombo";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Plus, Trash2, AlertTriangle } from "@/components/icons";
import {
  getAttendanceQrSettings, setAttendanceQrAll, setAttendanceQrClub, removeAttendanceQrClub,
  getDistricts, getClubs, AttendanceQrSettings, AttendanceQrClub,
} from "@/services/api";

type DistrictOption = { id: number; districtNumber: string };
type ClubOption = { id: number; clubName: string };
type Pending = { title: string; description: string; action: () => Promise<{ message: string }> };

// Server sends UTC ISO; shown in the viewer's own time zone.
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–";

const clubLabel = (r: AttendanceQrClub) => r.clubName ?? `Club ${r.clubId}`;

const StateBadge = ({ on }: { on: boolean }) => (
  <Badge className={on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>{on ? "ON" : "OFF"}</Badge>
);

export default function AttendanceQrSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<AttendanceQrSettings | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const [districtOptions, setDistrictOptions] = useState<DistrictOption[]>([]);
  const [clubOptions, setClubOptions] = useState<ClubOption[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(false);
  const [districtId, setDistrictId] = useState("");
  const [clubId, setClubId] = useState("");

  const load = async () => {
    try {
      setSettings(await getAttendanceQrSettings());
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load QR Attendance settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getDistricts(1, 1000)
      .then((r) => setDistrictOptions(
        (r.items ?? []).map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }))
          .sort((a: DistrictOption, b: DistrictOption) => a.districtNumber.localeCompare(b.districtNumber))))
      .catch(() => setError("Failed to load the district list"));
  }, []);

  useEffect(() => {
    setClubId("");
    if (!districtId) { setClubOptions([]); return; }
    setLoadingClubs(true);
    getClubs(1, 1000, undefined, Number(districtId))
      .then((r) => setClubOptions(
        (r.items ?? []).map((c: any) => ({ id: c.id, clubName: c.clubName }))
          .sort((a: ClubOption, b: ClubOption) => a.clubName.localeCompare(b.clubName))))
      .catch(() => setError("Failed to load clubs for that district"))
      .finally(() => setLoadingClubs(false));
  }, [districtId]);

  const addableClubs = useMemo(() => {
    const taken = new Set((settings?.clubs ?? []).map((c) => c.clubId));
    return clubOptions.filter((c) => !taken.has(c.id));
  }, [clubOptions, settings]);

  const run = async (fn: () => Promise<{ message: string }>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fn();
      setSuccess(res.message);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleAll = (on: boolean) => setPending({
    title: on ? "Switch on for all clubs" : "Switch off for all clubs",
    description: on
      ? "Every club admin will see Scan Attendance and every member will see My Attendance QR in the mobile app."
      : "Only the clubs switched on in the list will keep QR Attendance.",
    action: () => setAttendanceQrAll(on),
  });

  const addClub = () => {
    const c = clubOptions.find((x) => String(x.id) === clubId);
    if (!c) return;
    run(async () => {
      const res = await setAttendanceQrClub(c.id, true);
      setClubId("");
      return res;
    });
  };

  const removeClub = (r: AttendanceQrClub) => setPending({
    title: "Remove club",
    description: `Remove ${clubLabel(r)} from the list? It loses QR Attendance unless All clubs is on.`,
    action: () => removeAttendanceQrClub(r.clubId),
  });

  const allOn = settings?.allClubs ?? false;
  const clubs = settings?.clubs ?? [];

  return (
    <ProtectedRoute requireSuperAdmin>
      <div className="space-y-6">
        <PageHeader
          back="/settings"
          title="QR Attendance"
          description="Mobile app only. Members show a live QR and club admins scan it to mark attendance. Switch it on for a few test clubs first, then for all clubs. A club that is off does not see the feature in the app."
        />

        <SuccessAlert open={!!success} title="Saved" description={success ?? ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Something went wrong" description={error ?? ""} onOk={() => setError(null)} />
        <AlertModal open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }} icon={AlertTriangle} iconClassName="text-amber-600"
          title={pending?.title ?? ""} description={pending?.description ?? ""} confirmLabel="Confirm" cancelLabel="Cancel"
          onConfirm={() => { const p = pending; setPending(null); if (p) run(p.action); }} />

        {loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <>
        <Panel
          title="All clubs"
          headerRight={
            <div className="flex shrink-0 items-center gap-3">
              <StateBadge on={allOn} />
              <Switch checked={allOn} disabled={saving} aria-label="QR Attendance for all clubs" onCheckedChange={toggleAll} />
            </div>
          }
        >
          <p className="max-w-[64ch] text-[15px] text-foreground">
            {allOn
              ? "Every club has QR Attendance. The test-club list below no longer matters."
              : "Only the clubs switched on below have QR Attendance."}
          </p>
          {settings?.allClubsModifiedDate && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Changed {when(settings.allClubsModifiedDate)}
              {settings.allClubsModifiedByName ? ` by ${settings.allClubsModifiedByName}` : ""}
            </p>
          )}
        </Panel>

        <Panel title="Test clubs" subtitle="Changes reach the app the next time the member opens the home screen or the attendance screen.">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 space-y-1.5 lg:w-[260px]">
                <Label>District</Label>
                <SearchableCombo
                  value={districtId}
                  onChange={setDistrictId}
                  options={districtOptions.map((d) => ({ value: String(d.id), label: `District ${d.districtNumber}` }))}
                  placeholder="Choose a district"
                  searchPlaceholder="District number"
                  emptyText="No district matches."
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 lg:max-w-[360px]">
                <Label>Club</Label>
                <SearchableCombo
                  value={clubId}
                  onChange={setClubId}
                  options={addableClubs.map((c) => ({ value: String(c.id), label: c.clubName }))}
                  placeholder={loadingClubs ? "Loading clubs" : districtId ? "Choose a club" : "Choose a district first"}
                  searchPlaceholder="Club name"
                  emptyText="No club matches."
                />
              </div>
              <Button disabled={!clubId || saving} onClick={addClub}>
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Switch on for this club
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Club</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>QR Attendance</TableHead>
                  <TableHead>Last changed</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Remove</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clubs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No test clubs yet. Choose a district and a club above.
                    </TableCell>
                  </TableRow>
                )}
                {clubs.map((r) => (
                  <TableRow key={r.clubId}>
                    <TableCell className="font-semibold">{clubLabel(r)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.districtNumber ?? "–"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={r.isEnabled}
                          disabled={saving}
                          aria-label={`QR Attendance for ${clubLabel(r)}`}
                          onCheckedChange={(v) => run(() => setAttendanceQrClub(r.clubId, v))}
                        />
                        <StateBadge on={r.isEnabled} />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {when(r.modifiedDate)}
                      {r.modifiedByName ? <div className="text-[13px]">by {r.modifiedByName}</div> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" disabled={saving} onClick={() => removeClub(r)} aria-label={`Remove ${clubLabel(r)}`}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
        </>
        )}
      </div>
    </ProtectedRoute>
  );
}
