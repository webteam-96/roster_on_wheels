"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
  getZoneApprovalRequests,
  getZonalApprovalDetail,
  zonalApprove,
  zonalReject,
  getZoneDistricts,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import Pagination from "@/components/Pagination";
import ProtectedRoute from "@/components/ProtectedRoute";
import { formatMoney } from "@/lib/currency";
import {
  Eye,
  CheckCircle,
  XCircle,
  ArrowLeft,
} from "@/components/icons";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Link from "next/link";

import { appLocale } from "@/lib/appFormat";
interface ApprovalItem {
  id: number;
  projectId: number;
  requestedBeneficiaries: number;
  currentLimit: number;
  approvalToken: string;
  status: string;
  remark: string | null;
  respondedDate: string | null;
  createdDate: string;
  projectTitle: string;
  projectDate: string | null;
  clubName: string;
  districtNumber: string;
  requestedByName: string;
}

interface ApprovalDetail {
  id: number;
  projectId: number;
  requestedBeneficiaries: number;
  currentLimit: number;
  approvalToken: string;
  status: string;
  remark: string | null;
  createdDate: string;
  projectTitle: string;
  projectDescription: string | null;
  projectDate: string | null;
  projectCost: number | null;
  currency?: string | null;
  currentBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  rccInvolved: number | null;
  clubName: string;
  districtNumber: string;
  zoneName: string;
  requestedByName: string;
  requestedByEmail: string;
  requestedByMobile: string;
  photoUrls: string[];
}

interface ZonalDistrict {
  id: number;
  districtNumber: string;
  districtName: string;
}

