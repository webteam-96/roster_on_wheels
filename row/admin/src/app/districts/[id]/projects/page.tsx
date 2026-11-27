"use client";
import { Card } from "@/components/ui/card";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDistrict, getDistrictProjects, deleteDistrictProject, getDistrictProjectAvailableYears, getRotaryYears } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, MoreHorizontal, Pencil, Trash2, Search } from "@/components/icons";
import { Input } from "@/components/ui/input";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { formatMoney } from "@/lib/currency";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
export default function DistrictProjectsPage() {
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const [districtName, setDistrictName] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => { getDistrict(districtId).then(d => setDistrictName(`District ${d.districtNumber}`)).catch(() => {}); }, [districtId]);
  useEffect(() => {
    async function loadYears() {
      try {
        const available = await getDistrictProjectAvailableYears(districtId);
        if (available.length > 0) {
          setYears(available);
          const c = available.find((y: any) => y.isCurrent) || available[0];
          setYearId(String(c.id));
        } else {
          // No data yet — show current year so user can add
          const all = await getRotaryYears();
          const c = all.find((y: any) => y.isCurrent);
          if (c) { setYears([c]); setYearId(String(c.id)); }
        }
      } catch {}
    }
    loadYears();
  }, [districtId]);

  const fetchData = useCallback(async () => {
    if (!yearId) return;
    setLoading(true);
    try {
      const res = await getDistrictProjects(districtId, { yearId: Number(yearId), search: search || undefined, page, pageSize: 20 });
      setItems(res.items || []);
      setTotalCount(res.totalCount || 0);
    } catch {} finally { setLoading(false); }
  }, [districtId, yearId, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await deleteDistrictProject(districtId, Number(yearId) || 0, deleteId); setDeleteId(null); setSuccessMessage("Project deleted."); fetchData(); }
    catch { setDeleteId(null); setErrorMessage("Failed to delete."); }
  };

  const totalPages = Math.ceil(totalCount / 20);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        <AlertModal open={!!deleteId} icon={Trash2} iconClassName="text-destructive" title="Delete Project" description="Are you sure?" confirmLabel="Delete" cancelLabel="Cancel" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />

        <PageHeader
          title={<>{districtName} - Projects</>}
          description="Please post all the Projects executed by your District."
          back={`/districts/${districtId}/dashboard`}
          actions={
            <>
<Button onClick={() => router.push(`/districts/${districtId}/projects/add`)}><Plus className="mr-2 h-4 w-4" />Add Project</Button>
            </>
          }
        />

        <div className="flex flex-wrap gap-3 items-center">
          <Select value={yearId} onValueChange={v => { setYearId(v); setPage(1); }}>
            <SelectTrigger aria-label="Rotary year" className="w-48"><SelectValue placeholder="Select Year" /></SelectTrigger>
            <SelectContent>{years.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-2 flex-1">
            <Input aria-label="Search projects" placeholder="Search by title..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchData()} className="max-w-xs" />
            <Button size="sm" aria-label="Search" onClick={() => { setPage(1); fetchData(); }}><Search className="h-4 w-4" /></Button>
          </div>
        </div>

        {loading ? <div className="flex justify-center py-10"><ListPageSkeleton /></div> : items.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No projects found. Click &quot;Add Project&quot; to create one.</div>
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sr.</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Cost ({currencySymbol()})</TableHead>
                    <TableHead className="text-center">Beneficiaries</TableHead>
                    <TableHead>Area of Focus</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <TableRow key={item.id}>
                      <TableCell>{(page - 1) * 20 + idx + 1}</TableCell>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell>{item.projectDate ? new Date(item.projectDate).toLocaleDateString(appLocale()) : "–"}</TableCell>
                      <TableCell className="text-right">{item.projectCost ? formatMoney(item.projectCost, item.currency) : "–"}</TableCell>
                      <TableCell className="text-center">{item.directBeneficiaries || "–"}</TableCell>
                      <TableCell>{item.areaOfFocusName || "–"}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button aria-label="More actions" variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/projects/${item.id}/edit?yearId=${yearId}`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeleteId(item.id)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={20} onPageChange={setPage} />
            )}
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
