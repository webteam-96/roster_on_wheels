"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectListItem } from "@/types/project";
import {
  getClub,
  getModules,
  getProjects,
  deleteProject,
  getProjectYears,
  checkClubHasModerator,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  ChevronDown, ChevronRight,
  Clock, CheckCircle2, XCircle,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
const AGREE_MESSAGE = `The data I will enter is for a Public Image Initiative conducted by my club. E.g., Hoardings, Marathons, Rotary Stories on News Papers / Radio / TV ads, etc.

Please Note: The content posted here will be displayed on the ROW Website, District Website, Club Monthly Report & ROW Integrated Club Website`;

export default function PublicImageInitiativePage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const moduleKey = "public_image_initiative";
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

  const [projectTypeFilter, setProjectTypeFilter] = useState<string>("all");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // I Agree dialog
  const [showAgreeDialog, setShowAgreeDialog] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [hasModerator, setHasModerator] = useState(false);

  // Expanded ongoing parents (show child projects)
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());

  const canManage = isSuperAdmin || isAdmin;

  // Fetch club, module, then years (needs moduleId)
  useEffect(() => {
    async function init() {
      try {
        const [club, modules] = await Promise.all([
          getClub(clubId),
          getModules(),
        ]);
        setClubName(club.clubName);
        const mod = modules.find(m => m.moduleKey === moduleKey);
        if (mod) {
          setModuleId(mod.id);
          const projectYears = await getProjectYears(clubId, mod.id);
          setYears(projectYears);
          const currentYear = projectYears.find(y => y.isCurrent);
          setSelectedYearId(currentYear ? currentYear.id : projectYears.length > 0 ? projectYears[0].id : null);
        }
        checkClubHasModerator(clubId).then(r => setHasModerator(r.hasModerator)).catch(() => {});
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

  // Separate parent/one-time projects from child projects
  const parentProjects = projects.filter(p => !(p.parentProjectId != null && p.parentProjectId > 0));
  const childProjectsMap = new Map<number, ProjectListItem[]>();
  projects.forEach(p => {
    if (p.parentProjectId != null && p.parentProjectId > 0) {
      const existing = childProjectsMap.get(p.parentProjectId) || [];
      existing.push(p);
      childProjectsMap.set(p.parentProjectId, existing);
    }
  });

  // Apply type filter on parent projects only
  const typeFilteredProjects = projectTypeFilter === "all"
    ? parentProjects
    : parentProjects.filter(p => p.projectType === projectTypeFilter);

  const toggleExpand = (projectId: number) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleAddClick = () => {
    if (AGREE_MESSAGE) {
      setShowAgreeDialog(true);
    } else {
      router.push(`/clubs/${clubId}/public-image-initiative/add?yearId=${selectedYearId}`);
    }
  };

  const handleAgreeAndContinue = () => {
    setShowAgreeDialog(false);
    router.push(`/clubs/${clubId}/public-image-initiative/add?yearId=${selectedYearId}`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProject(clubId, selectedYearId ?? 0, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Project deleted successfully.");
      fetchProjects();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete project.");
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  };

  const renderProjectRow = (project: ProjectListItem, index: number, isChild = false) => {
    const childCount = childProjectsMap.get(project.id)?.length || 0;
    const isOngoingParent = project.projectType === "ongoing_repeat" && !(project.parentProjectId != null && project.parentProjectId > 0);
    const isExpanded = expandedParents.has(project.id);

    return (
      <TableRow key={project.id} className={isChild ? "bg-muted/30" : ""}>
        <TableCell className="font-medium">
          {isChild ? "" : (page - 1) * pageSize + index + 1}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {isChild && <span className="text-muted-foreground ml-2">&#8627;</span>}
            {project.primaryPhotoPath && (
              <img
                src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}${project.primaryPhotoPath}`}
                alt=""
                className="h-10 w-10 rounded object-cover"
              />
            )}
            <div>
              <p className="font-medium">{project.title}</p>
            </div>
          </div>
        </TableCell>
        <TableCell>
          {project.projectType === "one_time" ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">One Time</span>
          ) : isChild ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Child</span>
          ) : (
            <button
              onClick={() => childCount > 0 && toggleExpand(project.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
            >
              Ongoing
              {childCount > 0 && (
                <>
                  <span className="bg-green-600 text-white rounded-full px-1.5 py-0 text-[10px] ml-0.5">{childCount}</span>
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </>
              )}
            </button>
          )}
        </TableCell>
        <TableCell>{project.areaOfFocusName || project.otherAreaOfFocus || "-"}</TableCell>
        <TableCell>{formatDate(project.projectDate)}</TableCell>
        <TableCell>{project.location || "-"}</TableCell>
        <TableCell className="text-right">{project.projectCost?.toLocaleString(appLocale()) || "-"}</TableCell>
        <TableCell>
          {project.approvalStatus === "pending" ? <Badge className="bg-amber-500 text-white text-xs"><Clock className="h-3 w-3 mr-1" />Pending</Badge>
           : project.approvalStatus === "approved" ? <Badge className="bg-green-600 text-white text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>
           : project.approvalStatus === "rejected" ? <Badge className="bg-red-600 text-white text-xs"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>
           : null}
        </TableCell>
        {canManage && (
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/public-image-initiative/${project.id}?yearId=${selectedYearId}`)}>
                  <Eye className="mr-2 h-4 w-4" />View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/public-image-initiative/${project.id}/edit?yearId=${selectedYearId}`)}>
                  <Pencil className="mr-2 h-4 w-4" />Edit
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(project)}>
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
                {isOngoingParent && childCount > 0 && (
                  <DropdownMenuItem onClick={() => toggleExpand(project.id)}>
                    {isExpanded ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                    {isExpanded ? "Hide" : "Show"} Child Projects ({childCount})
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        )}
      </TableRow>
    );
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
                {clubName ? `${clubName} - Public Image Initiative` : "Public Image Initiative"}
              </h2>
              <p className="text-muted-foreground text-base">Manage public image initiative projects</p>
            </div>
          </div>
          {canManage && (
            <Button onClick={handleAddClick}>
              <Plus className="mr-2 h-4 w-4" />Add Project
            </Button>
          )}
        </div>

        {/* Year selector + Type filter + Search */}
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
          <div className="w-full sm:w-48">
            <Select
              value={projectTypeFilter}
              onValueChange={(v) => setProjectTypeFilter(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Project type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                <SelectItem value="one_time">One Time Projects</SelectItem>
                <SelectItem value="ongoing_repeat">Ongoing Projects</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title or location..."
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
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && typeFilteredProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No projects found</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No projects match your search." : canManage ? `Click "Add Project" to create one.` : "No projects for this year."}
            </p>
          </div>
        )}

        {!loading && typeFilteredProjects.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12 text-primary-foreground text-base font-semibold">S.No.</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Title</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Type</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Category</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Date</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Location</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold text-right">Cost (&#8377;)</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Status</TableHead>
                    {canManage && (
                      <TableHead className="w-12 text-primary-foreground"></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {typeFilteredProjects.map((project, index) => (
                    <Fragment key={project.id}>
                      {renderProjectRow(project, index)}
                      {expandedParents.has(project.id) && childProjectsMap.get(project.id)?.map((child) => (
                        renderProjectRow(child, 0, true)
                      ))}
                    </Fragment>
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
          title="Delete Project"
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
