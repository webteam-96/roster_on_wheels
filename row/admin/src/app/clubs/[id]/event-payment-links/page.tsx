"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getEventPaymentLinks } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Pencil, Users, MoreHorizontal, FileSpreadsheet, ExternalLink, Copy, FileBarChart } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

interface PaymentLink {
  id: number;
  formType: number;
  districtNumber?: string;
  clubName?: string;
  title?: string;
  registrationCount: number;
  paidCount: number;
  unpaidCount: number;
  isActive: boolean;
  createdDate: string;
  createdByName?: string;
  googleSheetId?: string;
}

export default function ClubEventPaymentLinksPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const [items, setItems] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getEventPaymentLinks({ clubId, search: search || undefined });
      setItems(data);
    } catch { setErrorMessage("Failed to load payment links"); }
    finally { setLoading(false); }
  }, [clubId, search]);

  useEffect(() => { fetchData(); }, [fetchData]);


  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return (i.title || "").toLowerCase().includes(q);
  });

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">Event Payment Links</h2>
            <p className="text-muted-foreground text-base">View and manage event payment links for this club</p>
          </div>
        </div>

        <SearchBox value={search} onChange={setSearch} placeholder="Search by title..." />

        {loading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Paid</TableHead>
                  <TableHead className="text-center">Unpaid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-center">Report</TableHead>
                  <TableHead className="text-center">GoogleSheet</TableHead>
                  <TableHead className="w-[60px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No payment links found</TableCell></TableRow>
                ) : filtered.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">{item.title || "Untitled"}</TableCell>
                    <TableCell><Badge variant="outline">{item.formType === 1 ? "Standard" : "Dynamic"}</Badge></TableCell>
                    <TableCell className="text-center"><Badge variant="default">{item.paidCount}</Badge></TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{item.unpaidCount}</Badge></TableCell>
                    <TableCell><Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(item.createdDate).toLocaleDateString()}</TableCell>

                    {/* Report */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => window.open(`/report/${item.id}`, "_blank")}
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline">View</button>
                        <span className="text-muted-foreground">|</span>
                        <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/report/${item.id}`); setSuccessMessage("Report link copied."); }}
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline">Copy</button>
                      </div>
                    </TableCell>

                    {/* GoogleSheet */}
                    <TableCell className="text-center">
                      {item.googleSheetId ? (
                        <div className="flex flex-col items-center gap-0.5 text-sm">
                          <button onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}
                            className="text-blue-600 hover:text-blue-800 hover:underline">Open</button>
                          <button onClick={() => { navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`); setSuccessMessage("Google Sheet URL copied."); }}
                            className="text-blue-600 hover:text-blue-800 hover:underline">Copy URL</button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/event-payment-links/${item.id}/members`)}><Users className="h-4 w-4 mr-2" />View Members</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/event-payment-links/edit?editId=${item.id}`)}><Pencil className="h-4 w-4 mr-2" />Edit Details</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
