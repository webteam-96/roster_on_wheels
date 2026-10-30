"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, RefreshCw, Eye, Send, Loader2, Bell, AlertTriangle } from "@/components/icons";
import { getRecentPushLogs, getPushRecipients, getStuckPushes, sendPushNow } from "@/services/api";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function PushLogsPage() {
  const { isSuperAdmin } = useAuth();
  const [recent, setRecent] = useState<any[]>([]);
  const [stuck, setStuck] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipientsTarget, setRecipientsTarget] = useState<any | null>(null);
  const [recipientRows, setRecipientRows] = useState<any[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        getRecentPushLogs({ type: filterType === "all" ? undefined : filterType }),
        getStuckPushes(),
      ]);
      setRecent(Array.isArray(r) ? r : []);
      setStuck(Array.isArray(s) ? s : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load push logs");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (isSuperAdmin) reload(); /* eslint-disable-next-line */ }, [isSuperAdmin, filterType]);

  const openRecipients = async (row: any) => {
    setRecipientsTarget(row);
    setRecipientRows([]);
    setLoadingRecipients(true);
    try {
      const rows = await getPushRecipients(row.type, row.entityId, !!row.isReminder, row.reminderId);
      setRecipientRows(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load recipients");
    } finally { setLoadingRecipients(false); }
  };

  const onSendNow = async (row: any) => {
    const key = `${row.type}-${row.entityId}`;
    setSendingId(key);
    try {
      const r = await sendPushNow(row.type, row.entityId);
      setSuccess(r?.message || "Queued");
      // Refresh after a brief delay so the user sees the queued state
      setTimeout(() => reload(), 2000);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to queue push");
    } finally { setSendingId(null); }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
                <Bell className="h-6 w-6" />Push Notification Logs
              </h2>
              <p className="text-muted-foreground text-base">Last 5 days of push activity (older logs auto-deleted at 04:00)</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="announcement">Announcement</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={reload} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </div>

        {loading && <div className="flex justify-center py-12"><ListPageSkeleton /></div>}

        {!loading && (
          <Tabs defaultValue="recent">
            <TabsList>
              <TabsTrigger value="recent">Recent ({recent.length})</TabsTrigger>
              <TabsTrigger value="stuck">
                <AlertTriangle className="h-4 w-4 mr-1 text-amber-500" />
                Stuck ({stuck.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recent" className="space-y-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Pushed At</TableHead>
                        <TableHead className="text-center">Sent</TableHead>
                        <TableHead className="text-center">Failed</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((row: any, idx: number) => {
                        const key = `${row.type}-${row.entityId}`;
                        return (
                          <TableRow key={`${key}-${row.isReminder}-${row.reminderId || 0}-${idx}`}>
                            <TableCell>
                              <Badge variant="outline">{row.type}</Badge>
                              {row.isReminder ? <Badge className="ml-1 bg-amber-100 text-amber-800 border-amber-300">Reminder</Badge> : null}
                            </TableCell>
                            <TableCell className="font-medium max-w-[300px] truncate" title={row.title}>{row.title}</TableCell>
                            <TableCell className="text-xs">{row.districtId ? `District ${row.districtId}` : `Club ${row.clubId}`}</TableCell>
                            <TableCell className="text-xs">{row.pushedAt ? new Date(row.pushedAt).toLocaleString() : "–"}</TableCell>
                            <TableCell className="text-center text-green-600 font-medium">{row.totalSent || 0}</TableCell>
                            <TableCell className="text-center text-destructive font-medium">{row.totalFailed || 0}</TableCell>
                            <TableCell className="text-center">{row.totalRecipients || 0}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => openRecipients(row)} title="View recipients">
                                  <Eye className="h-3 w-3" />
                                </Button>
                                {!row.isReminder && (
                                  <Button size="sm" variant="outline" onClick={() => onSendNow(row)} disabled={sendingId === key} title="Resend push to all eligible members">
                                    {sendingId === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {recent.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No push activity in last 5 days</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="stuck" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Items where Publish date has passed but push has not fired yet. Click "Send Now" to queue them: fires within 60 sec in background.
              </p>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Publish Date</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stuck.map((row: any) => {
                        const key = `${row.type}-${row.entityId}`;
                        return (
                          <TableRow key={key} className="bg-amber-50">
                            <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                            <TableCell className="font-medium max-w-[300px] truncate" title={row.title}>{row.title}</TableCell>
                            <TableCell className="text-xs">{row.districtId ? `District ${row.districtId}` : `Club ${row.clubId}`}</TableCell>
                            <TableCell className="text-xs">{row.publishDate ? new Date(row.publishDate).toLocaleString() : "–"}</TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" onClick={() => onSendNow(row)} disabled={sendingId === key}>
                                {sendingId === key ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                                {sendingId === key ? "Queuing..." : "Send Now"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {stuck.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">All clear. No stuck pushes</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Recipients dialog */}
        <Dialog open={!!recipientsTarget} onOpenChange={(o) => !o && setRecipientsTarget(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Recipients: {recipientsTarget?.title}</DialogTitle>
            </DialogHeader>
            {loadingRecipients ? (
              <div className="flex justify-center py-8"><ListPageSkeleton /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent At</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipientRows.map((r: any, i: number) => (
                    <TableRow key={i} className={r.status === "Failed" ? "bg-red-50" : ""}>
                      <TableCell className="font-medium">{r.memberName}</TableCell>
                      <TableCell className="text-xs">{r.mobile || "–"}</TableCell>
                      <TableCell className="text-xs">{r.email || "–"}</TableCell>
                      <TableCell>
                        <Badge className={r.status === "Sent" ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "–"}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[300px] truncate" title={r.errorMessage}>{r.errorMessage || ""}</TableCell>
                    </TableRow>
                  ))}
                  {recipientRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No recipients</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
