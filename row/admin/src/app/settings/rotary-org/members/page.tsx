"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, AlertTriangle, Plus, Trash2, Eye, ArrowRightCircle, RefreshCw, Loader2 } from "lucide-react";
import {
  getDistricts, getDistrictClubs, compareMembers, addMemberFromOrg,
  updateMemberManual, deleteMemberFromClubManual, getMemberOrgDetail,
  refreshMembersCache,
} from "@/services/api";

interface DistrictOption { id: number; districtNumber: string }
interface ClubOption { id: number; clubName: string }

// Module-level stable components — defined outside the render function so React doesn't
// remount them on every keystroke (which would reset the dialog's scroll position).
type FieldRow = { key: string; label: string; orgValue: any };

function FieldRowComponent({
  row, value, onChange, onCopy,
}: {
  row: FieldRow;
  value: string;
  onChange: (v: string) => void;
  onCopy: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <div className="col-span-3 text-xs">{row.label}</div>
      <div className="col-span-4 text-xs bg-muted p-2 rounded text-muted-foreground truncate" title={row.orgValue || ""}>
        {row.orgValue || "—"}
      </div>
      <div className="col-span-1 flex justify-center">
        <Button variant="ghost" size="icon" disabled={!row.orgValue} onClick={onCopy} title="Copy from Rotary.org">
          <ArrowRightCircle className="h-4 w-4" />
        </Button>
      </div>
      <div className="col-span-4">
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function PopupSection({
  title, fields, editForm, setEditForm,
}: {
  title: string;
  fields: FieldRow[];
  editForm: any;
  setEditForm: React.Dispatch<React.SetStateAction<any>>;
}) {
  return (
    <div className="border rounded p-3 space-y-2">
      <h4 className="font-semibold text-sm text-primary border-b pb-1">{title}</h4>
      {fields.map((row) => (
        <FieldRowComponent
          key={row.key}
          row={row}
          value={editForm[row.key] || ""}
          onChange={(v) => setEditForm((prev: any) => ({ ...prev, [row.key]: v }))}
          onCopy={() => setEditForm((prev: any) => ({ ...prev, [row.key]: row.orgValue }))}
        />
      ))}
    </div>
  );
}

export default function RotaryOrgMembersPage() {
  const { isSuperAdmin } = useAuth();
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [districtId, setDistrictId] = useState<string>("");
  const [clubId, setClubId] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // hasSyncClubs=true → only districts that have ≥1 sync club (hide non-sync-only districts like Taiwan)
        const list = await getDistricts(1, 1000, undefined, undefined, undefined, undefined, undefined, true);
        setDistricts((list?.items || [])
          .map((d: any) => ({ id: d.id, districtNumber: d.districtNumber }))
          // numeric-aware sort: DistrictNumber is a VARCHAR, so "999" must come before "3142"
          .sort((a: any, b: any) =>
            String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      } catch { setError("Failed to load districts"); }
    })();
  }, []);

  useEffect(() => {
    if (!districtId) { setClubs([]); setClubId(""); return; }
    (async () => {
      try {
        const list = await getDistrictClubs(Number(districtId));
        setClubs((list || []).map((c: any) => ({ id: c.id, clubName: c.clubName })));
        setClubId("");
      } catch { setError("Failed to load clubs"); }
    })();
  }, [districtId]);

  const reload = async () => {
    if (!clubId) return;
    setLoading(true);
    setData(null);
    try { setData(await compareMembers(Number(clubId))); }
    catch (e: any) { setError(e?.response?.data?.message || "Failed to compare members"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (clubId) reload(); /* eslint-disable-next-line */ }, [clubId]);

  const onRefresh = async () => {
    if (!clubId) return;
    setRefreshing(true);
    try {
      const r = await refreshMembersCache(Number(clubId));
      setSuccess(r.message || "Cache refreshed");
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Refresh failed"); }
    finally { setRefreshing(false); }
  };

  const onAdd = async (rotaryMemberId: number) => {
    if (!clubId) return;
    setBusyKey(`add-${rotaryMemberId}`);
    try {
      await addMemberFromOrg(rotaryMemberId, Number(clubId));
      setSuccess("Member added.");
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to add"); }
    finally { setBusyKey(null); }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteMemberFromClubManual(deleteTarget.memberId, Number(clubId));
      setSuccess("Member removed.");
      setDeleteTarget(null);
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to delete"); setDeleteTarget(null); }
    finally { setDeleting(false); }
  };

  const buildEditForm = (india: any) => ({
    memberName: india.memberName ?? "",
    rotaryId: india.rotaryId ?? "",
    email: india.email ?? "",
    mobile: india.mobile ?? "",
    secondaryMobile: india.secondaryMobile ?? "",
    birthDate: india.birthDate ? String(india.birthDate).substring(0, 10) : "",
    gender: india.gender ?? "",
    primaryLanguage: india.language ?? "",
    resAddress: india.resAddress ?? "",
    resCity: india.resCity ?? "",
    resState: india.resState ?? "",
    resPinCode: india.resPinCode ?? "",
    busAddress: india.busAddress ?? "",
    busCity: india.busCity ?? "",
    busState: india.busState ?? "",
    busPinCode: india.busPinCode ?? "",
  });

  const openEdit = async (india: any) => {
    setViewingId(india.memberId);
    if (!india.rotaryId) {
      setEditTarget({ india, org: null });
      setEditForm(buildEditForm(india));
      setViewingId(null);
      return;
    }
    try {
      const org = await getMemberOrgDetail(Number(india.rotaryId));
      setEditTarget({ india, org });
      setEditForm(buildEditForm(india));
    } catch {
      setEditTarget({ india, org: null });
      setEditForm(buildEditForm(india));
    } finally {
      setViewingId(null);
    }
  };

  const copyFromOrg = (key: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [key]: value }));
  };

  const saveEdit = async () => {
    if (!editTarget?.india) return;
    setSavingEdit(true);
    try {
      // Convert blank strings to null — empty "" can't be deserialized as DateTime? on the server.
      const blankToNull = (v: any) => (v == null || v === "" ? null : v);
      await updateMemberManual(editTarget.india.memberId, {
        memberName: blankToNull(editForm.memberName),
        rotaryId: blankToNull(editForm.rotaryId),
        email: blankToNull(editForm.email),
        mobile: blankToNull(editForm.mobile),
        secondaryMobile: blankToNull(editForm.secondaryMobile),
        birthDate: blankToNull(editForm.birthDate),
        gender: blankToNull(editForm.gender),
        primaryLanguage: blankToNull(editForm.primaryLanguage),
        resAddress: blankToNull(editForm.resAddress),
        resCity: blankToNull(editForm.resCity),
        resState: blankToNull(editForm.resState),
        resPinCode: blankToNull(editForm.resPinCode),
        busAddress: blankToNull(editForm.busAddress),
        busCity: blankToNull(editForm.busCity),
        busState: blankToNull(editForm.busState),
        busPinCode: blankToNull(editForm.busPinCode),
      });
      setSuccess("Member updated.");
      setEditTarget(null);
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to save"); }
    finally { setSavingEdit(false); }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div>
      </ProtectedRoute>
    );
  }

  // Build aligned rows by rotaryId so matched members share a row
  type Row = { key: string; india: any | null; org: any | null; status: "matched" | "onlyIndia" | "onlyOrg" };
  const buildRows = (): Row[] => {
    if (!data) return [];
    const rows: Row[] = [];
    const orgById = new Map<string, any>(
      (data.orgMembers || []).map((m: any) => [String(m.rotaryMemberId), m])
    );
    const usedOrg = new Set<string>();
    for (const i of (data.indiaMembers || [])) {
      const rid = String(i.rotaryId || "");
      if (rid && orgById.has(rid)) {
        rows.push({ key: `m-${rid}`, india: i, org: orgById.get(rid), status: "matched" });
        usedOrg.add(rid);
      } else {
        rows.push({ key: `i-${i.memberId}`, india: i, org: null, status: "onlyIndia" });
      }
    }
    for (const o of (data.orgMembers || [])) {
      const rid = String(o.rotaryMemberId);
      if (!usedOrg.has(rid)) {
        rows.push({ key: `o-${rid}`, india: null, org: o, status: "onlyOrg" });
      }
    }
    const order: Record<Row["status"], number> = { matched: 0, onlyIndia: 1, onlyOrg: 2 };
    rows.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      const an = (a.india?.memberName || a.org?.memberName || "").toLowerCase();
      const bn = (b.india?.memberName || b.org?.memberName || "").toLowerCase();
      return an.localeCompare(bn);
    });
    return rows;
  };
  const rows = buildRows();

  // Org-side data extraction — all fields where present
  const ind = editTarget?.org?.individual;
  const orgEmails: any[] = editTarget?.org?.email || [];
  const orgPhones: any[] = editTarget?.org?.phone || [];
  const orgAddresses: any[] = editTarget?.org?.address || [];
  const orgName = ind?.localizedName || [ind?.prefix, ind?.firstName, ind?.middleName, ind?.lastName, ind?.suffix].filter(Boolean).join(" ");
  const orgPrimaryEmail = orgEmails.find((e: any) => e.isPrimary)?.emailAddress || orgEmails[0]?.emailAddress;
  const orgMobile = orgPhones.find((p: any) => p.phoneType?.toLowerCase() === "mobile")?.phoneNumber;
  const orgHomePhone = orgPhones.find((p: any) => p.phoneType?.toLowerCase() === "home")?.phoneNumber;
  const orgBusinessPhone = orgPhones.find((p: any) => p.phoneType?.toLowerCase() === "business")?.phoneNumber;
  const orgHomeAddr = orgAddresses.find((a: any) => a.addressType?.toLowerCase() === "home");
  const orgBusinessAddr = orgAddresses.find((a: any) => a.addressType?.toLowerCase() === "business");
  const formatAddr = (a: any) => a ? [a.addressLine1, a.addressLine2, a.addressLine3].filter(Boolean).join(", ") : "";

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings/rotary-org"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Member Sync</h2>
              <p className="text-muted-foreground text-base">Compare members in a club side-by-side and sync manually</p>
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">District</Label>
              <Select value={districtId} onValueChange={setDistrictId}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Select district" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Club</Label>
              <Select value={clubId} onValueChange={setClubId} disabled={!districtId}>
                <SelectTrigger className="w-56"><SelectValue placeholder={districtId ? "Select club" : "Pick district first"} /></SelectTrigger>
                <SelectContent>
                  {clubs.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.clubName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onRefresh} disabled={!clubId || refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh from Rotary.org"}
            </Button>
          </div>
        </div>

        {loading && <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && data && (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="secondary">India: {data.counts.ROW}</Badge>
              <Badge variant="secondary">Rotary.org: {data.counts.rotaryOrg}</Badge>
              <Badge className="bg-green-100 text-green-800 border-green-300">Matched: {data.counts.matched}</Badge>
              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Only India: {data.counts.onlyIndia}</Badge>
              <Badge className="bg-blue-100 text-blue-800 border-blue-300">Only Rotary.org: {data.counts.onlyOrg}</Badge>
              {data.lastFetchedUtc && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Cache last refreshed: {new Date(data.lastFetchedUtc).toLocaleString()}
                </span>
              )}
              {!data.lastFetchedUtc && data.counts.rotaryOrg === 0 && (
                <span className="text-xs text-amber-600 ml-auto">
                  Cache empty for this club — click "Refresh from Rotary.org".
                </span>
              )}
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/2 border-r bg-muted/40">ROW</TableHead>
                      <TableHead className="w-1/2">Rotary.org</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const rowBg =
                        row.status === "matched" ? "bg-green-50" :
                        row.status === "onlyIndia" ? "bg-yellow-50" :
                        "bg-blue-50";
                      const formatDate = (d: any) => d ? String(d).substring(0, 10) : "—";
                      const Field = ({ label, value }: { label: string; value: any }) => (
                        <div className="flex gap-2 text-xs">
                          <span className="text-muted-foreground w-20 flex-shrink-0">{label}:</span>
                          <span className="truncate" title={String(value || "")}>{value || "—"}</span>
                        </div>
                      );
                      const indiaResAddress = row.india ? [row.india.resAddress, row.india.resCity, row.india.resState, row.india.resPinCode].filter(Boolean).join(", ") : "";
                      const indiaBusAddress = row.india ? [row.india.busAddress, row.india.busCity, row.india.busState, row.india.busPinCode].filter(Boolean).join(", ") : "";
                      const orgAddress = row.org ? [row.org.address, row.org.city, row.org.state, row.org.postalCode].filter(Boolean).join(", ") : "";
                      return (
                        <TableRow key={row.key} className={rowBg}>
                          <TableCell className="border-r align-top">
                            {row.india ? (
                              <div className="space-y-1">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="font-semibold text-sm">{row.india.memberName}</p>
                                  <div className="flex-shrink-0">
                                    <Button variant="ghost" size="icon" onClick={() => openEdit(row.india)} disabled={viewingId === row.india.memberId}>
                                      {viewingId === row.india.memberId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(row.india)}><Trash2 className="h-4 w-4" /></Button>
                                  </div>
                                </div>
                                <Field label="Rotary ID" value={row.india.rotaryId} />
                                <Field label="Email" value={row.india.email} />
                                <Field label="Mobile" value={row.india.mobile} />
                                <Field label="DOB" value={formatDate(row.india.birthDate)} />
                                <Field label="Gender" value={row.india.gender} />
                                <Field label="Language" value={row.india.language} />
                                <Field label="Joined" value={formatDate(row.india.joinedDate)} />
                                <Field label="Residential" value={indiaResAddress} />
                                <Field label="Business" value={indiaBusAddress} />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">— not in India —</span>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            {row.org ? (
                              <div className="space-y-1">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="font-semibold text-sm">{row.org.memberName}</p>
                                  <div className="flex-shrink-0">
                                    {row.status === "onlyOrg" && (
                                      <Button size="sm" variant="outline" onClick={() => onAdd(row.org.rotaryMemberId)} disabled={busyKey === `add-${row.org.rotaryMemberId}`}>
                                        <Plus className="h-3 w-3 mr-1" />Add
                                      </Button>
                                    )}
                                    {row.status === "matched" && <Badge variant="secondary">Matched</Badge>}
                                  </div>
                                </div>
                                <Field label="Rotary ID" value={row.org.rotaryMemberId} />
                                <Field label="Email" value={row.org.email} />
                                <Field label="Mobile" value={row.org.mobile} />
                                <Field label="DOB" value={row.org.dateOfBirth || row.org.birthYear} />
                                <Field label="Gender" value={row.org.gender} />
                                <Field label="Language" value={row.org.language} />
                                <Field label="Admission" value={formatDate(row.org.admissionDate)} />
                                <Field label="Address" value={orgAddress} />
                                <Field label="Member Type" value={row.org.memberType} />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">— not on Rotary.org —</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {rows.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8">No members</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        {/* Edit dialog */}
        <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Member Comparison & Edit</DialogTitle>
              <DialogDescription>Click ⬅ to copy a value from Rotary.org into ROW.</DialogDescription>
            </DialogHeader>
            {editTarget && (
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground sticky top-0 bg-background z-10 py-1 border-b">
                  <div className="col-span-3">Field</div>
                  <div className="col-span-4">Rotary.org</div>
                  <div className="col-span-1 text-center">Copy</div>
                  <div className="col-span-4">ROW (editable)</div>
                </div>

                <PopupSection
                  title="Personal"
                  editForm={editForm}
                  setEditForm={setEditForm}
                  fields={[
                    { key: "memberName", label: "Full Name", orgValue: orgName },
                    { key: "rotaryId", label: "Rotary ID", orgValue: ind?.memberId ? String(ind.memberId) : "" },
                    { key: "birthDate", label: "Date of Birth", orgValue: ind?.dateOfBirth },
                    { key: "gender", label: "Gender", orgValue: ind?.gender || ind?.genderDescription },
                    { key: "primaryLanguage", label: "Primary Language", orgValue: ind?.primaryLanguage },
                  ]}
                />

                {(ind?.classification || ind?.youthFlag !== undefined || ind?.prefix || ind?.firstName || ind?.middleName || ind?.lastName || ind?.suffix) && (
                  <div className="border rounded p-3 space-y-1 bg-muted/20">
                    <h4 className="font-semibold text-sm text-muted-foreground border-b pb-1">Rotary.org additional (info only)</h4>
                    {ind?.prefix && <p className="text-xs"><span className="text-muted-foreground">Prefix:</span> {ind.prefix}</p>}
                    {ind?.firstName && <p className="text-xs"><span className="text-muted-foreground">First Name:</span> {ind.firstName}</p>}
                    {ind?.middleName && <p className="text-xs"><span className="text-muted-foreground">Middle Name:</span> {ind.middleName}</p>}
                    {ind?.lastName && <p className="text-xs"><span className="text-muted-foreground">Last Name:</span> {ind.lastName}</p>}
                    {ind?.suffix && <p className="text-xs"><span className="text-muted-foreground">Suffix:</span> {ind.suffix}</p>}
                    {ind?.classification && <p className="text-xs"><span className="text-muted-foreground">Classification:</span> {ind.classification}</p>}
                    {ind?.youthFlag !== undefined && ind?.youthFlag !== null && (
                      <p className="text-xs"><span className="text-muted-foreground">Youth:</span> {ind.youthFlag ? "Yes" : "No"}</p>
                    )}
                  </div>
                )}

                <PopupSection
                  title="Email"
                  editForm={editForm}
                  setEditForm={setEditForm}
                  fields={[
                    { key: "email", label: orgEmails.length > 1 ? "Primary Email" : "Email", orgValue: orgPrimaryEmail },
                  ]}
                />
                {orgEmails.length > 1 && (
                  <div className="border rounded p-2 bg-muted/20 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">All Rotary.org emails:</p>
                    {orgEmails.map((e: any, i: number) => (
                      <p key={i}>· {e.emailType || "?"}: {e.emailAddress} {e.isPrimary && "(primary)"}</p>
                    ))}
                  </div>
                )}

                <PopupSection
                  title="Phone"
                  editForm={editForm}
                  setEditForm={setEditForm}
                  fields={[
                    { key: "mobile", label: "Primary Mobile", orgValue: orgMobile || orgPhones[0]?.phoneNumber },
                    { key: "secondaryMobile", label: "Secondary (Home/Business)", orgValue: orgHomePhone || orgBusinessPhone },
                  ]}
                />
                {orgPhones.length > 0 && (
                  <div className="border rounded p-2 bg-muted/20 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">All Rotary.org phones:</p>
                    {orgPhones.map((p: any, i: number) => (
                      <p key={i}>· {p.phoneType || "?"}: {p.countryCode || ""} {p.phoneNumber} {p.isPrimary && "(primary)"}</p>
                    ))}
                  </div>
                )}

                <PopupSection
                  title="Residential Address"
                  editForm={editForm}
                  setEditForm={setEditForm}
                  fields={[
                    { key: "resAddress", label: "Address", orgValue: formatAddr(orgHomeAddr) },
                    { key: "resCity", label: "City", orgValue: orgHomeAddr?.city },
                    { key: "resState", label: "State", orgValue: orgHomeAddr?.state },
                    { key: "resPinCode", label: "Pin Code", orgValue: orgHomeAddr?.postalCode },
                  ]}
                />
                {orgHomeAddr?.country && (
                  <p className="text-xs text-muted-foreground -mt-2 ml-3">Country (Rotary.org): {orgHomeAddr.country}</p>
                )}

                <PopupSection
                  title="Business Address"
                  editForm={editForm}
                  setEditForm={setEditForm}
                  fields={[
                    { key: "busAddress", label: "Address", orgValue: formatAddr(orgBusinessAddr) },
                    { key: "busCity", label: "City", orgValue: orgBusinessAddr?.city },
                    { key: "busState", label: "State", orgValue: orgBusinessAddr?.state },
                    { key: "busPinCode", label: "Pin Code", orgValue: orgBusinessAddr?.postalCode },
                  ]}
                />
                {orgBusinessAddr?.country && (
                  <p className="text-xs text-muted-foreground -mt-2 ml-3">Country (Rotary.org): {orgBusinessAddr.country}</p>
                )}

                {!editTarget.org && <p className="text-sm text-amber-600">Rotary.org details could not be loaded.</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>Close</Button>
              <Button onClick={saveEdit} disabled={savingEdit}>
                {savingEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {savingEdit ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Remove Member from Club"
          description={`Soft-delete "${deleteTarget?.memberName}" from this club? If this is their only club, profile is also soft-deleted.`}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={onDelete}
          cancelLabel="Cancel"
          onCancel={() => !deleting && setDeleteTarget(null)}
        />
        <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
