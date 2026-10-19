"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRiDirectorSubGroups, deleteRiDirectorSubGroup, getRiDirectorSubGroupYears } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle, Users2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface SubGroupItem {
  id: number;
  yearId: number;
  yearLabel: string | null;
  groupName: string;
  memberCount: number;
  createdDate: string | null;
}

export default function RiDirectorSubGroupsPage() {
  const router = useRouter();
  const { isSuperAdmin, isRIDirector } = useAuth();
  const canManage = isSuperAdmin || isRIDirector;

  const [items, setItems] = useState<SubGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [years, setYears] = useState<{ id: number; label: string; isCurrent: boolean }[]>([]);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubGroupItem | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const y = await getRiDirectorSubGroupYears();
        setYears(y.map(x => ({ id: x.id, label: x.yearLabel, isCurrent: x.isCurrent })));
      } catch {}
    })();
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try { setItems(await getRiDirectorSubGroups(yearFilter !== "all" ? Number(yearFilter) : undefined)); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }, [yearFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteRiDirectorSubGroup(deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Sub group deleted."); fetchItems(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete sub group."); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href="/ri-director"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director - Sub Groups</h2>
              <p className="text-muted-foreground text-base">Custom member groupings across all zones, districts, clubs</p>
            </div>
          </div>
          {canManage && <Button onClick={() => router.push("/ri-director/sub-groups/add")}><Plus className="mr-2 h-4 w-4" />Add Sub Group</Button>}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Year:</span>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {years.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.label}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No sub groups found</h3>
          </div>
        )}
        {!loading && items.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground font-semibold">S.No.</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Year</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Group Name</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Members</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((g, i) => (
                  <TableRow key={g.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell><span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">{g.yearLabel || "-"}</span></TableCell>
                    <TableCell className="font-medium flex items-center gap-2"><Users2 className="h-4 w-4 text-amber-500" />{g.groupName}</TableCell>
                    <TableCell className="text-center"><span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">{g.memberCount}</span></TableCell>
                    {canManage && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/ri-director/sub-groups/${g.id}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(g)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Sub Group" description={<>Delete <span className="font-semibold">{deleteTarget?.groupName}</span>?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
