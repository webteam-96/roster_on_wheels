"use client";

import { useState, useEffect, useCallback } from "react";
import DateField from "@/components/DateField";
import { getAuditLog, type AuditLogFilter } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, History, Search, Filter, RotateCcw, Download } from "lucide-react";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const actionColors: Record<string, string> = {
  Create: "bg-green-500 hover:bg-green-600",
  Update: "bg-blue-500 hover:bg-blue-600",
  Delete: "bg-red-500 hover:bg-red-600",
  Upload: "bg-purple-500 hover:bg-purple-600",
  Reorder: "bg-amber-500 hover:bg-amber-600",
  Approve: "bg-emerald-500 hover:bg-emerald-600",
  Reject: "bg-red-400 hover:bg-red-500",
  Assign: "bg-indigo-500 hover:bg-indigo-600",
  Remove: "bg-orange-500 hover:bg-orange-600",
};

// Local YYYY-MM-DD (device timezone) — the log view defaults to today's entries.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 2000) return "—";
  return dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AuditLogPage() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [items, setItems] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Dynamic entity types from API
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<string>("all");
  const [entityType, setEntityType] = useState<string>("all");
  // Default to today's logs — change the date range via the filters to see more.
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());

  const fetchLogs = useCallback(async (pg: number = 1, ov?: { search?: string; action?: string; entityType?: string; fromDate?: string; toDate?: string }) => {
    setLoading(true);
    try {
      const s = ov?.search ?? search, a = ov?.action ?? action, et = ov?.entityType ?? entityType;
      const fd = ov?.fromDate ?? fromDate, td = ov?.toDate ?? toDate;
      const filter: AuditLogFilter = { page: pg, pageSize };
      if (s.trim()) filter.search = s.trim();
      if (a && a !== "all") filter.action = a;
      if (et && et !== "all") filter.entityType = et;
      if (fd) filter.fromDate = fd;
      if (td) filter.toDate = td;
      const result = await getAuditLog(filter);
      setItems(result.items || []);
      setTotalCount(result.totalCount || 0);
      setPage(pg);
      if (result.entityTypes) setEntityTypes(result.entityTypes);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [search, action, entityType, fromDate, toDate]);

  useEffect(() => { fetchLogs(1); }, []); // eslint-disable-line

  const resetFilters = () => {
    // Reset returns to the default view = today's logs (not an all-time dump).
    const t = todayStr();
    setSearch(""); setAction("all"); setEntityType("all"); setFromDate(t); setToDate(t);
    fetchLogs(1, { search: "", action: "all", entityType: "all", fromDate: t, toDate: t });
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can view audit logs.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Audit Log</h2>
            <p className="text-muted-foreground text-base">Complete system-wide activity log for all CRUD operations</p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Search</Label>
                <Input placeholder="User, entity, IP..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Action</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger><SelectValue placeholder="All actions" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Create">Create</SelectItem>
                    <SelectItem value="Update">Update</SelectItem>
                    <SelectItem value="Delete">Delete</SelectItem>
                    <SelectItem value="Upload">Upload</SelectItem>
                    <SelectItem value="Reorder">Reorder</SelectItem>
                    <SelectItem value="Approve">Approve</SelectItem>
                    <SelectItem value="Reject">Reject</SelectItem>
                    <SelectItem value="Assign">Assign</SelectItem>
                    <SelectItem value="Remove">Remove</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Module</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger><SelectValue placeholder="All modules" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {entityTypes.map(et => (
                      <SelectItem key={et} value={et}>{et}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">From Date</Label>
                <DateField value={fromDate} onChange={setFromDate} />
              </div>
              <div>
                <Label className="text-xs">To Date</Label>
                <DateField value={toDate} onChange={setToDate} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" onClick={resetFilters} disabled={loading}>
                <RotateCcw className="h-4 w-4 mr-1" /> Reset
              </Button>
              <Button variant="outline" onClick={() => exportToCSV(items, "audit_log", [
                { key: "districtNumber", label: "District" }, { key: "clubName", label: "Club" },
                { key: "entityType", label: "Module" }, { key: "memberName", label: "User" },
                { key: "roleName", label: "Role" }, { key: "action", label: "Action" },
                { key: "createdDate", label: "Date & Time" }, { key: "entityName", label: "Name / Title" },
                { key: "details", label: "API Path" }, { key: "ipAddress", label: "IP Address" },
              ])} disabled={items.length === 0}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
              <Button onClick={() => fetchLogs(1)} disabled={loading}>
                {loading ? <RotaryLoader size="sm" /> : <><Search className="h-4 w-4 mr-2" />Apply</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Audit Entries ({totalCount})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">No audit entries match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>District</TableHead>
                    <TableHead>Club</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="w-[160px]">Date & Time</TableHead>
                    <TableHead>Name / Title</TableHead>
                    <TableHead>API Path</TableHead>
                    <TableHead>IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">{log.districtNumber || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate" title={log.clubName || ""}>{log.clubName || "—"}</TableCell>
                      <TableCell className="text-xs font-medium">{log.entityType}</TableCell>
                      <TableCell className="text-sm font-medium">{log.memberName || "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{log.roleName || "—"}</Badge></TableCell>
                      <TableCell>
                        <Badge className={`text-xs text-white ${actionColors[log.action] || "bg-gray-500"}`}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(log.createdDate)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={log.entityName}>
                        {log.entityName || (log.entityId ? `#${log.entityId}` : "—")}
                      </TableCell>
                      <TableCell className="text-xs max-w-[250px] truncate font-mono text-muted-foreground" title={log.details || ""}>
                        {log.details || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.ipAddress || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages} — {totalCount} entries
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => fetchLogs(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => fetchLogs(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
