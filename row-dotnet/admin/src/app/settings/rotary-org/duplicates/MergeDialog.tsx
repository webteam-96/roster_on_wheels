"use client";

import { useEffect, useMemo, useState } from "react";
import DateField from "@/components/DateField";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, ArrowLeft, X, Plus, ShieldCheck, Users } from "lucide-react";
import {
  getDuplicatePair, resolveDuplicate, dismissDuplicate,
  getDuplicateDistricts, getDuplicateClubs,
  type DupPair, type DupProfile, type DupClub, type DupRole, type DupFamily,
} from "@/services/api";

type Side = "A" | "B";

// Editable profile fields (key must match backend UpdatableColumns camelCase).
const FIELDS: { key: keyof DupProfile; label: string; type?: "date"; readOnly?: boolean }[] = [
  { key: "rotaryId", label: "Rotary ID", readOnly: true }, // shift-only (can't be typed) — swaps between the two real RIDs
  { key: "memberName", label: "Name" },
  { key: "primaryMobileNumber", label: "Primary Mobile" },
  { key: "secondaryMobileNumber", label: "Secondary Mobile" },
  { key: "emailId", label: "Primary Email" },
  { key: "secondaryEmailId", label: "Secondary Email" },
  { key: "birthDate", label: "Birth Date", type: "date" },
  { key: "anniversaryDate", label: "Anniversary", type: "date" },
  { key: "bloodGroup", label: "Blood Group" },
  { key: "gender", label: "Gender" },
  { key: "primaryLanguage", label: "Language" },
  { key: "donorRecognition", label: "Donor Recognition" },
  { key: "memberIntroduction", label: "Introduction" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "linkedIn", label: "LinkedIn" },
  { key: "twitter", label: "Twitter" },
  { key: "youtube", label: "Youtube" },
  { key: "website", label: "Website" },
];

interface ClubRow { fkClubId: number; clubName: string; districtNumber: string | null; isHonorary: boolean; removed: boolean; joinedDate: string | null; }

const dateVal = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");
// Short human date (DD Mon YYYY) for the club joining date / family DOB display.
const fmtDate = (v: string | null | undefined) => {
  const s = dateVal(v);
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getFullYear() < 1901) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const toForm = (p: DupProfile): Record<string, string> => {
  const f: Record<string, string> = {};
  for (const fld of FIELDS) {
    const raw = p[fld.key] as unknown;
    f[fld.key as string] = fld.type === "date" ? dateVal(raw as string) : (raw == null ? "" : String(raw));
  }
  return f;
};
const toClubRows = (clubs: DupClub[]): ClubRow[] =>
  clubs.map((c) => ({ fkClubId: c.fkClubId, clubName: c.clubName || `Club #${c.fkClubId}`, districtNumber: c.districtNumber, isHonorary: !!c.isHonorary, removed: false, joinedDate: c.joinedDate }));

const ROLE_COLORS: Record<string, string> = {
  System: "border-slate-200 bg-slate-50 text-slate-700",
  BOD: "border-amber-200 bg-amber-50 text-amber-700",
  DC: "border-emerald-200 bg-emerald-50 text-emerald-700",
  GDC: "border-teal-200 bg-teal-50 text-teal-700",
  SGDC: "border-cyan-200 bg-cyan-50 text-cyan-700",
  DG: "border-rose-200 bg-rose-50 text-rose-700",
};

