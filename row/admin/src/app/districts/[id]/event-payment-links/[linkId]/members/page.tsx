"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getEventMembers, sendEventReceipt, sendEventReminderEmail,
  sendEventReminderWhatsApp, bulkReminderEmail, bulkReminderWhatsApp, exportEventMembers,
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
import { ArrowLeft, Download, Mail, MessageSquare, MoreHorizontal, Receipt, CreditCard } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

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
  districtNumber?: string;
  clubName?: string;
}

export default function DistrictEventMembersPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const linkId = Number(params.linkId);

  const [activeTab, setActiveTab] = useState("paid");
  const [paidMembers, setPaidMembers] = useState<EventMember[]>([]);
  const [unpaidMembers, setUnpaidMembers] = useState<EventMember[]>([]);
  const [paidLoading, setPaidLoading] = useState(true);
  const [unpaidLoading, setUnpaidLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  const fetchPaid = useCallback(async () => {
    try { setPaidLoading(true); setPaidMembers(await getEventMembers(linkId, true, search || undefined)); }
    catch { setErrorMessage("Failed to load paid members"); }
    finally { setPaidLoading(false); }
  }, [linkId, search]);

  const fetchUnpaid = useCallback(async () => {
    try { setUnpaidLoading(true); setUnpaidMembers(await getEventMembers(linkId, false, search || undefined)); }
    catch { setErrorMessage("Failed to load unpaid members"); }
    finally { setUnpaidLoading(false); }
  }, [linkId, search]);

  useEffect(() => { if (activeTab === "paid") fetchPaid(); else fetchUnpaid(); }, [activeTab, fetchPaid, fetchUnpaid]);

  const handleExport = async () => {
    try {
      const blob = await exportEventMembers(linkId, activeTab === "paid");
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a"); a.href = url;
      a.download = `event_members_${activeTab}_${linkId}_${fileTimestamp()}.csv`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch { setErrorMessage("Failed to export."); }
  };

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  const renderTable = (members: EventMember[], loading: boolean, isPaidTab: boolean) => {
    if (loading) return <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>;
    return (
      <div className="overflow-x-auto"><Table><TableHeader><TableRow>
        <TableHead>Name</TableHead><TableHead>Mobile</TableHead><TableHead>Email</TableHead>
        <TableHead>Registration</TableHead><TableHead>Amount</TableHead>
        {isPaidTab && <TableHead>Payment Date</TableHead>}
        {isPaidTab && <TableHead>Transaction</TableHead>}
        <TableHead className="w-[60px]">Actions</TableHead>
      </TableRow></TableHeader><TableBody>
        {members.length === 0 ? <TableRow><TableCell colSpan={isPaidTab ? 8 : 6} className="text-center py-8 text-muted-foreground">No members</TableCell></TableRow> : members.map(m => (
          <TableRow key={m.id}>
            <TableCell className="font-medium">{m.memberName || "-"}</TableCell>
            <TableCell>{m.mobile || "-"}</TableCell>
            <TableCell className="max-w-[150px] truncate">{m.email || "-"}</TableCell>
            <TableCell>{m.registrationType || "-"}</TableCell>
            <TableCell>{m.amount ? `₹${m.amount.toFixed(2)}` : "-"}</TableCell>
            {isPaidTab && <TableCell className="text-sm">{m.paymentDate ? new Date(m.paymentDate).toLocaleDateString() : "-"}</TableCell>}
            {isPaidTab && <TableCell><Badge variant={m.isOnline ? "default" : "secondary"}>{m.isOnline ? m.transactionId || "Online" : m.offlineTransactionType || "Offline"}</Badge></TableCell>}
            <TableCell>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isPaidTab ? (
                    <DropdownMenuItem onClick={async () => { try { await sendEventReceipt(m.id); setSuccessMessage("Receipt sent."); } catch { setErrorMessage("Failed."); } }}><Receipt className="h-4 w-4 mr-2" />Send Receipt</DropdownMenuItem>
                  ) : (<>
                    <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/event-payment-links/${linkId}/members/${m.id}/offline-payment`)}><CreditCard className="h-4 w-4 mr-2" />Offline Payment</DropdownMenuItem>
                    <DropdownMenuItem onClick={async () => { try { await sendEventReminderEmail(m.id); setSuccessMessage("Email sent."); } catch { setErrorMessage("Failed."); } }}><Mail className="h-4 w-4 mr-2" />Email Reminder</DropdownMenuItem>
                    <DropdownMenuItem onClick={async () => { try { await sendEventReminderWhatsApp(m.id); setSuccessMessage("WhatsApp sent."); } catch { setErrorMessage("Failed."); } }}><MessageSquare className="h-4 w-4 mr-2" />WhatsApp Reminder</DropdownMenuItem>
                  </>)}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody></Table></div>
    );
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href={`/districts/${districtId}/event-payment-links`}><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div className="flex-1"><h2 className="text-2xl font-bold tracking-tight text-primary">Event Members</h2><p className="text-muted-foreground">Link #{linkId}</p></div>
          <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Export</Button>
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search..." />
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList><TabsTrigger value="paid">Paid ({paidMembers.length})</TabsTrigger><TabsTrigger value="unpaid">Unpaid ({unpaidMembers.length})</TabsTrigger></TabsList>
            {activeTab === "unpaid" && <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={async () => { setBulkSending(true); try { await bulkReminderEmail(linkId); setSuccessMessage("Sent."); } catch { setErrorMessage("Failed."); } setBulkSending(false); }} disabled={bulkSending}><Mail className="h-4 w-4 mr-1" />Bulk Email</Button>
              <Button variant="outline" size="sm" onClick={async () => { setBulkSending(true); try { await bulkReminderWhatsApp(linkId); setSuccessMessage("Sent."); } catch { setErrorMessage("Failed."); } setBulkSending(false); }} disabled={bulkSending}><MessageSquare className="h-4 w-4 mr-1" />Bulk WhatsApp</Button>
            </div>}
          </div>
          <TabsContent value="paid">{renderTable(paidMembers, paidLoading, true)}</TabsContent>
          <TabsContent value="unpaid">{renderTable(unpaidMembers, unpaidLoading, false)}</TabsContent>
        </Tabs>
      </div>
    </ProtectedRoute>
  );
}
