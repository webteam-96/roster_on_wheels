"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { AttendanceListItem } from "@/types/attendance";
import {
  getClub,
  getAttendanceList,
  deleteAttendance,
  getAttendanceYears,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Search, X, Plus, Pencil, Trash2, Eye,
  MoreHorizontal, FolderOpen, AlertTriangle,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { useFormat } from "@/hooks/useFormat";
import { useEventZone } from "@/hooks/useEventZone";
import { ListPageSkeleton } from "@/components/row/AppKit";
function CountBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      {count}
    </span>
  );
}

export default function AttendancePage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [attendanceList, setAttendanceList] = useState<AttendanceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const pageSize = 20;

  const [years, setYears] = useState<{ id: number; yearLabel: string; isCurrent: boolean }[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceListItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const canManage = isSuperAdmin || isAdmin;
  const fmt = useFormat();
  const zone = useEventZone({ clubId });

  useEffect(() => {
    async function init() {
      try {
        const [club, attYears] = await Promise.all([
          getClub(clubId),
          getAttendanceYears(clubId),
        ]);
        setClubName(club.clubName);
        setYears(attYears);
        const currentYear = attYears.find((y: { isCurrent: boolean }) => y.isCurrent);
        setSelectedYearId(currentYear ? currentYear.id : attYears.length > 0 ? attYears[0].id : null);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  const fetchAttendance = useCallback(async () => {
    if (!selectedYearId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await getAttendanceList(
        clubId, selectedYearId, page, pageSize,
        search || undefined
      );
      setAttendanceList(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setAttendanceList([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, selectedYearId, page, search]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleAddClick = () => {
    router.push(`/clubs/${clubId}/attendance/add`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAttendance(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Attendance deleted successfully.");
      fetchAttendance();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete attendance.");
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return fmt.eventDateTime(dateStr, zone);
  };

  const filteredAttendance = attendanceList.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.eventName || "").toLowerCase().includes(q) ||
      (item.eventDateTime ? formatDateTime(item.eventDateTime).toLowerCase().includes(q) : false)
    );
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Attendance` : "Attendance"}
              </h2>
              <p className="text-muted-foreground text-base">Manage attendance</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={handleAddClick}>
              <Plus className="mr-2 h-4 w-4" />Add Attendance
            </Button>
          )}
        </div>

        {/* Year selector + Search */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-48">
            <Select
              value={selectedYearId ? String(selectedYearId) : ""}
              onValueChange={(v) => { setSelectedYearId(Number(v)); setPage(1); }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={String(y.id)}>
                    {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by event name..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9"
              />
              {searchInput && (
                <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            <Button onClick={handleSearch} size="sm">Search</Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && attendanceList.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by event name, date..."
          />
        )}

        {!loading && attendanceList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No attendance records found</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No attendance records match your search." : canManage ? `Click "Add Attendance" to create one.` : "No attendance records for this year."}
            </p>
          </div>
        )}

        {!loading && filteredAttendance.length === 0 && attendanceList.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No attendance records match your search &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && filteredAttendance.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12 text-base font-semibold">S.No.</TableHead>
                    <TableHead className="text-base font-semibold">Event Name</TableHead>
                    <TableHead className="text-base font-semibold">Event Date</TableHead>
                    <TableHead className="text-base font-semibold text-center">Members</TableHead>
                    <TableHead className="text-base font-semibold text-center">Anns</TableHead>
                    <TableHead className="text-base font-semibold text-center">Annets</TableHead>
                    <TableHead className="text-base font-semibold text-center">Visitors</TableHead>
                    <TableHead className="text-base font-semibold text-center">Rotarians</TableHead>
                    <TableHead className="text-base font-semibold text-center">Delegates</TableHead>
                    {canManage && (
                      <TableHead className="w-12"></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttendance.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                      <TableCell>
                        <p
                          className="font-medium cursor-pointer hover:text-primary"
                          onClick={() => router.push(`/clubs/${clubId}/attendance/${item.id}`)}
                        >
                          {item.eventName}
                        </p>
                      </TableCell>
                      <TableCell>{formatDateTime(item.eventDateTime)}</TableCell>
                      <TableCell className="text-center"><CountBadge count={item.membersCount} /></TableCell>
                      <TableCell className="text-center"><CountBadge count={item.annsCount} /></TableCell>
                      <TableCell className="text-center"><CountBadge count={item.annetsCount} /></TableCell>
                      <TableCell className="text-center"><CountBadge count={item.visitorsCount} /></TableCell>
                      <TableCell className="text-center"><CountBadge count={item.rotariansCount} /></TableCell>
                      <TableCell className="text-center"><CountBadge count={item.delegatesCount} /></TableCell>
                      {canManage && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/attendance/${item.id}`)}>
                                <Eye className="mr-2 h-4 w-4" />View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/attendance/${item.id}/edit`)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(item)}>
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Attendance"
          description={
            <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.eventName}</span>? This action cannot be undone.</>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