// Module-level so they keep a stable identity across the parent's keystroke re-renders (no remount).
// onShift (with shiftDir) adds an arrow that moves a club to the OTHER member's column.
function ClubList({ rows, setRows, title, onShift, shiftDir }: {
  rows: ClubRow[]; setRows: (u: (r: ClubRow[]) => ClubRow[]) => void; title: string;
  onShift?: (index: number) => void; shiftDir?: "left" | "right";
}) {
  return (
    <div>
      {title && <div className="text-xs font-semibold text-muted-foreground mb-1">{title}</div>}
      {rows.length === 0 && <div className="text-xs text-muted-foreground italic">No clubs</div>}
      <div className="space-y-1">
        {rows.map((c, i) => (
          <div key={c.fkClubId} className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${c.removed ? "opacity-40 line-through" : "bg-white"}`}>
            {onShift && shiftDir === "left" && (
              <button type="button" title="Move to Member A" className="text-slate-400 hover:text-blue-600 shrink-0" onClick={() => onShift(i)}>
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="flex-1 truncate">{c.clubName}{c.districtNumber ? ` · ${c.districtNumber}` : ""}</span>
            <label className="flex items-center gap-1 shrink-0" title="Joining date (edit to correct)">
              <span className="text-muted-foreground">Joined</span>
              <DateField value={dateVal(c.joinedDate)} disabled={c.removed} onChange={(v: string) => setRows((r) => r.map((x, j) => j === i ? { ...x, joinedDate: v || null } : x))} className="h-6 rounded border px-1 text-[11px]" />
            </label>
            <label className="flex items-center gap-1 shrink-0" title="Honorary member">
              <input type="checkbox" checked={c.isHonorary} disabled={c.removed}
                onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, isHonorary: e.target.checked } : x))} />
              Hon.
            </label>
            <button type="button" className="text-rose-500 hover:text-rose-700 shrink-0"
              onClick={() => setRows((r) => r.map((x, j) => j === i ? { ...x, removed: !x.removed } : x))}>
              {c.removed ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            </button>
            {onShift && shiftDir === "right" && (
              <button type="button" title="Move to Member B" className="text-slate-400 hover:text-blue-600 shrink-0" onClick={() => onShift(i)}>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleChips({ roles, onShift, shiftDir }: {
  roles: DupRole[]; onShift?: (index: number) => void; shiftDir?: "left" | "right";
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.length === 0 && <span className="text-xs text-muted-foreground italic">No roles</span>}
      {roles.map((r, i) => (
        <Badge key={i} variant="outline" className={`gap-1 ${ROLE_COLORS[r.source] || "border-slate-200"}`}>
          {onShift && shiftDir === "left" && (
            <button type="button" title="Move to Member A" className="hover:text-blue-600" onClick={() => onShift(i)}><ArrowLeft className="h-3 w-3" /></button>
          )}
          <span className="font-semibold">{r.source}</span>
          <span className="opacity-80">{r.label || "—"}{r.context ? ` · ${r.context}` : ""}{r.year ? ` · ${r.year}` : ""}</span>
          {onShift && shiftDir === "right" && (
            <button type="button" title="Move to Member B" className="hover:text-blue-600" onClick={() => onShift(i)}><ArrowRight className="h-3 w-3" /></button>
          )}
        </Badge>
      ))}
    </div>
  );
}

// Family list with the same shift arrows as clubs/roles. On merge the loser's family transfers
// to the survivor, so the shift is for consolidating the picture onto the kept record.
function FamilyList({ family, onShift, shiftDir }: {
  family: DupFamily[]; onShift?: (index: number) => void; shiftDir?: "left" | "right";
}) {
  return (
    <div className="space-y-1">
      {family.length === 0 && <span className="text-xs text-muted-foreground italic">No family members</span>}
      {family.map((f, i) => (
        <div key={i} className="flex items-center gap-2 rounded border bg-white px-2 py-1 text-xs">
          {onShift && shiftDir === "left" && (
            <button type="button" title="Move to Member A" className="text-slate-400 hover:text-blue-600 shrink-0" onClick={() => onShift(i)}><ArrowLeft className="h-3.5 w-3.5" /></button>
          )}
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium">{f.name || "—"}{f.relation ? <span className="text-muted-foreground font-normal"> · {f.relation}</span> : null}</div>
            <div className="truncate text-muted-foreground">
              {[f.phoneNumber, fmtDate(f.birthDate) ? `DOB ${fmtDate(f.birthDate)}` : ""].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          {onShift && shiftDir === "right" && (
            <button type="button" title="Move to Member B" className="text-slate-400 hover:text-blue-600 shrink-0" onClick={() => onShift(i)}><ArrowRight className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function MergeDialog({ pair, onClose, onResolved }: { pair: DupPair; onClose: () => void; onResolved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profA, setProfA] = useState<DupProfile | null>(null);
  const [profB, setProfB] = useState<DupProfile | null>(null);
  const [formA, setFormA] = useState<Record<string, string>>({});
  const [formB, setFormB] = useState<Record<string, string>>({});
  const [clubsA, setClubsA] = useState<ClubRow[]>([]);
  const [clubsB, setClubsB] = useState<ClubRow[]>([]);
  const [added, setAdded] = useState<ClubRow[]>([]);
  const [rolesA, setRolesA] = useState<DupRole[]>([]);
  const [rolesB, setRolesB] = useState<DupRole[]>([]);
  const [familyA, setFamilyA] = useState<DupFamily[]>([]);
  const [familyB, setFamilyB] = useState<DupFamily[]>([]);
  const [keepSide, setKeepSide] = useState<Side | null>(null); // no default — SA must explicitly pick which to keep

  // add-club picker
  const [districts, setDistricts] = useState<{ id: number; districtNumber: string }[]>([]);
  const [pickDistrict, setPickDistrict] = useState<number | "">("");
  const [pickClubs, setPickClubs] = useState<{ id: number; clubName: string }[]>([]);
  const [pickClub, setPickClub] = useState<number | "">("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const d = await getDuplicatePair(pair.memberAId, pair.memberBId);
        setProfA(d.memberA); setProfB(d.memberB);
        setFormA(toForm(d.memberA)); setFormB(toForm(d.memberB));
        setClubsA(toClubRows(d.clubsA)); setClubsB(toClubRows(d.clubsB));
        setRolesA(d.rolesA); setRolesB(d.rolesB);
        setFamilyA(d.familyA); setFamilyB(d.familyB);
      } catch {
        setError("Failed to load member details.");
      } finally {
        setLoading(false);
      }
    })();
    getDuplicateDistricts().then(setDistricts).catch(() => {});
  }, [pair.memberAId, pair.memberBId]);

  const onPickDistrict = async (id: number | "") => {
    setPickDistrict(id); setPickClub(""); setPickClubs([]);
    if (id) { try { setPickClubs(await getDuplicateClubs(Number(id))); } catch { /* ignore */ } }
  };

  const shift = (from: Side, key: string) => {
    if (from === "A") setFormB((f) => ({ ...f, [key]: formA[key] ?? "" }));
    else setFormA((f) => ({ ...f, [key]: formB[key] ?? "" }));
  };

  // Move a club to the other member's column (for a true same-person merge). Deduped so a club
  // already present on the target isn't duplicated; the survivor gets the union of both columns anyway.
  const shiftClub = (from: Side, index: number) => {
    const src = from === "A" ? clubsA : clubsB;
    const item = src[index];
    if (!item) return;
    (from === "A" ? setClubsA : setClubsB)((r) => r.filter((_, j) => j !== index));
    (from === "A" ? setClubsB : setClubsA)((r) => (r.some((x) => x.fkClubId === item.fkClubId) ? r : [...r, { ...item, removed: false }]));
  };

  // Move a role chip to the other member's column. On merge every role transfers to the survivor,
  // so this is for the SA to consolidate the picture onto the kept record.
  const shiftRole = (from: Side, index: number) => {
    const src = from === "A" ? rolesA : rolesB;
    const item = src[index];
    if (!item) return;
    (from === "A" ? setRolesA : setRolesB)((r) => r.filter((_, j) => j !== index));
    (from === "A" ? setRolesB : setRolesA)((r) => [...r, item]);
  };

  // Move a family member to the other column. On merge every family row transfers to the
  // survivor, so this is the SA consolidating the picture onto the kept record.
  const shiftFamily = (from: Side, index: number) => {
    const src = from === "A" ? familyA : familyB;
    const item = src[index];
    if (!item) return;
    (from === "A" ? setFamilyA : setFamilyB)((r) => r.filter((_, j) => j !== index));
    (from === "A" ? setFamilyB : setFamilyA)((r) => [...r, item]);
  };

  const addClub = () => {
    if (!pickClub) return;
    const c = pickClubs.find((x) => x.id === Number(pickClub));
    if (!c) return;
    if (added.some((a) => a.fkClubId === c.id) || clubsA.some((a) => a.fkClubId === c.id && !a.removed) || clubsB.some((a) => a.fkClubId === c.id && !a.removed)) {
      setPickClub(""); return; // already present
    }
    const dnum = districts.find((d) => d.id === Number(pickDistrict))?.districtNumber ?? null;
    setAdded((a) => [...a, { fkClubId: c.id, clubName: c.clubName, districtNumber: dnum, isHonorary: false, removed: false, joinedDate: null }]);
    setPickClub("");
  };

  // Final survivor club set = every non-removed club across both members + added, deduped (honorary if any says so).
  const survivorClubs = useMemo(() => {
    const map = new Map<number, { isHonorary: boolean; joinedDate: string | null }>();
    for (const c of [...clubsA, ...clubsB, ...added]) {
      if (c.removed) continue;
      const prev = map.get(c.fkClubId);
      map.set(c.fkClubId, {
        isHonorary: (prev?.isHonorary || false) || c.isHonorary,
        joinedDate: dateVal(c.joinedDate) || prev?.joinedDate || null, // prefer a set date
      });
    }
    return Array.from(map.entries()).map(([fkClubId, v]) => ({ fkClubId, isHonorary: v.isHonorary, joinedDate: v.joinedDate }));
  }, [clubsA, clubsB, added]);

  const doResolve = async () => {
    if (!profA || !profB) return;
    // Validation: a "keep" record MUST be explicitly selected before merging.
    if (keepSide === null) {
      setError("Please select which record to KEEP (choose a radio at the top) before saving.");
      return;
    }
    const keepProf = keepSide === "A" ? profA : profB;
    const delProf = keepSide === "A" ? profB : profA;
    // HIGH-ALERT confirmation — merge permanently soft-deletes one member.
    const confirmed = window.confirm(
      `⚠️ HIGH ALERT — MERGE & DELETE\n\n` +
      `KEEP:   ${keepProf.memberName || "—"} (RID ${keepProf.rotaryId || "—"})\n` +
      `DELETE: ${delProf.memberName || "—"} (RID ${delProf.rotaryId || "—"})\n\n` +
      `The DELETE member will be removed and its clubs, roles & family moved to the KEEP member. ` +
      `This can be undone later from "Merged (Undo)", but please confirm.\n\nProceed with the merge?`
    );
    if (!confirmed) return;
    setSaving(true); setError(null);
    try {
      const keepId = keepSide === "A" ? profA.id : profB.id;
      const deleteId = keepSide === "A" ? profB.id : profA.id;
      const survivor = keepSide === "A" ? formA : formB;
      await resolveDuplicate({ keepId, deleteId, survivor, clubs: survivorClubs });
      onResolved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string; detail?: string } } })?.response?.data;
      setError(msg?.detail || msg?.message || "Merge failed.");
    } finally {
      setSaving(false);
    }
  };

  const doDismiss = async () => {
    // Validation: keeping both as separate members requires EACH to have its own primary mobile.
    const aMob = (formA.primaryMobileNumber ?? "").trim();
    const bMob = (formB.primaryMobileNumber ?? "").trim();
    if (!aMob || !bMob) {
      const who = !aMob && !bMob ? "both records" : `"${(!aMob ? profA?.memberName : profB?.memberName) || "one record"}"`;
      setError(`Primary mobile number is required for ${who} before keeping both. Please fill in the missing primary mobile.`);
      return;
    }
    // Confirmation — Save & Keep Both writes each member's edits and keeps both records.
    const confirmed = window.confirm(
      `Save & Keep BOTH records as separate members?\n\n` +
      `Any fields you edited are saved to each member's own record. Nothing is deleted or merged.\n\nProceed?`
    );
    if (!confirmed) return;
    setSaving(true); setError(null);
    try {
      // Keep BOTH records, but persist each member's OWN edits to its own row — never merged.
      // Only the fields the SA actually changed (vs the loaded values) are sent; rotaryId is never
      // sent (each member keeps its own Rotary ID).
      const changed = (form: Record<string, string>, prof: DupProfile | null): Record<string, string> | undefined => {
        if (!prof) return undefined;
        const init = toForm(prof);
        const out: Record<string, string> = {};
        for (const k of Object.keys(form)) {
          if (k === "rotaryId") continue;
          if (String(form[k] ?? "") !== String(init[k] ?? "")) out[k] = form[k];
        }
        return Object.keys(out).length > 0 ? out : undefined;
      };
      await dismissDuplicate(
        profA?.id ?? pair.memberAId,
        profB?.id ?? pair.memberBId,
        "shared-contact",
        undefined,
        changed(formA, profA),
        changed(formB, profB),
      );
      onResolved();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { message?: string; detail?: string } } })?.response?.data;
      setError(d?.detail || d?.message || "Could not save & keep both.");
    } finally {
      setSaving(false);
    }
  };

  // Clubs + add-club, rendered ABOVE the field comparison (above the Name field).
  const clubsSection = (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Users className="h-4 w-4" /> Member A — Clubs</div>
          <ClubList rows={clubsA} setRows={setClubsA} title="" onShift={(i) => shiftClub("A", i)} shiftDir="right" />
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Users className="h-4 w-4" /> Member B — Clubs</div>
          <ClubList rows={clubsB} setRows={setClubsB} title="" onShift={(i) => shiftClub("B", i)} shiftDir="left" />
        </div>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-sm font-semibold text-slate-700">Add a club to the surviving member</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-9 rounded-md border px-2 text-sm" value={pickDistrict}
            onChange={(e) => onPickDistrict(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select district…</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.districtNumber}</option>)}
          </select>
          <select className="h-9 rounded-md border px-2 text-sm min-w-[220px]" value={pickClub} disabled={!pickDistrict}
            onChange={(e) => setPickClub(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select club…</option>
            {pickClubs.map((c) => <option key={c.id} value={c.id}>{c.clubName}</option>)}
          </select>
          <Button type="button" size="sm" variant="outline" onClick={addClub} disabled={!pickClub}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        {added.length > 0 && <ClubList rows={added} setRows={setAdded} title="Added clubs" />}
      </div>
    </>
  );

  const header = (prof: DupProfile | null, side: Side) => (
    <label className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 cursor-pointer ${keepSide === side ? "border-green-500 bg-green-50" : "border-slate-200"}`}>
      <input type="radio" name="keep" checked={keepSide === side} onChange={() => setKeepSide(side)} />
      <div className="min-w-0">
        <div className="font-semibold text-slate-800 truncate">{prof?.memberName || "—"} <span className="text-xs font-normal text-muted-foreground">RID {prof?.rotaryId || "—"}</span></div>
        <div className="text-xs font-medium">{keepSide === null ? <span className="text-slate-500">Select to keep</span> : keepSide === side ? <span className="text-green-700">✓ KEEP this record</span> : <span className="text-rose-600">Will be deleted</span>}</div>
      </div>
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare &amp; Merge Duplicate</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            {/* Keep / delete selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {header(profA, "A")}
              {header(profB, "B")}
            </div>

            {/* Clubs — moved above the Name / field comparison */}
            {clubsSection}

            {/* Field comparison with shift buttons */}
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-slate-50 px-3 py-2 text-xs font-semibold text-muted-foreground">
                <div>Member A</div><div className="text-center">Copy</div><div>Member B</div>
              </div>
              <div className="divide-y">
                {FIELDS.map((f) => {
                  const k = f.key as string;
                  const same = (formA[k] || "") === (formB[k] || "");
                  return (
                    <div key={k} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1.5">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
                        <Input value={formA[k] || ""} type={f.type === "date" ? "date" : "text"} readOnly={f.readOnly}
                          onChange={(e) => setFormA((v) => ({ ...v, [k]: e.target.value }))}
                          className={`h-8 text-sm ${f.readOnly ? "bg-slate-50" : ""} ${!same ? "border-amber-300" : ""}`} />
                      </div>
                      <div className="flex flex-col gap-1 pt-3">
                        <button type="button" title="Copy A → B" onClick={() => shift("A", k)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowRight className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Copy B → A" onClick={() => shift("B", k)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /></button>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
                        <Input value={formB[k] || ""} type={f.type === "date" ? "date" : "text"} readOnly={f.readOnly}
                          onChange={(e) => setFormB((v) => ({ ...v, [k]: e.target.value }))}
                          className={`h-8 text-sm ${f.readOnly ? "bg-slate-50" : ""} ${!same ? "border-amber-300" : ""}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Roles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-700">Member A — Roles</div>
                <RoleChips roles={rolesA} onShift={(i) => shiftRole("A", i)} shiftDir="right" />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-700">Member B — Roles</div>
                <RoleChips roles={rolesB} onShift={(i) => shiftRole("B", i)} shiftDir="left" />
              </div>
            </div>

            {/* Family */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-700">Member A — Family</div>
                <FamilyList family={familyA} onShift={(i) => shiftFamily("A", i)} shiftDir="right" />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-semibold text-slate-700">Member B — Family</div>
                <FamilyList family={familyB} onShift={(i) => shiftFamily("B", i)} shiftDir="left" />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              On merge, the deleted member is soft-deleted; its mobile/email move to the surviving member&apos;s secondary, and all
              its clubs, roles &amp; family above transfer to the survivor. A before-state backup is saved. Use <b>Save &amp; Keep Both</b> for a
              legitimate shared contact (e.g. husband &amp; wife) — the two records are kept separate, any fields you edited are saved to each
              member&apos;s own record (never mixed), and the pair stops showing.
            </p>

            {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="outline" onClick={doDismiss} disabled={saving} className="border-slate-300">
                <Users className="h-4 w-4 mr-1" /> Save &amp; Keep Both
              </Button>
              <Button onClick={doResolve} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
