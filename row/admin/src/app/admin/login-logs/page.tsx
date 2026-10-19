"use client";

import { useState, useCallback } from "react";
import DateField from "@/components/DateField";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { getLoginLogs } from "@/services/api";
import { LoginAuditLog } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RotaryLoader from "@/components/RotaryLoader";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Search, ArrowLeft, CheckCircle, XCircle, Monitor, FileSearch } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
export default function LoginLogsPage() {
  const { isSuperAdmin } = useAuth();
  const router = useRouter();

  const [logs, setLogs] = useState<LoginAuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const pageSize = 20;

  const fetchLogs = useCallback(async (overridePage?: number) => {
    setLoading(true);
    try {
      const targetPage = overridePage ?? page;
      const data = await getLoginLogs(search, statusFilter, fromDate, toDate, targetPage, pageSize);
      setLogs(data.items);
      setTotalCount(data.totalCount);
      setHasSearched(true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, fromDate, toDate, page]);

  const handleSearch = () => {
    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      alert("From date cannot be after To date.");
      return;
    }
    setPage(1);
    fetchLogs(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchLogs(newPage);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <ProtectedRoute>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Login Audit Logs</h2>
            <p className="text-muted-foreground">Track all login attempts</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Apply at least one filter and click Search. Records are not loaded automatically.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2 space-y-1">
              <Label className="text-xs">Name / Mobile / Email</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, mobile or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From Date</Label>
              <DateField value={fromDate} onChange={setFromDate} max={toDate || undefined} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To Date</Label>
              <DateField value={toDate} onChange={setToDate} min={fromDate || undefined} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={statusFilter || "all"}
                onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setFromDate("");
                setToDate("");
                setLogs([]);
                setTotalCount(0);
                setHasSearched(false);
                setPage(1);
              }}
            >
              Reset
            </Button>
            <Button onClick={handleSearch}>
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RotaryLoader size="lg" />
            </div>
          ) : !hasSearched ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileSearch className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground max-w-md">
                Apply filters above (name/mobile/email, date range, or status) and click Search to load login records.
              </p>
            </div>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-sm py-12 text-center">
              No login logs found for the applied filters.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="text-primary-foreground">Status</TableHead>
                      <TableHead className="text-primary-foreground">Name</TableHead>
                      <TableHead className="text-primary-foreground">Email / Mobile</TableHead>
                      <TableHead className="text-primary-foreground">Login Time</TableHead>
                      <TableHead className="text-primary-foreground">IP Address</TableHead>
                      <TableHead className="text-primary-foreground">Reason</TableHead>
                      <TableHead className="text-primary-foreground">Browser</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {log.loginStatus === "success" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="h-3 w-3" />
                              Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <XCircle className="h-3 w-3" />
                              Failed
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {log.memberName || "–"}
                        </TableCell>
                        <TableCell className="text-sm">{log.emailOrMobile || "–"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(log.loginTime).toLocaleString(appLocale(), {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-sm font-mono">{log.ipAddress || "–"}</TableCell>
                        <TableCell className="text-sm text-red-600">
                          {log.failureReason || "–"}
                        </TableCell>
                        <TableCell>
                          {log.userAgent ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground max-w-[150px] truncate" title={log.userAgent}>
                              <Monitor className="h-3 w-3 shrink-0" />
                              {extractBrowser(log.userAgent)}
                            </span>
                          ) : "–"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="p-4">
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    totalCount={totalCount}
                    pageSize={pageSize}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}

function extractBrowser(ua: string): string {
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Opera") || ua.includes("OPR")) return "Opera";
  return "Other";
}
