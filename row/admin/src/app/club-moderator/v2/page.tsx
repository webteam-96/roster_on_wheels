"use client";

/**
 * Club Moderator — Project Approvals (V2).
 *
 * A faithful port of the V1 page at src/app/club-moderator/page.tsx, restyled to
 * the v2 navy/gold design used across the District/Club Admin dashboards. Same
 * data + behaviour: year summary cards, Year/Module/Status filters, projects
 * table with row-click detail, and Approve/Reject dialogs. Uses the identical
 * moderator endpoints, so the backend approve/reject notification emails are
 * preserved automatically.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getModeratorYearSummary, getModeratorProjects, moderatorApproveProject, moderatorRejectProject, getModeratorProjectDetail, getPhotoUrl } from "@/services/api";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { formatMoney } from "@/lib/currency";
import { CheckCircle2, XCircle, Clock, MoreHorizontal, FileText } from "lucide-react";

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

export default function ClubModeratorV2Page() {
  // Guarding + the top bar (title, dashboard switcher, sign-out) are provided by
  // the shell in club-moderator/v2/layout.tsx, so this page renders content only.
  const { isClubModerator, loading: authLoading } = useAuth();

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

  // Legacy migrated rows may store the status in different casings — normalize before matching.
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

  const openDetail = async (p: ProjectItem) => {
    setDetailLoading(true); setDetailProject(null);
    try { const d = await getModeratorProjectDetail(p.projectId, selectedYearId ? Number(selectedYearId) : undefined); setDetailProject(d); }
    catch { setDetailProject(p); }
    finally { setDetailLoading(false); }
  };

  if (authLoading || loading) {
    return <div className="flex justify-center items-center py-20"><RotaryLoader size="lg" /></div>;
  }

  if (!isClubModerator) {
    return <div className="flex flex-col items-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3><p className="text-muted-foreground mt-2">Only Club Moderators can access this page.</p></div>;
  }

  return (
    <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <p className="text-slate-600 text-sm">Review and approve / reject projects from your assigned clubs.</p>

        {/* Summary cards */}
        {currentSummary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => { setStatusFilter("pending"); setPage(1); }}
              className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "pending" ? "border-amber-400 ring-1 ring-amber-300" : "border-slate-200"}`}
            >
              <p className="text-2xl font-bold text-amber-600 tabular-nums">{currentSummary.pendingCount}</p>
              <p className="text-sm font-medium text-amber-700">Pending</p>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("approved"); setPage(1); }}
              className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "approved" ? "border-green-400 ring-1 ring-green-300" : "border-slate-200"}`}
            >
              <p className="text-2xl font-bold text-green-600 tabular-nums">{currentSummary.approvedCount}</p>
              <p className="text-sm font-medium text-green-700">Approved</p>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("rejected"); setPage(1); }}
              className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "rejected" ? "border-red-400 ring-1 ring-red-300" : "border-slate-200"}`}
            >
              <p className="text-2xl font-bold text-red-600 tabular-nums">{currentSummary.rejectedCount}</p>
              <p className="text-sm font-medium text-red-700">Rejected</p>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("all"); setPage(1); }}
              className={`rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:shadow-md ${statusFilter === "all" ? "border-[#1e3a5f] ring-1 ring-[#1e3a5f]/30" : "border-slate-200"}`}
            >
              <p className="text-2xl font-bold text-[#1e3a5f] tabular-nums">{currentSummary.totalCount}</p>
              <p className="text-sm font-medium text-slate-500">Total</p>
            </button>
          </div>
        )}

        {/* Empty-state when there are no projects awaiting review in any year. */}
        {!currentSummary && yearSummaries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
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
        <div className="flex flex-wrap gap-3 items-center bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <Select value={selectedYearId} onValueChange={(v) => { setSelectedYearId(v); setPage(1); }}>
            <SelectTrigger className="w-48 bg-white border-slate-200"><SelectValue placeholder="Select Year" /></SelectTrigger>
            <SelectContent>
              {yearSummaries.map(y => (
                <SelectItem key={y.yearId} value={String(y.yearId)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-52 bg-white border-slate-200"><SelectValue /></SelectTrigger>
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
            <SelectTrigger className="w-40 bg-white border-slate-200"><SelectValue /></SelectTrigger>
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
          <div className="flex flex-col items-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <FileText className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">No projects found</h3>
            <p className="text-slate-500 mt-2">No projects match the selected filters.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left w-12">#</th>
                    <th className="px-4 py-3 text-left">Club</th>
                    <th className="px-4 py-3 text-left">Project</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Module</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Date</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">Approved / Rejected On</th>
                    <th className="px-4 py-3 text-right w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projects.map((p, i) => (
                    <tr key={p.projectId} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => openDetail(p)}>
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{p.clubName}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[#1e3a5f]">{p.title}</p>
                        <p className="text-xs text-slate-500">by {p.createdByName}</p>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-sm text-slate-500">{p.moduleName}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-sm text-slate-600 whitespace-nowrap">{p.projectDate ? new Date(p.projectDate).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-2.5">{statusBadge(p.approvalStatus)}</td>
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap">
                        {normalizeStatus(p.approvalStatus) === "approved" ? (
                          <span className="text-green-700">{p.approvalDate ? new Date(p.approvalDate).toLocaleString("en-IN") : "—"}</span>
                        ) : normalizeStatus(p.approvalStatus) === "rejected" ? (
                          <span className="text-red-700">{p.approvalDate ? new Date(p.approvalDate).toLocaleString("en-IN") : "—"}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={20} onPageChange={setPage} />
          </>
        )}

        {/* Action Dialog */}
        <Dialog open={!!actionDialog} onOpenChange={(open) => { if (!open) { setActionDialog(null); setActionRemark(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#1e3a5f]">
                {actionDialog?.type === "approve" ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                {actionDialog?.type === "approve" ? "Approve" : "Reject"} Project
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                <p className="font-semibold text-slate-800">{actionDialog?.project.title}</p>
                <p className="text-sm text-slate-500">{actionDialog?.project.clubName} · {actionDialog?.project.moduleName}</p>
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
              <DialogTitle className="text-[#1e3a5f]">Project Details</DialogTitle>
            </DialogHeader>
            {detailLoading ? (
              <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
            ) : detailProject && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg text-[#1e3a5f]">{detailProject.title}</h3>
                  {statusBadge(detailProject.approvalStatus)}
                </div>

                {/* Project Info */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm rounded-lg border border-slate-200 p-4 bg-slate-50">
                  <div><span className="text-slate-500">Club:</span> <span className="font-medium">{detailProject.clubName}</span></div>
                  <div><span className="text-slate-500">District:</span> <span className="font-medium">{detailProject.districtNumber || "—"}</span></div>
                  <div><span className="text-slate-500">Module:</span> <span className="font-medium">{detailProject.moduleName}</span></div>
                  <div><span className="text-slate-500">Type:</span> <span className="font-medium">{detailProject.projectType === "ongoing_repeat" ? "Ongoing/Repeat" : "One Time"}</span></div>
                  <div><span className="text-slate-500">Date:</span> {detailProject.projectDate ? new Date(detailProject.projectDate).toLocaleDateString() : "—"}</div>
                  <div><span className="text-slate-500">Cost:</span> {detailProject.projectCost != null ? formatMoney(Number(detailProject.projectCost), detailProject.currency) : "—"}</div>
                  <div><span className="text-slate-500">Beneficiaries:</span> {detailProject.directBeneficiaries ?? "—"}</div>
                  <div><span className="text-slate-500">Man Hours:</span> {detailProject.manHours ?? "—"}</div>
                  <div><span className="text-slate-500">Rotarians:</span> {detailProject.rotariansInvolved ?? "—"}</div>
                  <div><span className="text-slate-500">Rotaractors:</span> {detailProject.rotaractorsInvolved ?? "—"}</div>
                  <div><span className="text-slate-500">RCC:</span> {detailProject.rccInvolved ?? "—"}</div>
                  {detailProject.location && <div className="col-span-2"><span className="text-slate-500">Location:</span> {detailProject.location}</div>}
                  {detailProject.areaOfFocusName && <div className="col-span-2"><span className="text-slate-500">Area of Focus:</span> {detailProject.areaOfFocusName}</div>}
                  {detailProject.categoryName && <div><span className="text-slate-500">Category:</span> {detailProject.categoryName}</div>}
                  {detailProject.subCategoryName && <div><span className="text-slate-500">Sub Category:</span> {detailProject.subCategoryName}</div>}
                  {detailProject.fundingName && <div><span className="text-slate-500">Funding:</span> {detailProject.fundingName}</div>}
                  {detailProject.isJointProject && <div><span className="text-slate-500">Co-host:</span> {detailProject.coHostName} ({detailProject.clubRole})</div>}
                </div>

                {/* Description */}
                {detailProject.description && (
                  <div className="text-sm rounded-lg border border-slate-200 p-4">
                    <p className="font-medium text-slate-500 mb-1">Description</p>
                    <p>{detailProject.description}</p>
                  </div>
                )}

                {/* Photos */}
                {detailProject.photos && detailProject.photos.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-slate-500 mb-2">Photos ({detailProject.photos.length})</p>
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
                <div className="rounded-lg border border-blue-200 p-4 bg-blue-50/50">
                  <p className="text-sm font-medium text-slate-500 mb-2">Submitted By</p>
                  <div className="flex items-center gap-3">
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-muted border">
                      {detailProject.adminPhoto ? (
                        <Image src={getPhotoUrl(detailProject.adminPhoto) || ""} alt={detailProject.adminName} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#1e3a5f]/10 text-[#1e3a5f] text-sm font-bold">
                          {(detailProject.adminName || "?")[0]}
                        </div>
                      )}
                    </div>
                    <div className="text-sm">
                      <p className="font-semibold">{detailProject.adminName || "—"}</p>
                      <p className="text-slate-500">{[detailProject.adminEmail, detailProject.adminMobile].filter(Boolean).join(" | ") || "—"}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Submitted on {detailProject.createdDate ? new Date(detailProject.createdDate).toLocaleDateString() : "—"}</p>
                </div>

                {/* Approval Remark */}
                {detailProject.approvalRemark && (
                  <div className={`rounded-lg border p-3 text-sm ${normalizeStatus(detailProject.approvalStatus) === "approved" ? "bg-green-50/50 border-green-200" : "bg-red-50/50 border-red-200"}`}>
                    <span className="text-slate-500">Moderator Remark:</span> <p className="mt-1">{detailProject.approvalRemark}</p>
                    {detailProject.approvalDate && <p className="text-xs text-slate-500 mt-1">on {new Date(detailProject.approvalDate).toLocaleDateString()}</p>}
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
  );
}
