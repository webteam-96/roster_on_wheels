"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectListItem } from "@/types/project";
import {
  getClub,
  getModules,
  getProjects,
  deleteProject,
  getProjectYears,
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
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Search, X, Plus, Pencil, Trash2, Eye,
  MoreHorizontal, FolderOpen, AlertTriangle, Info,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale } from "@/lib/appFormat";
const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

const AGREE_MESSAGE = `The data I will enter is for a Meeting / Event conducted by my club. E.g., Installation, Navratri Celebration, Weekly Meetings, Etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

export default function ClubServicePage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
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
  const [showAgreeDialog, setShowAgreeDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, modules] = await Promise.all([
          getClub(clubId),
          getModules(),
        ]);
        setClubName(club.clubName);
        const mod = modules.find(m => m.moduleKey === "club_service");
        if (mod) {
          setModuleId(mod.id);
          const projectYears = await getProjectYears(clubId, mod.id);
          setYears(projectYears);
          const currentYear = projectYears.find(y => y.isCurrent);
          setSelectedYearId(currentYear ? currentYear.id : projectYears.length > 0 ? projectYears[0].id : null);
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
      }
    }
    init();
  }, [clubId]);

  const fetchProjects = useCallback(async () => {
    if (!moduleId || !selectedYearId) return;
    setLoading(true);
    try {
      const result = await getProjects(clubId, moduleId, selectedYearId, page, pageSize, search || undefined);
      setProjects(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setProjects([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, moduleId, selectedYearId, page, search]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleAddClick = () => {
    setShowAgreeDialog(true);
  };

  const handleAgreeAndContinue = () => {
    setShowAgreeDialog(false);
    router.push(`/clubs/${clubId}/club-service/add?yearId=${selectedYearId}`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProject(clubId, selectedYearId ?? 0, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Meeting deleted successfully.");
      fetchProjects();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete meeting.");
    }
  };

  const filteredProjects = projects.filter((project) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const meetingLabel = MEETING_TYPE_LABELS[project.meetingType || ""] || project.meetingType || "";
    return (
      project.title?.toLowerCase().includes(q) ||
      meetingLabel.toLowerCase().includes(q) ||
      (project.projectDate && new Date(project.projectDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }).toLowerCase().includes(q)) ||
      String(project.attendance ?? "").includes(q) ||
      String(project.attendancePercentage ?? "").includes(q)
    );
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  };

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
                {clubName ? `${clubName} - Club Service` : "Club Service"}
              </h2>
              <p className="text-muted-foreground text-base">Manage club meetings & events</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={handleAddClick}>
              <Plus className="mr-2 h-4 w-4" />Add Meeting
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
                <SelectValue placeholder="Select year" />
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
                placeholder="Search by title..."
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

        {/* Quick filter */}
        {!loading && projects.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Quick filter by title, meeting type, date..."
            className="max-w-md"
          />
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No meetings found</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No meetings match your search." : canManage ? `Click "Add Meeting" to create one.` : "No meetings for this year."}
            </p>
          </div>
        )}

        {!loading && filteredProjects.length === 0 && searchQuery && projects.length > 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No results found</h3>
            <p className="text-muted-foreground mt-2">No meetings match your filter &quot;{searchQuery}&quot;. Try a different term.</p>
          </div>
        )}

        {!loading && filteredProjects.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12 text-primary-foreground text-base font-semibold">S.No.</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Title</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Meeting Type</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Date</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold text-center">Attendance</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold text-center">Attendance %</TableHead>
                    {canManage && (
                      <TableHead className="w-12 text-primary-foreground"></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project, index) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {project.primaryPhotoPath && (
                            <img
                              src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${project.primaryPhotoPath}`}
                              alt=""
                              className="h-10 w-10 rounded object-cover"
                            />
                          )}
                          <p className="font-medium">{project.title}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {MEETING_TYPE_LABELS[project.meetingType || ""] || project.meetingType || "-"}
                        </span>
                      </TableCell>
                      <TableCell>{formatDate(project.projectDate)}</TableCell>
                      <TableCell className="text-center">{project.attendance ?? "-"}</TableCell>
                      <TableCell className="text-center">{project.attendancePercentage != null ? `${project.attendancePercentage}%` : "-"}</TableCell>
                      {canManage && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/club-service/${project.id}?yearId=${selectedYearId}`)}>
                                <Eye className="mr-2 h-4 w-4" />View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/club-service/${project.id}/edit?yearId=${selectedYearId}`)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(project)}>
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

        {/* I Agree Dialog */}
        <AlertModal
          open={showAgreeDialog}
          onOpenChange={(o) => !o && setShowAgreeDialog(false)}
          icon={Info}
          iconClassName="text-blue-500"
          title="I Agree"
          description={
            <div className="whitespace-pre-line text-sm text-muted-foreground">
              {AGREE_MESSAGE}
            </div>
          }
          confirmLabel="I Agree & Continue"
          onConfirm={handleAgreeAndContinue}
          cancelLabel="Cancel"
          onCancel={() => setShowAgreeDialog(false)}
        />

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Meeting"
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
