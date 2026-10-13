"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  getEventMembers, sendEventReceipt, sendEventReminderEmail,
  sendEventReminderWhatsApp, bulkReminderEmail, bulkReminderWhatsApp, exportEventMembers,
  getEventPaymentLinkDetail,
} from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Download, Mail, MessageSquare, MoreHorizontal, Receipt, CreditCard, Pencil, Paperclip, Send } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { currencySymbol } from "@/lib/appFormat";
interface EventMember {
  id: number;
  memberName?: string;
  mobile?: string;
  email?: string;
  registrationType?: string;
  amount?: number;
  isPaid: boolean;
  isOnline: boolean;
  paymentDate?: string;
  transactionId?: string;
  offlineTransactionType?: string;
  attachment?: string;
  districtNumber?: string;
  clubName?: string;
  fkMemberProfileId?: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function EventMembersPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const linkId = Number(params.linkId);

  const [linkDetail, setLinkDetail] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("paid");
  const [previewAttachment, setPreviewAttachment] = useState<string | null>(null);
  const [paidMembers, setPaidMembers] = useState<EventMember[]>([]);
  const [unpaidMembers, setUnpaidMembers] = useState<EventMember[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [paidLoading, setPaidLoading] = useState(true);
  const [unpaidLoading, setUnpaidLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [remarkDialogOpen, setRemarkDialogOpen] = useState(false);
  const [remarkSending, setRemarkSending] = useState(false);
  const [remarkText, setRemarkText] = useState("");
  const [remarkTarget, setRemarkTarget] = useState<{ type: "receipt" | "reminder"; memberId?: number; bulk?: boolean } | null>(null);

  const isDynamic = linkDetail?.formType === 2;

  useEffect(() => {
    (async () => {
      try {
        const detail = await getEventPaymentLinkDetail(linkId);
        setLinkDetail(detail);
      } catch { /* ignore */ }
    })();
  }, [linkId]);

  const fetchPaid = useCallback(async () => {
    try {
      setPaidLoading(true);
      const data = await getEventMembers(linkId, true, search || undefined);
      setPaidMembers(data);
    } catch { setErrorMessage("Failed to load paid members"); }
    finally { setPaidLoading(false); }
  }, [linkId, search]);

  const fetchUnpaid = useCallback(async () => {
    try {
      setUnpaidLoading(true);
      const data = await getEventMembers(linkId, false, search || undefined);
      setUnpaidMembers(data);
    } catch { setErrorMessage("Failed to load unpaid members"); }
    finally { setUnpaidLoading(false); }
  }, [linkId, search]);

  useEffect(() => {
    fetchPaid();
    if (!isDynamic) fetchUnpaid();
  }, [fetchPaid, fetchUnpaid, isDynamic]);

  const openRemarkDialog = (type: "receipt" | "reminder", memberId?: number, bulk?: boolean) => {
    setRemarkTarget({ type, memberId, bulk });
    setRemarkText("");
    setRemarkDialogOpen(true);
  };

  const handleSendWithRemark = async () => {
    if (!remarkTarget) return;
    setRemarkSending(true);
    try {
      const remark = remarkText.trim() || undefined;
      if (remarkTarget.type === "receipt") {
        if (remarkTarget.bulk) {
          const targets = selectedIds.length > 0 ? selectedIds : paidMembers.map(m => m.id);
          // Fire and forget — don't block UI
          targets.forEach(id => sendEventReceipt(id, remark).catch(() => {}));
          setSelectedIds([]);
          setSuccessMessage(`Sending receipt to ${targets.length} member(s) in background...`);
        } else if (remarkTarget.memberId) {
          sendEventReceipt(remarkTarget.memberId, remark).catch(() => {});
          setSuccessMessage("Sending receipt email in background...");
        }
      } else if (remarkTarget.type === "reminder") {
        if (remarkTarget.bulk) {
          // Fire and forget
          bulkReminderEmail(linkId, remark).catch(() => {});
          setSuccessMessage("Sending bulk reminder emails in background...");
        } else if (remarkTarget.memberId) {
          sendEventReminderEmail(remarkTarget.memberId, remark).catch(() => {});
          setSuccessMessage("Sending reminder email in background...");
        }
      }
    } catch { setErrorMessage("Failed to send email."); }
    finally { setRemarkSending(false); setRemarkDialogOpen(false); }
    setRemarkTarget(null);
  };

  const handleSendReceipt = async (memberId: number) => {
    try {
      await sendEventReceipt(memberId);
      setSuccessMessage("Receipt email sent.");
    } catch { setErrorMessage("Failed to send receipt."); }
  };

  const handleSendReminderEmail = async (memberId: number) => {
    try {
      await sendEventReminderEmail(memberId);
      setSuccessMessage("Reminder email sent.");
    } catch { setErrorMessage("Failed to send reminder."); }
  };

  const handleSendReminderWhatsApp = (memberId: number) => {
    sendEventReminderWhatsApp(memberId).catch(() => {});
    setSuccessMessage("Sending WhatsApp reminder in background...");
  };

  const handleBulkEmail = async () => {
    setBulkSending(true);
    try {
      await bulkReminderEmail(linkId);
      setSuccessMessage("Bulk email reminders sent.");
    } catch { setErrorMessage("Failed to send bulk emails."); }
    finally { setBulkSending(false); }
  };

  const handleBulkWhatsApp = () => {
    bulkReminderWhatsApp(linkId).catch(() => {});
    setSuccessMessage("Sending bulk WhatsApp reminders in background...");
  };

  const handleExport = async () => {
    try {
      const blob = await exportEventMembers(linkId, activeTab === "paid");
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `event_members_${activeTab}_${linkId}_${fileTimestamp()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to export."); }
  };

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  const renderTable = (members: EventMember[], loading: boolean, isPaidTab: boolean) => {
    if (loading) return <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>;

    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {isPaidTab && <TableHead className="w-[40px]">
                <Checkbox
                  checked={members.length > 0 && selectedIds.length === members.length}
                  onCheckedChange={(c) => setSelectedIds(c ? members.map(m => m.id) : [])}
                />
              </TableHead>}
              <TableHead className="w-[50px]">Sr. No.</TableHead>
              <TableHead>District</TableHead>
              <TableHead>Club</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Registration</TableHead>
              <TableHead>Amount</TableHead>
              {isPaidTab && <TableHead>Payment Date</TableHead>}
              {isPaidTab && <TableHead>Transaction</TableHead>}
              {isPaidTab && <TableHead className="text-center">Attachment</TableHead>}
              <TableHead className="w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow><TableCell colSpan={isPaidTab ? 13 : 9} className="text-center text-muted-foreground py-8">No members found</TableCell></TableRow>
            ) : members.map((m, index) => (
              <TableRow key={m.id || index}>
                {isPaidTab && <TableCell>
                  <Checkbox
                    checked={selectedIds.includes(m.id)}
                    onCheckedChange={(c) => setSelectedIds(prev => c ? [...prev, m.id] : prev.filter(id => id !== m.id))}
                  />
                </TableCell>}
                <TableCell className="text-center">{index + 1}</TableCell>
                <TableCell>{m.districtNumber || "-"}</TableCell>
                <TableCell>{m.clubName || "-"}</TableCell>
                <TableCell className="font-medium">{m.memberName || "-"}</TableCell>
                <TableCell>{m.mobile || "-"}</TableCell>
                <TableCell className="max-w-[150px] truncate">{m.email || "-"}</TableCell>
                <TableCell>{m.registrationType || "-"}</TableCell>
                <TableCell>{m.amount ? `${currencySymbol()}${m.amount.toFixed(2)}` : "-"}</TableCell>
                {isPaidTab && <TableCell className="text-sm">{m.paymentDate ? new Date(m.paymentDate).toLocaleDateString() : "-"}</TableCell>}
                {isPaidTab && <TableCell className="text-sm">
                  {m.isOnline ? (
                    <Badge variant="default">{m.transactionId || "Online"}</Badge>
                  ) : (
                    <Badge variant="secondary">{m.offlineTransactionType || "Offline"}</Badge>
                  )}
                </TableCell>}
                {isPaidTab && <TableCell className="text-center">
                  {m.attachment ? (
                    <button onClick={() => setPreviewAttachment(`${API_BASE_URL}/${m.attachment}`)} className="text-blue-600 hover:text-blue-800">
                      <Paperclip className="h-4 w-4" />
                    </button>
                  ) : "-"}
                </TableCell>}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isPaidTab ? (
                        <>
                          {!m.isOnline && (
                            <DropdownMenuItem onClick={() => router.push(`/settings/event-payment-links/${linkId}/offline-payment?editPaymentId=${m.id}&memberId=${m.fkMemberProfileId}&memberName=${encodeURIComponent(m.memberName || "")}&mobile=${encodeURIComponent(m.mobile || "")}&email=${encodeURIComponent(m.email || "")}&districtNumber=${encodeURIComponent(m.districtNumber || "")}&clubName=${encodeURIComponent(m.clubName || "")}`)}><Pencil className="h-4 w-4 mr-2" />Update Offline Payment</DropdownMenuItem>
                          )}
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem onClick={() => router.push(`/settings/event-payment-links/${linkId}/offline-payment?memberId=${m.fkMemberProfileId}&memberName=${encodeURIComponent(m.memberName || "")}&mobile=${encodeURIComponent(m.mobile || "")}&email=${encodeURIComponent(m.email || "")}&districtNumber=${encodeURIComponent(m.districtNumber || "")}&clubName=${encodeURIComponent(m.clubName || "")}`)}><CreditCard className="h-4 w-4 mr-2" />Record Offline Payment</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openRemarkDialog("reminder", m.id)}><Mail className="h-4 w-4 mr-2" />Send Reminder Email</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleSendReminderWhatsApp(m.id)}><MessageSquare className="h-4 w-4 mr-2" />Send WhatsApp Reminder</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/event-payment-links"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Event Members</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span><strong>Form Type:</strong> {linkDetail?.formType === 1 ? "Standard" : "Dynamic"}</span>
              {!isDynamic && linkDetail?.fkDistrictMasterId && (
                <span><strong>District:</strong> {linkDetail.districtNumber || linkDetail.fkDistrictMasterId}</span>
              )}
              {!isDynamic && !linkDetail?.isForAllDistricts && linkDetail?.fkClubId && (
                <span><strong>Club:</strong> {linkDetail.clubName || linkDetail.fkClubId}</span>
              )}
              <span><strong>Purpose:</strong> {linkDetail?.title || "-"}</span>
            </div>
          </div>
          {isDynamic && <Button onClick={() => router.push(`/settings/event-payment-links/${linkId}/offline-payment`)}><CreditCard className="h-4 w-4 mr-2" />Add Offline Payment</Button>}
        </div>

        <SearchBox value={search} onChange={setSearch} placeholder="Search by name, mobile, email..." />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger value="paid">Paid ({paidMembers.length})</TabsTrigger>
                {!isDynamic && <TabsTrigger value="unpaid">Unpaid ({unpaidMembers.length})</TabsTrigger>}
              </TabsList>
              {activeTab === "paid" && paidMembers.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => openRemarkDialog("receipt", undefined, true)} disabled={bulkSending || selectedIds.length === 0}>
                  <Send className="h-4 w-4 mr-1" />{bulkSending ? "Sending..." : `Send Receipt (${selectedIds.length > 0 ? selectedIds.length + " selected" : "select members"})`}
                </Button>
              )}
            </div>
            {!isDynamic && activeTab === "unpaid" && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openRemarkDialog("reminder", undefined, true)} disabled={bulkSending}>
                  <Mail className="h-4 w-4 mr-1" />Bulk Email
                </Button>
                <Button variant="outline" size="sm" onClick={handleBulkWhatsApp} disabled={bulkSending}>
                  <MessageSquare className="h-4 w-4 mr-1" />Bulk WhatsApp
                </Button>
              </div>
            )}
          </div>
          <TabsContent value="paid">{renderTable(paidMembers, paidLoading, true)}</TabsContent>
          {!isDynamic && <TabsContent value="unpaid">{renderTable(unpaidMembers, unpaidLoading, false)}</TabsContent>}
        </Tabs>

        {/* Remark Dialog */}
        <Dialog open={remarkDialogOpen} onOpenChange={setRemarkDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{remarkTarget?.type === "receipt" ? "Send Receipt" : "Send Reminder"}{remarkTarget?.bulk ? " to All" : ""}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Add Remark (optional)</Label>
                <Textarea value={remarkText} onChange={e => setRemarkText(e.target.value)} rows={3} placeholder="Add any additional remark to include in the email..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemarkDialogOpen(false)} disabled={remarkSending}>Cancel</Button>
              <Button onClick={handleSendWithRemark} disabled={remarkSending}>
                {remarkSending ? <RotaryLoader size="sm" className="mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                {remarkSending ? "Sending..." : "Send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Attachment Preview Popup */}
        <Dialog open={!!previewAttachment} onOpenChange={() => setPreviewAttachment(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Attachment Preview</DialogTitle></DialogHeader>
            {previewAttachment && (
              previewAttachment.toLowerCase().endsWith(".pdf") ? (
                <iframe src={previewAttachment} className="w-full h-[500px] rounded" />
              ) : (
                <img src={previewAttachment} alt="Attachment" className="w-full max-h-[500px] object-contain rounded" />
              )
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
