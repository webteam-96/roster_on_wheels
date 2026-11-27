"use client";
import { ClearButton } from "@/components/ui/text-buttons";

import PublishStatusBadge from "@/components/PublishStatusBadge";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { UpcomingEventListItem } from "@/types/upcomingEvent";
import {
  getClub,
  getUpcomingEvents,
  deleteUpcomingEvent,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { useCurrentRotaryYear } from "@/hooks/useCurrentRotaryYear";
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
import SendStatusBadges from "@/components/SendStatusBadges";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Search, X, Plus, Pencil, Trash2, Eye, MoreHorizontal, FolderOpen, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Published", label: "Published" },
  { value: "Expired", label: "Expired" },
  { value: "Unpublished", label: "Unpublished" },
];


export default function UpcomingEventsPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin, user } = useAuth();

  const [clubName, setClubName] = useState("");
  const [events, setEvents] = useState<UpcomingEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 20;

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UpcomingEventListItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // This module carries no Rotary year, so editing it needs CURRENT-year rights —
  // the same rule AdminYearGuard.ClubYearlessAsync applies on the server.
  const currentYearId = useCurrentRotaryYear();
  const { years: ywarYears } = useRotaryYears();
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const isClubAdmin = isSuperAdmin || isAdmin;
  const canManage = isClubAdmin && canEditYearless(yearRights, currentYearId, isSuperAdmin);
  // YWAR-BADGE-YEARLESS — name the CURRENT year, not the years held.
  // This data is not filed by Rotary year, so "you can make changes in
  // 2025-26" is untrue: those years cannot help here. See ViewOnlyBadge.
  const ywarCurrentYearLabel =
    ywarYears.find((y) => y.id === currentYearId)?.yearLabel ?? "";

  // ⚠️ View must NOT depend on canManage — see the comment in projects/page.tsx.
  const canView = isClubAdmin;
  useEffect(() => {
    async function init() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUpcomingEvents(
        clubId, page, pageSize,
        statusFilter !== "all" ? statusFilter : undefined,
        search || undefined
      );
      setEvents(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setEvents([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, search, statusFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleAddClick = () => {
    router.push(`/clubs/${clubId}/upcoming-events/add`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUpcomingEvent(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Event deleted successfully.");
      fetchEvents();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete event.");
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const filteredEvents = events.filter((event) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (event.title || "").toLowerCase().includes(q) ||
      (event.eventDate ? formatDate(event.eventDate).toLowerCase().includes(q) : false) ||
      (event.status || "").toLowerCase().includes(q)
    );
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Upcoming Events` : "Upcoming Events"}
          description="Manage upcoming events"
          back={`/clubs/${clubId}/dashboard`}
          actions={canManage && (
            <Button onClick={handleAddClick}>
              <Plus className="mr-2 h-4 w-4" />Add Event
            </Button>
          )}
        />

        {isClubAdmin && !canManage && (
          <ViewOnlyBadge currentYearOnly={ywarCurrentYearLabel} className="mb-4" />
        )}

        {/* Status filter + Search */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-44">
            <Select
              value={statusFilter}
              onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9"
              />
              {searchInput && (
                <ClearButton onClick={clearSearch} aria-label="Clear search" />
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

        {!loading && events.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by title, date, status..."
          />
        )}

        {!loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No events found</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No events match your search." : canManage ? `Click "Add Event" to create one.` : "No events for this year."}
            </p>
          </div>
        )}

        {!loading && filteredEvents.length === 0 && events.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No results found</h3>
            <p className="text-muted-foreground mt-2">No events match your search &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && filteredEvents.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">S.No.</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Event Date</TableHead>
                    <TableHead>Publish Date</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    {canView && (
                      <TableHead className="w-12"></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event, index) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                      <TableCell>
                        <div
                          className="flex items-center gap-2 cursor-pointer hover:text-primary"
                          onClick={() => router.push(`/clubs/${clubId}/upcoming-events/${event.id}`)}
                        >
                          {event.imagePath && (
                            <img
                              src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${event.imagePath}`}
                              alt=""
                              className="h-10 w-10 rounded object-cover"
                            />
                          )}
                          <p className="font-medium">{event.title}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(event.eventDate)}</TableCell>
                      <TableCell>{formatDate(event.publishDate)}</TableCell>
                      <TableCell>{formatDate(event.expiryDate)}</TableCell>
                      <TableCell className="text-center">
                        <PublishStatusBadge status={event.status} />
                        <SendStatusBadges item={event} />
                      </TableCell>
                      {canView && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button aria-label="More actions" variant="ghost" size="icon" className="row-btn-sm"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/upcoming-events/${event.id}`)}>
                                <Eye className="mr-2 h-4 w-4" />View
                              </DropdownMenuItem>
                              {event.status !== "Expired" && canManage && (
                                <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/upcoming-events/${event.id}/edit`)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                              )}
                              {canManage && (
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(event)}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              )}
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
          title="Delete Event"
          description={
            <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This action cannot be undone.</>
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
