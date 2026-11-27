"use client";
import { LinkButton } from "@/components/ui/text-buttons";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getEventPaymentLinks, getDistrict } from "@/services/api";
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
import { Pencil, Users, MoreHorizontal, Copy } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { withBase, BASE_PATH } from "@/lib/basePath";

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

export default function DistrictEventPaymentLinksPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const [districtName, setDistrictName] = useState("");
  const [items, setItems] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [d, data] = await Promise.all([
        getDistrict(districtId),
        getEventPaymentLinks({ districtId, search: search || undefined }),
      ]);
      setDistrictName(`District ${d.districtNumber}`);
      setItems(data);
    } catch { setErrorMessage("Failed to load payment links"); }
    finally { setLoading(false); }
  }, [districtId, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return (i.title || "").toLowerCase().includes(q);
  });

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <PageHeader
          title={districtName ? `${districtName} - Event Payment Links` : "Event Payment Links"}
          back={`/districts/${districtId}/dashboard`}
          actions={
            <>
<p className="text-muted-foreground text-base">View and manage event payment links for this district</p>
            </>
          }
        />

        <SearchBox value={search} onChange={setSearch} placeholder="Search by title..." />

        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
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

                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <LinkButton onClick={() => window.open(withBase(`/report/${item.id}`), "_blank")}>View</LinkButton>
                        <span className="text-muted-foreground">|</span>
                        <LinkButton onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${BASE_PATH}/report/${item.id}`); setSuccessMessage("Report link copied."); }}>Copy</LinkButton>
                      </div>
                    </TableCell>

                    <TableCell className="text-center">
                      {item.googleSheetId ? (
                        <div className="flex flex-col items-center gap-0.5 text-sm">
                          <LinkButton onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}>Open</LinkButton>
                          <LinkButton onClick={() => { navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`); setSuccessMessage("Google Sheet URL copied."); }}>Copy URL</LinkButton>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button aria-label="More actions" variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/event-payment-links/${item.id}/members`)}><Users className="h-4 w-4 mr-2" />View Members</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push(`/districts/${districtId}/event-payment-links/edit?editId=${item.id}`)}><Pencil className="h-4 w-4 mr-2" />Edit Details</DropdownMenuItem>
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
