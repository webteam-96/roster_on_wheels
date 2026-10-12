"use client";

import { useState, useCallback, useEffect } from "react";
import { CashfreeKyc, CashfreeVendorDetail } from "@/types/cashfreeKyc";
import {
  getCashfreeKycList,
  sendCashfreeOtp,
  verifyCashfreeOtpAndSave,
  deleteCashfreeKyc,
  toggleCashfreeKycActive,
  getCashfreeVendorDetail,
  refreshAllCashfreeStatus,
  refreshCashfreeVendorStatus,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, Eye, RefreshCw, CreditCard, MoreHorizontal, AlertTriangle } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function getStatusBadgeVariant(status: string): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "ACTIVE": return "default";
    case "BANK_VALIDATION_FAILED": return "destructive";
    case "PENDING": return "outline";
    default: return "secondary";
  }
}

export default function CashfreeKycPage() {
  const { isSuperAdmin } = useAuth();

  const [items, setItems] = useState<CashfreeKyc[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Add/Edit form state
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CashfreeKyc | null>(null);
  const [formVendorId, setFormVendorId] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAccountHolder, setFormAccountHolder] = useState("");
  const [formAccountNumber, setFormAccountNumber] = useState("");
  const [formConfirmAccountNumber, setFormConfirmAccountNumber] = useState("");
  const [formIfsc, setFormIfsc] = useState("");
  const [formName, setFormName] = useState("");
  const [formPan, setFormPan] = useState("");
  const [formSending, setFormSending] = useState(false);

  // OTP dialog state
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);

  // View dialog state
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewDetail, setViewDetail] = useState<CashfreeVendorDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<CashfreeKyc | null>(null);

  // Refresh states
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getCashfreeKycList());
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load Cashfree KYC records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // --- Form helpers ---
  const resetForm = () => {
    setFormVendorId("");
    setFormEmail("");
    setFormPhone("");
    setFormAccountHolder("");
    setFormAccountNumber("");
    setFormConfirmAccountNumber("");
    setFormIfsc("");
    setFormName("");
    setFormPan("");
  };

  const openAddDialog = () => {
    setEditingItem(null);
    resetForm();
    setFormDialogOpen(true);
  };

  const openEditDialog = (item: CashfreeKyc) => {
    setEditingItem(item);
    setFormVendorId(item.vendorId);
    setFormEmail(item.email);
    setFormPhone(item.phone);
    setFormAccountHolder(item.accountHolder);
    setFormAccountNumber(item.accountNumber);
    setFormConfirmAccountNumber(item.accountNumber);
    setFormIfsc(item.ifsc);
    setFormName(item.name);
    setFormPan(item.pan);
    setFormDialogOpen(true);
  };

  const validateForm = (): string | null => {
    if (!formVendorId.trim()) return "Vendor ID is required.";
    if (!formEmail.trim()) return "Email is required.";
    if (!formPhone.trim()) return "Mobile Number is required.";
    if (!formAccountHolder.trim()) return "Account Holder Name is required.";
    if (!formAccountNumber.trim()) return "Account Number is required.";
    if (!formConfirmAccountNumber.trim()) return "Please confirm the Account Number.";
    if (formAccountNumber !== formConfirmAccountNumber) return "Account Numbers do not match.";
    if (!formIfsc.trim()) return "IFSC Code is required.";
    if (!formName.trim()) return "Name on PAN Card is required.";
    if (!formPan.trim()) return "PAN Number is required.";
    if (!PAN_REGEX.test(formPan.trim().toUpperCase())) return "Invalid PAN format. Expected: ABCDE1234F";
    return null;
  };

  const handleFormSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setFormSending(true);
    try {
      await sendCashfreeOtp();
      setOtpValue("");
      setOtpDialogOpen(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to send OTP. Please try again.");
    } finally {
      setFormSending(false);
    }
  };

  const handleOtpVerify = async () => {
    if (!otpValue.trim() || otpValue.trim().length !== 6) {
      setErrorMessage("Please enter a valid 6-digit OTP.");
      return;
    }
    setOtpVerifying(true);
    try {
      await verifyCashfreeOtpAndSave({
        otp: otpValue.trim(),
        kycId: editingItem?.id ?? null,
        vendorId: formVendorId.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim(),
        accountHolder: formAccountHolder.trim(),
        accountNumber: formAccountNumber.trim(),
        ifsc: formIfsc.trim().toUpperCase(),
        name: formName.trim(),
        pan: formPan.trim().toUpperCase(),
      });
      setOtpDialogOpen(false);
      setFormDialogOpen(false);
      setSuccessMessage(editingItem ? "Vendor KYC updated successfully." : "Vendor KYC added successfully.");
      fetchItems();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "OTP verification failed.";
      const axiosMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMessage(axiosMsg || message);
    } finally {
      setOtpVerifying(false);
    }
  };

  // --- View ---
  const handleView = async (item: CashfreeKyc) => {
    setViewLoading(true);
    setViewDialogOpen(true);
    setViewDetail(null);
    try {
      setViewDetail(await getCashfreeVendorDetail(item.id));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load vendor detail.");
      setViewDialogOpen(false);
    } finally {
      setViewLoading(false);
    }
  };

  // --- Delete ---
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCashfreeKyc(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Vendor KYC deleted.");
      fetchItems();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete.");
    }
  };

  // --- Toggle Active ---
  const handleToggleActive = async (item: CashfreeKyc) => {
    setTogglingId(item.id);
    try {
      await toggleCashfreeKycActive(item.id);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, isActive: !i.isActive } : i));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to toggle active status.");
    } finally {
      setTogglingId(null);
    }
  };

  // --- Refresh All ---
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const result = await refreshAllCashfreeStatus();
      setSuccessMessage(result.message || `Refreshed ${result.updatedCount} vendor(s).`);
      fetchItems();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to refresh all vendor statuses.");
    } finally {
      setRefreshingAll(false);
    }
  };

  // --- Refresh Single ---
  const handleRefreshSingle = async (item: CashfreeKyc) => {
    setRefreshingId(item.id);
    try {
      const result = await refreshCashfreeVendorStatus(item.id);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: result.status } : i));
      setSuccessMessage("Vendor status refreshed.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to refresh vendor status.");
    } finally {
      setRefreshingId(null);
    }
  };

  // --- Filter ---
  const filteredItems = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.vendorId.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q) ||
      item.phone.toLowerCase().includes(q) ||
      item.pan.toLowerCase().includes(q) ||
      item.accountNumber.toLowerCase().includes(q) ||
      item.ifsc.toLowerCase().includes(q) ||
      item.status.toLowerCase().includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage Cashfree KYC.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings/payments-and-dues"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Cashfree KYC Management</h2>
              <p className="text-muted-foreground text-base">Manage vendor KYC records for Cashfree</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRefreshAll} disabled={refreshingAll}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`} />
              {refreshingAll ? "Refreshing..." : "Refresh All"}
            </Button>
            <Button onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />Add Vendor
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No KYC records</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Vendor&quot; to create one.</p>
          </div>
        )}

        {/* Table */}
        {!loading && items.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search vendors..."
            />
            {filteredItems.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="w-12 text-primary-foreground">#</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Vendor ID</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Name</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Email</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Mobile</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">PAN</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">Account No</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">IFSC</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold text-center">Status</TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold text-center">Active</TableHead>
                      <TableHead className="w-12 text-primary-foreground"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item, i) => (
                      <TableRow key={item.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{item.vendorId}</TableCell>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.email}</TableCell>
                        <TableCell>{item.phone}</TableCell>
                        <TableCell>{item.pan}</TableCell>
                        <TableCell>{item.accountNumber}</TableCell>
                        <TableCell>{item.ifsc}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={getStatusBadgeVariant(item.status)}>
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={item.isActive}
                            disabled={togglingId === item.id}
                            onCheckedChange={() => handleToggleActive(item)}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleView(item)}>
                                <Eye className="mr-2 h-4 w-4" />View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(item)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleRefreshSingle(item)}
                                disabled={item.status === "ACTIVE" || refreshingId === item.id}
                              >
                                <RefreshCw className={`mr-2 h-4 w-4 ${refreshingId === item.id ? "animate-spin" : ""}`} />
                                Refresh
                              </DropdownMenuItem>
                              <DropdownMenuItem className={item.isActive ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive"} disabled={item.isActive} onClick={() => !item.isActive && setDeleteTarget(item)}>
                                <Trash2 className="mr-2 h-4 w-4" />{item.isActive ? "Deactivate first" : "Delete"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        {/* Add/Edit Form Dialog */}
        <Dialog open={formDialogOpen} onOpenChange={setFormDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit Vendor KYC" : "Add Vendor KYC"}</DialogTitle>
              <DialogDescription>
                {editingItem ? "Update the vendor KYC details. An OTP will be sent for verification." : "Enter vendor KYC details. An OTP will be sent for verification."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Vendor ID<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formVendorId}
                  onChange={(e) => setFormVendorId(e.target.value)}
                  placeholder="e.g. VENDOR001"
                  disabled={!!editingItem}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Email ID<span className="text-destructive ml-1">*</span></Label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="e.g. vendor@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Mobile Number<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </div>
              <div className="space-y-2">
                <Label>Account Holder Name<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formAccountHolder}
                  onChange={(e) => setFormAccountHolder(e.target.value)}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label>Account Number<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formAccountNumber}
                  onChange={(e) => setFormAccountNumber(e.target.value)}
                  placeholder="e.g. 1234567890"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm Account Number<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formConfirmAccountNumber}
                  onChange={(e) => setFormConfirmAccountNumber(e.target.value)}
                  placeholder="Re-enter account number"
                />
                {formConfirmAccountNumber && formAccountNumber !== formConfirmAccountNumber && (
                  <p className="text-destructive text-sm">Account numbers do not match.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>IFSC Code<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formIfsc}
                  onChange={(e) => setFormIfsc(e.target.value.toUpperCase())}
                  placeholder="e.g. SBIN0001234"
                />
              </div>
              <div className="space-y-2">
                <Label>Name on PAN Card<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label>PAN Number<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={formPan}
                  onChange={(e) => setFormPan(e.target.value.toUpperCase())}
                  placeholder="e.g. ABCDE1234F"
                  maxLength={10}
                />
                {formPan && !PAN_REGEX.test(formPan) && (
                  <p className="text-destructive text-sm">Invalid PAN format. Expected: ABCDE1234F</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormDialogOpen(false)} disabled={formSending}>Cancel</Button>
              <Button onClick={handleFormSubmit} disabled={formSending}>
                {formSending ? "Sending OTP..." : "Send OTP & Verify"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* OTP Dialog */}
        <Dialog open={otpDialogOpen} onOpenChange={setOtpDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Verify OTP</DialogTitle>
              <DialogDescription>
                OTP has been sent to the configured email. Please enter the 6-digit OTP below.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>OTP<span className="text-destructive ml-1">*</span></Label>
                <Input
                  value={otpValue}
                  onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Enter 6-digit OTP"
                  maxLength={6}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOtpDialogOpen(false)} disabled={otpVerifying}>Cancel</Button>
              <Button onClick={handleOtpVerify} disabled={otpVerifying || otpValue.length !== 6}>
                {otpVerifying ? "Verifying..." : "Verify"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Detail Dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Vendor KYC Details</DialogTitle>
              <DialogDescription>
                Detailed information for this vendor.
              </DialogDescription>
            </DialogHeader>
            {viewLoading && (
              <div className="flex items-center justify-center py-10">
                <RotaryLoader size="md" />
              </div>
            )}
            {!viewLoading && viewDetail && (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Vendor ID</p>
                    <p className="font-medium">{viewDetail.vendorId}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Name</p>
                    <p className="font-medium">{viewDetail.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Email</p>
                    <p className="font-medium">{viewDetail.email}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Phone</p>
                    <p className="font-medium">{viewDetail.phone}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Account Holder</p>
                    <p className="font-medium">{viewDetail.accountHolder}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Account Number</p>
                    <p className="font-medium">{viewDetail.accountNumber}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">IFSC</p>
                    <p className="font-medium">{viewDetail.ifsc}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">PAN</p>
                    <p className="font-medium">{viewDetail.pan}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant={getStatusBadgeVariant(viewDetail.status)}>{viewDetail.status}</Badge>
                  </div>
                </div>
                {viewDetail.cashfreeJson && (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-sm font-medium">Cashfree API Response</p>
                    <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto max-h-60 whitespace-pre-wrap">
                      <code>{(() => {
                        try {
                          return JSON.stringify(JSON.parse(viewDetail.cashfreeJson), null, 2);
                        } catch {
                          return viewDetail.cashfreeJson;
                        }
                      })()}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Vendor KYC"
          description={<>Are you sure you want to delete vendor <span className="font-semibold text-foreground">{deleteTarget?.vendorId}</span>?</>}
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
