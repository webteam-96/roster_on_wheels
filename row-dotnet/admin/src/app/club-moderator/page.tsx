"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getModeratorYearSummary, getModeratorProjects, moderatorApproveProject, moderatorRejectProject, getModeratorProjectDetail, getPhotoUrl } from "@/services/api";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { formatMoney } from "@/lib/currency";
import { CheckCircle2, XCircle, Clock, MoreHorizontal, ArrowLeft, Building2, FileText } from "lucide-react";
import Link from "next/link";

interface YearSummary {
  yearId: number;
  yearLabel: string;
  isCurrent: boolean;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalCount: number;
}

interface ProjectItem {
  projectId: number;
  title: string;
  description: string | null;
  projectDate: string | null;
  projectCost: number | null;
  directBeneficiaries: number | null;
  manHours: number | null;
  location: string | null;
  approvalStatus: string;
  approvalRemark: string | null;
  approvalDate: string | null;
  createdDate: string;
  moduleName: string;
  clubName: string;
  createdByName: string;
}

export default function ClubModeratorPage() {
  const {
    isClubModerator,
    isAuthenticated,
    loading: authLoading,
    // Other role flags — used to decide whether to show the back button.
    // ClubModerator-only users have no other dashboard to return to.
    isSuperAdmin,
    isAdmin,
    isAG,
    isZonalCoordinator,
    isRIDirector,
  } = useAuth();
  const hasOtherDashboardRole = isSuperAdmin || isAdmin || isAG || isZonalCoordinator || isRIDirector;
  const [yearSummaries, setYearSummaries] = useState<YearSummary[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Action dialogs
  const [actionDialog, setActionDialog] = useState<{ type: "approve" | "reject"; project: ProjectItem } | null>(null);
  const [actionRemark, setActionRemark] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Detail dialog
  const [detailProject, setDetailProject] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const currentSummary = yearSummaries.find(y => String(y.yearId) === selectedYearId);

  const loadYears = useCallback(async () => {
    try {
      const data = await getModeratorYearSummary();
      setYearSummaries(data);
      const current = data.find((y: YearSummary) => y.isCurrent);
      if (current) setSelectedYearId(String(current.yearId));
      else if (data.length > 0) setSelectedYearId(String(data[0].yearId));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load year data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async (yearId: string, status: string, moduleKey: string, pg: number) => {
    if (!yearId) return;
    setProjectsLoading(true);
    try {
      const result = await getModeratorProjects(Number(yearId), status === "all" ? undefined : status, pg, 20, moduleKey === "all" ? undefined : moduleKey);
      setProjects(result.items || []);
      setTotalCount(result.totalCount || 0);
      setTotalPages(result.totalPages || 1);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load projects.");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => { loadYears(); }, [loadYears]);

  useEffect(() => {
    if (selectedYearId) loadProjects(selectedYearId, statusFilter, moduleFilter, page);
  }, [selectedYearId, statusFilter, moduleFilter, page, loadProjects]);

  const handleAction = async () => {
    if (!actionDialog) return;
    if (actionDialog.type === "reject" && !actionRemark.trim()) {
      setErrorMessage("Remark is required for rejection.");
      return;
    }
    setActionLoading(true);
    try {
      const yId = selectedYearId ? Number(selectedYearId) : undefined;
      if (actionDialog.type === "approve") {
        await moderatorApproveProject(actionDialog.project.projectId, actionRemark || undefined, yId);
        setSuccessMessage("Project approved successfully.");
      } else {
        await moderatorRejectProject(actionDialog.project.projectId, actionRemark, yId);
        setSuccessMessage("Project rejected.");
      }
      setActionDialog(null);
      setActionRemark("");
      loadProjects(selectedYearId, statusFilter, moduleFilter, page);
      loadYears();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to process action.");
    } finally {
      setActionLoading(false);
    }
  };

  // Legacy migrated rows may store "Pending For Approval" / "Approved" / "Rejected" in different casings —
  // normalize before matching so the badge + action buttons work for both new and old data.
  const normalizeStatus = (s: string | null | undefined): string => {
    if (!s) return "";
    const v = s.trim().toLowerCase();
    if (v.includes("pending")) return "pending";
    if (v.includes("reject")) return "rejected";
    if (v.includes("approv")) return "approved";
    return v;
  };

  const statusBadge = (status: string) => {
    switch (normalizeStatus(status)) {
      case "pending": return <Badge className="bg-amber-500 text-white"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "approved": return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
      case "rejected": return <Badge className="bg-red-600 text-white"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (authLoading || loading) {
    return <ProtectedRoute><div className="flex justify-center items-center py-20"><RotaryLoader size="lg" /></div></ProtectedRoute>;
  }

  if (!isClubModerator) {
    return <ProtectedRoute><div className="flex flex-col items-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3><p className="text-muted-foreground mt-2">Only Club Moderators can access this page.</p></div></ProtectedRoute>;
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          {/* Back arrow hidden for ClubModerator-only users — they have no other
              dashboard to return to. Shown only when the user also holds a
              role with its own home (SA / Admin / AG / ZC / RID). */}
          {hasOtherDashboardRole && (
            <Button variant="outline" size="icon" asChild>
              <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
          )}
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Project Approvals</h2>
            <p className="text-muted-foreground text-base">Review and approve/reject projects from your assigned clubs</p>
          </div>
        </div>

        {/* Summary cards */}
        {currentSummary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="border-amber-200 bg-amber-50/50 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setStatusFilter("pending"); setPage(1); }}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-amber-600">{currentSummary.pendingCount}</p>
                <p className="text-sm text-amber-700">Pending</p>
              </CardContent>
            </Card>
            <Card className="border-green-200 bg-green-50/50 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setStatusFilter("approved"); setPage(1); }}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{currentSummary.approvedCount}</p>
                <p className="text-sm text-green-700">Approved</p>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50/50 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setStatusFilter("rejected"); setPage(1); }}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{currentSummary.rejectedCount}</p>
                <p className="text-sm text-red-700">Rejected</p>
              </CardContent>
            </Card>
            <Card className="border-primary/20 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setStatusFilter("all"); setPage(1); }}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">{currentSummary.totalCount}</p>
                <p className="text-sm text-muted-foreground">Total</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty-state: backend returns an empty year-summary list when no
            project in any of the moderator's clubs has a non-null
            approval_status. Without this fallback the entire page renders
            blank below the header — which looks like the dashboard is
            broken when it's really just an empty queue. */}
        {!currentSummary && yearSummaries.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
            <FileText className="h-10 w-10 mx-auto text-slate-400" />
            <h3 className="mt-4 text-base font-semibold text-slate-700">
              No projects are waiting for your review
            </h3>
            <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
              When a Club Admin or member of your assigned club adds or edits a project in
              Community / Vocational / International / New Generation / Public Image Initiative,
              it will appear here for your approval.
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={selectedYearId} onValueChange={(v) => { setSelectedYearId(v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select Year" /></SelectTrigger>
            <SelectContent>
              {yearSummaries.map(y => (
                <SelectItem key={y.yearId} value={String(y.yearId)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              <SelectItem value="community_service">Community Service</SelectItem>
              <SelectItem value="vocational_service">Vocational Service</SelectItem>
              <SelectItem value="international_service">International Service</SelectItem>
              <SelectItem value="new_generation_service">New Generation Service</SelectItem>
              <SelectItem value="public_image_initiative">Public Image Initiative</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Projects table */}
        {projectsLoading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No projects found</h3>
            <p className="text-muted-foreground mt-2">No projects match the selected filters.</p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">#</TableHead>
                    <TableHead className="text-primary-foreground">Club</TableHead>
                    <TableHead className="text-primary-foreground">Project</TableHead>
                    <TableHead className="text-primary-foreground hidden md:table-cell">Module</TableHead>
                    <TableHead className="text-primary-foreground hidden md:table-cell">Date</TableHead>
                    <TableHead className="text-primary-foreground">Status</TableHead>
                    <TableHead className="text-primary-foreground w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p, i) => (
                    <TableRow key={p.projectId} className="hover:bg-primary/5 cursor-pointer" onClick={async () => {
                      setDetailLoading(true); setDetailProject(null);
                      try { const d = await getModeratorProjectDetail(p.projectId, selectedYearId ? Number(selectedYearId) : undefined); setDetailProject(d); }
                      catch { setDetailProject(p); }
                      finally { setDetailLoading(false); }
                    }}>
                      <TableCell>{(page - 1) * 20 + i + 1}</TableCell>
                      <TableCell className="font-medium">{p.clubName}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-primary">{p.title}</p>
                          <p className="text-xs text-muted-foreground">by {p.createdByName}</p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{p.moduleName}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm">{p.projectDate ? new Date(p.projectDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell>{statusBadge(p.approvalStatus)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {normalizeStatus(p.approvalStatus) === "pending" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setActionDialog({ type: "approve", project: p }); setActionRemark(""); }}>
                                <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setActionDialog({ type: "reject", project: p }); setActionRemark(""); }}>
                                <XCircle className="mr-2 h-4 w-4 text-red-600" />Reject
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={20} onPageChange={setPage} />
          </>
        )}

        {/* Action Dialog */}
        <Dialog open={!!actionDialog} onOpenChange={(open) => { if (!open) { setActionDialog(null); setActionRemark(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {actionDialog?.type === "approve" ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                {actionDialog?.type === "approve" ? "Approve" : "Reject"} Project
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border p-3 bg-muted/30">
                <p className="font-semibold">{actionDialog?.project.title}</p>
                <p className="text-sm text-muted-foreground">{actionDialog?.project.clubName} - {actionDialog?.project.moduleName}</p>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Remark {actionDialog?.type === "reject" ? <span className="text-destructive">*</span> : "(Optional)"}
                </label>
                <Textarea
                  value={actionRemark}
                  onChange={(e) => setActionRemark(e.target.value)}
                  placeholder="Enter your remark..."
                  rows={3}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setActionDialog(null); setActionRemark(""); }}>Cancel</Button>
              <Button
                onClick={handleAction}
                disabled={actionLoading}
                className={actionDialog?.type === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              >
                {actionLoading ? <RotaryLoader size="sm" /> : actionDialog?.type === "approve" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail Dialog */}
        <Dialog open={!!detailProject || detailLoading} onOpenChange={(open) => { if (!open) { setDetailProject(null); setDetailLoading(false); } }}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Project Details</DialogTitle>
            </DialogHeader>
            {detailLoading ? (
              <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
            ) : detailProject && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg text-primary">{detailProject.title}</h3>
                  {statusBadge(detailProject.approvalStatus)}
                </div>

                {/* Project Info */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm rounded-lg border p-4 bg-muted/30">
                  <div><span className="text-muted-foreground">Club:</span> <span className="font-medium">{detailProject.clubName}</span></div>
                  <div><span className="text-muted-foreground">District:</span> <span className="font-medium">{detailProject.districtNumber || "—"}</span></div>
                  <div><span className="text-muted-foreground">Module:</span> <span className="font-medium">{detailProject.moduleName}</span></div>
                  <div><span className="text-muted-foreground">Type:</span> <span className="font-medium">{detailProject.projectType === "ongoing_repeat" ? "Ongoing/Repeat" : "One Time"}</span></div>
                  <div><span className="text-muted-foreground">Date:</span> {detailProject.projectDate ? new Date(detailProject.projectDate).toLocaleDateString() : "—"}</div>
                  <div><span className="text-muted-foreground">Cost:</span> {detailProject.projectCost != null ? formatMoney(Number(detailProject.projectCost), detailProject.currency) : "—"}</div>
                  <div><span className="text-muted-foreground">Beneficiaries:</span> {detailProject.directBeneficiaries ?? "—"}</div>
                  <div><span className="text-muted-foreground">Man Hours:</span> {detailProject.manHours ?? "—"}</div>
                  <div><span className="text-muted-foreground">Rotarians:</span> {detailProject.rotariansInvolved ?? "—"}</div>
                  <div><span className="text-muted-foreground">Rotaractors:</span> {detailProject.rotaractorsInvolved ?? "—"}</div>
                  <div><span className="text-muted-foreground">RCC:</span> {detailProject.rccInvolved ?? "—"}</div>
                  {detailProject.location && <div className="col-span-2"><span className="text-muted-foreground">Location:</span> {detailProject.location}</div>}
                  {detailProject.areaOfFocusName && <div className="col-span-2"><span className="text-muted-foreground">Area of Focus:</span> {detailProject.areaOfFocusName}</div>}
                  {detailProject.categoryName && <div><span className="text-muted-foreground">Category:</span> {detailProject.categoryName}</div>}
                  {detailProject.subCategoryName && <div><span className="text-muted-foreground">Sub Category:</span> {detailProject.subCategoryName}</div>}
                  {detailProject.fundingName && <div><span className="text-muted-foreground">Funding:</span> {detailProject.fundingName}</div>}
                  {detailProject.isJointProject && <div><span className="text-muted-foreground">Co-host:</span> {detailProject.coHostName} ({detailProject.clubRole})</div>}
                </div>

                {/* Description */}
                {detailProject.description && (
                  <div className="text-sm rounded-lg border p-4">
                    <p className="font-medium text-muted-foreground mb-1">Description</p>
                    <p>{detailProject.description}</p>
                  </div>
                )}

                {/* Photos */}
                {detailProject.photos && detailProject.photos.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Photos ({detailProject.photos.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {detailProject.photos.map((photo: any, i: number) => (
                        <div key={i} className="relative h-24 w-32 rounded-lg overflow-hidden border bg-muted">
                          <Image src={getPhotoUrl(photo.imagePath) || ""} alt={photo.description || `Photo ${i + 1}`} fill className="object-cover" unoptimized />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Submitted By */}
                <div className="rounded-lg border p-4 bg-blue-50/50">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Submitted By</p>
                  <div className="flex items-center gap-3">
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-muted border">
                      {detailProject.adminPhoto ? (
                        <Image src={getPhotoUrl(detailProject.adminPhoto) || ""} alt={detailProject.adminName} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary text-sm font-bold">
                          {(detailProject.adminName || "?")[0]}
                        </div>
                      )}
                    </div>
                    <div className="text-sm">
                      <p className="font-semibold">{detailProject.adminName || "—"}</p>
                      <p className="text-muted-foreground">{[detailProject.adminEmail, detailProject.adminMobile].filter(Boolean).join(" | ") || "—"}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Submitted on {detailProject.createdDate ? new Date(detailProject.createdDate).toLocaleDateString() : "—"}</p>
                </div>

                {/* Approval Remark */}
                {detailProject.approvalRemark && (
                  <div className={`rounded-lg border p-3 text-sm ${detailProject.approvalStatus === "approved" ? "bg-green-50/50 border-green-200" : "bg-red-50/50 border-red-200"}`}>
                    <span className="text-muted-foreground">Moderator Remark:</span> <p className="mt-1">{detailProject.approvalRemark}</p>
                    {detailProject.approvalDate && <p className="text-xs text-muted-foreground mt-1">on {new Date(detailProject.approvalDate).toLocaleDateString()}</p>}
                  </div>
                )}

                {/* Approve/Reject buttons */}
                {normalizeStatus(detailProject.approvalStatus) === "pending" && (
                  <div className="flex gap-2 pt-2">
                    <Button className="bg-green-600 hover:bg-green-700 flex-1" onClick={() => { const p = detailProject; setDetailProject(null); setActionDialog({ type: "approve", project: p }); setActionRemark(""); }}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />Approve
                    </Button>
                    <Button className="bg-red-600 hover:bg-red-700 flex-1" onClick={() => { const p = detailProject; setDetailProject(null); setActionDialog({ type: "reject", project: p }); setActionRemark(""); }}>
                      <XCircle className="mr-2 h-4 w-4" />Reject
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
