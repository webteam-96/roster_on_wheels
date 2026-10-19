"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRiDirectorAvailableMembers, getRiDirectorSubGroup, createRiDirectorSubGroup, updateRiDirectorSubGroup, getRotaryYears } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Send, Users2, Search } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface AvailableMember {
  id: number;
  memberName: string;
  email: string | null;
  mobileNumber: string | null;
  profilePhotoPath: string | null;
  clubName: string | null;
  districtNumber: string | null;
  zoneName: string | null;
}

export default function RiSubGroupForm({ subGroupId }: { subGroupId?: number }) {
  const router = useRouter();
  const isEdit = !!subGroupId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [yearId, setYearId] = useState<number | null>(null);
  const [years, setYears] = useState<{ id: number; label: string; isCurrent: boolean }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [members, setMembers] = useState<AvailableMember[]>([]);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMembers = useCallback(async (q: string) => {
    try { setMembers(await getRiDirectorAvailableMembers(q || undefined)); }
    catch { setMembers([]); }
  }, []);

  useEffect(() => { loadMembers(""); }, [loadMembers]);

  useEffect(() => {
    (async () => {
      try {
        const y = await getRotaryYears();
        const list = y.map(x => ({ id: x.id, label: x.yearLabel, isCurrent: x.isCurrent }));
        setYears(list);
        if (!isEdit && yearId === null) {
          const current = list.find(x => x.isCurrent);
          if (current) setYearId(current.id);
          else if (list.length > 0) setYearId(list[0].id);
        }
      } catch {}
    })();
  }, [isEdit, yearId]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const d = await getRiDirectorSubGroup(subGroupId!);
        setGroupName(d.groupName);
        setYearId(d.yearId);
        setSelectedIds(new Set((d.members || []).map((m: any) => m.memberId)));
      } catch { setErrorMessage("Failed to load sub group."); }
      finally { setLoading(false); }
    })();
  }, [isEdit, subGroupId]);

  const toggle = (id: number) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const handleSearch = () => loadMembers(search);

  const handleSave = async () => {
    if (!groupName.trim()) { setErrorMessage("Group name is required."); return; }
    if (!yearId) { setErrorMessage("Year is required."); return; }
    if (selectedIds.size === 0) { setErrorMessage("Select at least one member."); return; }

    setSaving(true);
    try {
      const payload = { yearId, groupName: groupName.trim(), memberIds: Array.from(selectedIds) };
      if (isEdit) {
        await updateRiDirectorSubGroup(subGroupId!, payload);
        setSuccessMessage("Sub group updated.");
      } else {
        await createRiDirectorSubGroup(payload);
        setSuccessMessage("Sub group created.");
      }
      setTimeout(() => router.push("/ri-director/sub-groups"), 1500);
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to save."); }
    finally { setSaving(false); }
  };

  if (loading) return <ProtectedRoute><div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director/sub-groups"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{isEdit ? "Edit" : "Add"} Sub Group</h2>
            <p className="text-muted-foreground text-base">RI Director</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Year <span className="text-destructive">*</span></Label>
                <Select value={yearId ? String(yearId) : ""} onValueChange={(v) => setYearId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {years.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.label}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Group Name <span className="text-destructive">*</span></Label>
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={100} placeholder="e.g., Past Governors" />
              </div>
            </div>

            <div className="space-y-3 pt-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by name/email/mobile/rotaryId..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} className="pl-9" />
                </div>
                <Button onClick={handleSearch} size="sm">Search</Button>
                <div className="ml-auto text-sm text-muted-foreground flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-amber-500" />
                  <span>Selected: <span className="font-bold text-primary">{selectedIds.size}</span></span>
                </div>
              </div>

              <div className="border rounded-md max-h-[400px] overflow-auto">
                {members.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">No members found.</div>
                ) : (
                  <div className="divide-y">
                    {members.map(m => (
                      <label key={m.id} className="flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer">
                        <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{m.memberName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {m.clubName || "-"} · {m.districtNumber ? `D-${m.districtNumber}` : "-"} · {m.zoneName || "-"}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground hidden sm:block">
                          {m.email || m.mobileNumber || "-"}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleSave} disabled={saving} size="lg">
                {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />{isEdit ? "Update" : "Save"} Sub Group</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push("/ri-director/sub-groups")} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
