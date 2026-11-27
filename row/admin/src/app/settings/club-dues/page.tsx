"use client";
import { IconButton } from "@/components/ui/icon-button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import DuesDraftsCard from "@/components/dues/DuesDraftsCard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getClubDuesList, deleteClubDues, toggleClubDuesActive, createClubDuesGoogleSheet, deleteClubDuesGoogleSheet } from "@/services/api";
import { getCurrencySymbol } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Search, Power, PowerOff, FileSpreadsheet, Trash2 } from "@/components/icons";

import { appLocale, currencySymbol } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { BASE_PATH } from "@/lib/basePath";
interface ClubDuesRow {
  id: number;
  districtNumber?: string;
  rotaryYear?: string;
  purpose?: string;
  defaultPerMemberRate: number;
  clubCount: number;
  memberCount: number;
  paidMemberCount: number;
  unpaidMemberCount: number;
  collectedAmount: number;
  isActive: boolean;
  createdDate: string;
  googleSheetId?: string;
  currency?: string;
}

export default function ClubDuesListPage() {
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<ClubDuesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingSheetId, setCreatingSheetId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getClubDuesList(search ? { search } : undefined);
      setRows(data);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load district dues.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const onToggle = async (id: number) => {
    try { await toggleClubDuesActive(id); load(); } catch { setError("Failed to toggle."); }
  };
  const onDelete = async (row: ClubDuesRow) => {
    if (row.isActive) {
      setError("Deactivate this district dues campaign before deleting it.");
      return;
    }
    if (!confirm("Delete this district dues campaign?")) return;
    try { await deleteClubDues(row.id); setSuccess("Deleted."); load(); } catch { setError("Failed to delete."); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="District Dues"
          description="District-wise dues collection"
          back="/settings/payments-and-dues"
          actions={isSuperAdmin && (
            <Button asChild>
              <Link href="/settings/club-dues/create"><Plus className="mr-2 h-4 w-4" />New District Dues</Link>
            </Button>
          )}
        />

        {isSuperAdmin && <DuesDraftsCard kind="district" stepLabels={["Basic Info", "Payment & Split", "Club List", "Images & Email"]} />}

        <div className="flex gap-2 max-w-md">
          <Input placeholder="Search by district or purpose" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <Button variant="outline" aria-label="Search" onClick={load}><Search className="h-4 w-4" /></Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><ListPageSkeleton /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No district dues campaigns yet.</div>
        ) : (
          <Card className="overflow-x-auto">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="px-4">District</TableHead>
                  <TableHead className="px-4">Year</TableHead>
                  <TableHead className="px-4">Purpose</TableHead>
                  <TableHead className="px-4 text-right">Collected</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4 text-center">Sheet</TableHead>
                  <TableHead className="px-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const faint = !r.isActive ? "opacity-50" : "";
                  return (
                  <TableRow key={r.id} className="border-b hover:bg-muted/30">
                    <TableCell className={`px-4 py-3 font-medium ${faint}`}>District {r.districtNumber}</TableCell>
                    <TableCell className={`px-4 py-3 ${faint}`}>{r.rotaryYear}</TableCell>
                    <TableCell className={`px-4 py-3 text-muted-foreground ${faint}`}>{r.purpose || "District Dues"}</TableCell>
                    <TableCell className={`px-4 py-3 text-right font-medium ${faint}`}>{getCurrencySymbol(r.currency)}{Number(r.collectedAmount).toLocaleString(appLocale())}</TableCell>
                    <TableCell className="px-4 py-3">
                      <span className={`text-xs rounded px-2 py-1 ${r.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                        {r.isActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      {r.googleSheetId ? (
                        <div className="flex items-center justify-center gap-1">
                          <IconButton aria-label="Open Google Sheet" onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${r.googleSheetId}`, "_blank")}
                            title="Open Google Sheet">
                            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                          </IconButton>
                          <IconButton aria-label="Delete Google Sheet" onClick={async () => {
                            if (!confirm("Delete this Google Sheet from Drive?")) return;
                            try {
                              setCreatingSheetId(r.id);
                              await deleteClubDuesGoogleSheet(r.id);
                              setSuccess("Google Sheet deleted.");
                              load();
                            } catch { setError("Failed to delete Google Sheet."); }
                            finally { setCreatingSheetId(null); }
                          }} title="Delete Google Sheet">
                            <Trash2 className="h-3.5 w-3.5 text-red-600" />
                          </IconButton>
                        </div>
                      ) : creatingSheetId === r.id ? (
                        <div className="flex justify-center"><RotaryLoader size="sm" /></div>
                      ) : (
                        <IconButton aria-label="Create Google Sheet" onClick={async () => {
                          try {
                            setCreatingSheetId(r.id);
                            await createClubDuesGoogleSheet(r.id);
                            setSuccess("Google Sheet created successfully.");
                            load();
                          } catch (e: any) { setError(e?.response?.data?.message || "Failed to create Google Sheet."); }
                          finally { setCreatingSheetId(null); }
                        }} title="Create Google Sheet">
                          <FileSpreadsheet className="h-4 w-4" />
                        </IconButton>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => router.push(`/settings/club-dues/${r.id}/clubs`)}>Clubs</Button>
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${BASE_PATH}/report/club-dues/${r.id}`); setSuccess("Report link copied."); }} title="Copy public report link">Report link</Button>
                        <Button size="sm" variant="outline" onClick={() => router.push(`/settings/club-dues/create?edit=${r.id}`)}>Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => onToggle(r.id)} title={r.isActive ? "Deactivate" : "Activate"}>
                          {r.isActive
                            ? <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                            : <Power className="h-3.5 w-3.5 text-green-600" />}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => onDelete(r)} disabled={!!r.isActive} title={r.isActive ? "Deactivate before deleting" : "Delete"}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </ProtectedRoute>
  );
}
