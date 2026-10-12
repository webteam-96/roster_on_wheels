"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getClubDuesList, deleteClubDues, toggleClubDuesActive, createClubDuesGoogleSheet, deleteClubDuesGoogleSheet } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Plus, Search, Power, PowerOff, FileSpreadsheet, Trash2 } from "lucide-react";

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
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">District Dues</h2>
            <p className="text-muted-foreground text-base">District-wise dues collection</p>
          </div>
          {isSuperAdmin && (
            <Button asChild>
              <Link href="/settings/club-dues/create"><Plus className="mr-2 h-4 w-4" />New District Dues</Link>
            </Button>
          )}
        </div>

        <div className="flex gap-2 max-w-md">
          <Input placeholder="Search by district or purpose" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
          <Button variant="outline" onClick={load}><Search className="h-4 w-4" /></Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No district dues campaigns yet.</div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 font-medium">District</th>
                  <th className="px-4 py-3 font-medium">Year</th>
                  <th className="px-4 py-3 font-medium">Purpose</th>
                  <th className="px-4 py-3 font-medium text-right">Collected</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-center">Sheet</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const faint = !r.isActive ? "opacity-50" : "";
                  return (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className={`px-4 py-3 font-medium ${faint}`}>District {r.districtNumber}</td>
                    <td className={`px-4 py-3 ${faint}`}>{r.rotaryYear}</td>
                    <td className={`px-4 py-3 text-muted-foreground ${faint}`}>{r.purpose || "District Dues"}</td>
                    <td className={`px-4 py-3 text-right font-medium ${faint}`}>₹{Number(r.collectedAmount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs rounded-full px-2 py-1 ${r.isActive ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                        {r.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.googleSheetId ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${r.googleSheetId}`, "_blank")}
                            className="text-blue-600 hover:text-blue-800" title="Open Google Sheet">
                            <FileSpreadsheet className="h-4 w-4" />
                          </button>
                          <button onClick={async () => {
                            if (!confirm("Delete this Google Sheet from Drive?")) return;
                            try {
                              setCreatingSheetId(r.id);
                              await deleteClubDuesGoogleSheet(r.id);
                              setSuccess("Google Sheet deleted.");
                              load();
                            } catch { setError("Failed to delete Google Sheet."); }
                            finally { setCreatingSheetId(null); }
                          }} className="text-red-600 hover:text-red-800" title="Delete Google Sheet">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : creatingSheetId === r.id ? (
                        <div className="flex justify-center"><RotaryLoader size="sm" /></div>
                      ) : (
                        <button onClick={async () => {
                          try {
                            setCreatingSheetId(r.id);
                            await createClubDuesGoogleSheet(r.id);
                            setSuccess("Google Sheet created successfully.");
                            load();
                          } catch (e: any) { setError(e?.response?.data?.message || "Failed to create Google Sheet."); }
                          finally { setCreatingSheetId(null); }
                        }} className="text-muted-foreground hover:text-green-600" title="Create Google Sheet">
                          <FileSpreadsheet className="h-4 w-4 mx-auto" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => router.push(`/settings/club-dues/${r.id}/clubs`)}>Clubs</Button>
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/report/club-dues/${r.id}`); setSuccess("Report link copied."); }} title="Copy public report link">Report link</Button>
                        <Button size="sm" variant="outline" onClick={() => router.push(`/settings/club-dues/create?edit=${r.id}`)}>Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => onToggle(r.id)} title={r.isActive ? "Deactivate" : "Activate"}>
                          {r.isActive
                            ? <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                            : <Power className="h-3.5 w-3.5 text-green-600" />}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => onDelete(r)} disabled={!!r.isActive} title={r.isActive ? "Deactivate before deleting" : "Delete"}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </ProtectedRoute>
  );
}