export default function ZoneDirectBeneficiariesPage() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isSuperAdmin } = useAuth();
  const zoneId = Number(params.id);

  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Districts for filter
  const [districts, setDistricts] = useState<ZonalDistrict[]>([]);
  const [districtFilter, setDistrictFilter] = useState(0);

  // Approval requests
  const [approvalItems, setApprovalItems] = useState<ApprovalItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const pageSize = 20;

  // View detail dialog
  const [viewDetail, setViewDetail] = useState<ApprovalDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Approve/Reject dialog
  const [actionDialog, setActionDialog] = useState<{
    type: "approve" | "reject";
    item: ApprovalItem;
  } | null>(null);
  const [actionRemark, setActionRemark] = useState("");
  const [actionSaving, setActionSaving] = useState(false);

  // Load districts
  useEffect(() => {
    if (!zoneId) return;
    getZoneDistricts(zoneId)
      .then((ds) => setDistricts([...ds].sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true }))))
      .catch(() => {});
  }, [zoneId]);

  // Load approval requests
  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const filterVal = statusFilter === "all" ? undefined : statusFilter;
      const data = await getZoneApprovalRequests(zoneId, filterVal, page, pageSize, districtFilter);
      setApprovalItems(data.items);
      setTotalCount(data.totalCount);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [zoneId, page, statusFilter, districtFilter]);

  useEffect(() => {
    if (zoneId) fetchApprovals();
  }, [fetchApprovals, zoneId]);

  const handleView = async (item: ApprovalItem) => {
    setViewLoading(true);
    try {
      const detail = await getZonalApprovalDetail(item.approvalToken);
      setViewDetail(detail);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load details.");
    } finally {
      setViewLoading(false);
    }
  };

  const handleAction = async () => {
    if (!actionDialog) return;
    if (actionDialog.type === "reject" && !actionRemark.trim()) {
      setErrorMessage("Remark is required when rejecting.");
      return;
    }

    setActionSaving(true);
    try {
      if (actionDialog.type === "approve") {
        await zonalApprove(actionDialog.item.id, actionRemark || undefined);
        setSuccessMessage("Approved successfully. Beneficiaries updated.");
      } else {
        await zonalReject(actionDialog.item.id, actionRemark);
        setSuccessMessage("Rejected successfully.");
      }
      setActionDialog(null);
      setActionRemark("");
      fetchApprovals();
    } catch {
      setErrorMessage(`Failed to ${actionDialog.type} the request.`);
    } finally {
      setActionSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Pending</span>;
      case "approved":
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Approved</span>;
      case "rejected":
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Rejected</span>;
      default:
        return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
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
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              Direct Beneficiaries
            </h2>
            <p className="text-muted-foreground">
              Approval requests for this zone
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            {districts.length > 0 && (
              <Select
                value={String(districtFilter)}
                onValueChange={(v) => {
                  setDistrictFilter(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">All Districts</SelectItem>
                  {districts.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.districtNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RotaryLoader size="lg" />
            </div>
          ) : approvalItems.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No approval requests found.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project Title</TableHead>
                      <TableHead>Club</TableHead>
                      <TableHead>District</TableHead>
                      <TableHead className="text-right">Limit</TableHead>
                      <TableHead className="text-right">Requested</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {approvalItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {item.projectTitle}
                        </TableCell>
                        <TableCell>{item.clubName}</TableCell>
                        <TableCell>{item.districtNumber}</TableCell>
                        <TableCell className="text-right">{item.currentLimit}</TableCell>
                        <TableCell className="text-right font-semibold text-red-600">
                          {item.requestedBeneficiaries}
                        </TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-sm">
                          {new Date(item.createdDate).toLocaleDateString(appLocale(), {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell>{item.requestedByName}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleView(item)}
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {item.status === "pending" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => {
                                    setActionDialog({ type: "approve", item });
                                    setActionRemark("");
                                  }}
                                  title="Approve"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => {
                                    setActionDialog({ type: "reject", item });
                                    setActionRemark("");
                                  }}
                                  title="Reject"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4">
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    totalCount={totalCount}
                    pageSize={pageSize}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* View Detail Dialog */}
        <Dialog open={!!viewDetail} onOpenChange={() => setViewDetail(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Approval Request Details</DialogTitle>
              <DialogDescription>
                {viewDetail?.projectTitle}
              </DialogDescription>
            </DialogHeader>
            {viewDetail && (
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status:</span>
                  {getStatusBadge(viewDetail.status)}
                </div>

                <div>
                  <h4 className="font-semibold text-base mb-2">Project Details</h4>
                  <div className="grid grid-cols-2 gap-2 bg-muted/30 rounded-lg p-3">
                    <div><span className="text-muted-foreground">Title:</span> <span className="font-medium">{viewDetail.projectTitle}</span></div>
                    <div><span className="text-muted-foreground">Date:</span> {viewDetail.projectDate ? new Date(viewDetail.projectDate).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "–"}</div>
                    <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {viewDetail.projectDescription || "–"}</div>
                    <div><span className="text-muted-foreground">Cost:</span> {viewDetail.projectCost != null ? formatMoney(viewDetail.projectCost, viewDetail.currency) : "–"}</div>
                    <div><span className="text-muted-foreground">Man Hours:</span> {viewDetail.manHours ?? "–"}</div>
                    <div><span className="text-muted-foreground">Rotarians:</span> {viewDetail.rotariansInvolved ?? "–"}</div>
                    <div><span className="text-muted-foreground">Rotaractors:</span> {viewDetail.rotaractorsInvolved ?? "–"}</div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-base mb-2">Beneficiary Details</h4>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className="text-muted-foreground">Set Limit:</span> <span className="font-semibold">{viewDetail.currentLimit}</span></div>
                      <div><span className="text-muted-foreground">Requested:</span> <span className="font-semibold text-red-600">{viewDetail.requestedBeneficiaries}</span></div>
                    </div>
                  </div>
                </div>

                {viewDetail.remark && (
                  <div>
                    <h4 className="font-semibold text-base mb-2">Remark</h4>
                    <p className="bg-muted/30 rounded-lg p-3">{viewDetail.remark}</p>
                  </div>
                )}

                {viewDetail.photoUrls.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-base mb-2">Project Photos</h4>
                    <div className="flex flex-wrap gap-2">
                      {viewDetail.photoUrls.map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt={`Photo ${i + 1}`}
                          className="h-32 w-40 object-cover rounded-lg border"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="font-semibold text-base mb-2">Club & Admin Details</h4>
                  <div className="grid grid-cols-2 gap-2 bg-muted/30 rounded-lg p-3">
                    <div><span className="text-muted-foreground">District:</span> {viewDetail.districtNumber}</div>
                    <div><span className="text-muted-foreground">Club:</span> {viewDetail.clubName}</div>
                    <div><span className="text-muted-foreground">Admin:</span> {viewDetail.requestedByName}</div>
                    <div><span className="text-muted-foreground">Mobile:</span> {viewDetail.requestedByMobile}</div>
                    <div><span className="text-muted-foreground">Email:</span> {viewDetail.requestedByEmail}</div>
                  </div>
                </div>

                {viewDetail.status === "pending" && (
                  <div className="flex gap-3 justify-end pt-2">
                    <Button
                      variant="outline"
                      className="border-green-500 text-green-600 hover:bg-green-50"
                      onClick={() => {
                        const token = viewDetail.approvalToken;
                        setViewDetail(null);
                        const item = approvalItems.find(a => a.approvalToken === token);
                        if (item) {
                          setActionDialog({ type: "approve", item });
                          setActionRemark("");
                        }
                      }}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="border-red-500 text-red-600 hover:bg-red-50"
                      onClick={() => {
                        const token = viewDetail.approvalToken;
                        setViewDetail(null);
                        const item = approvalItems.find(a => a.approvalToken === token);
                        if (item) {
                          setActionDialog({ type: "reject", item });
                          setActionRemark("");
                        }
                      }}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Approve/Reject Action Dialog */}
        <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {actionDialog?.type === "approve" ? "Approve" : "Reject"} Request
              </DialogTitle>
              <DialogDescription>
                {actionDialog?.item.projectTitle}: {actionDialog?.item.clubName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Set Limit:</span>{" "}
                  <span className="font-semibold">{actionDialog?.item.currentLimit}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Requested:</span>{" "}
                  <span className="font-semibold text-red-600">
                    {actionDialog?.item.requestedBeneficiaries}
                  </span>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Remark{" "}
                  {actionDialog?.type === "reject" ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-muted-foreground">(Optional)</span>
                  )}
                </label>
                <Textarea
                  value={actionRemark}
                  onChange={(e) => setActionRemark(e.target.value)}
                  placeholder="Enter your remark..."
                  rows={3}
                />
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setActionDialog(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAction}
                  disabled={actionSaving}
                  className={
                    actionDialog?.type === "approve"
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-red-600 hover:bg-red-700"
                  }
                >
                  {actionSaving
                    ? "Processing..."
                    : actionDialog?.type === "approve"
                    ? "Confirm Approve"
                    : "Confirm Reject"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {viewLoading && (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
            <RotaryLoader size="lg" />
          </div>
        )}

        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
