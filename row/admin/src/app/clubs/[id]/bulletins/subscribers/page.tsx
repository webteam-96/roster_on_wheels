"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AlertModal from "@/components/AlertModal";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/row/AppKit";
import { Trash2 } from "@/components/icons";
import { getBulletinSubscribers, removeBulletinSubscriber, type BulletinSubscriber } from "@/services/api";
import { appLocale } from "@/lib/appFormat";

const STATUS: Record<BulletinSubscriber["status"], string> = {
  Confirmed: "Confirmed", Pending: "Not confirmed yet", Unsubscribed: "Unsubscribed",
};

// Non-member bulletin subscribers (gap #6). They sign up on the club website and confirm by email; only Confirmed
// ones receive bulletins.
export default function BulletinSubscribersPage() {
  const clubId = Number(useParams().id);
  const [items, setItems] = useState<BulletinSubscriber[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setItems(null);
    try {
      setItems(await getBulletinSubscribers(clubId));
    } catch (err: any) {
      setLoadError(err?.response?.data?.message || "The subscribers could not be loaded.");
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    const id = removeId;
    setRemoveId(null);
    if (id == null) return;
    try {
      await removeBulletinSubscriber(clubId, id);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "The subscriber could not be removed.");
    }
  };

  const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" }) : "-");
  const confirmed = items?.filter((s) => s.status === "Confirmed").length ?? 0;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader
          title="Bulletin subscribers"
          description="People who are not members sign up on the club website's Bulletin page and confirm by email. Only confirmed subscribers receive bulletins."
          back={`/clubs/${clubId}/bulletins`}
        />

        {loadError ? <ErrorState message={loadError} onRetry={load} retryLabel="Try again" />
          : items === null ? <Panel title="Subscribers"><SkeletonRows rows={5} /></Panel>
          : items.length === 0 ? (
            <Panel title="No subscribers yet">
              <p className="text-[15px] text-muted-foreground">Share the Bulletin page of the club website so people can sign up.</p>
            </Panel>
          ) : (
            <Panel title="Subscribers" subtitle={`${confirmed} confirmed of ${items.length}`}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Signed up</TableHead>
                      <TableHead>Confirmed</TableHead>
                      <TableHead className="text-right">Remove</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium" data-no-translate>{s.email}</TableCell>
                        <TableCell data-no-translate>{s.name ?? "-"}</TableCell>
                        <TableCell><Badge variant={s.status === "Confirmed" ? "default" : "secondary"}>{STATUS[s.status]}</Badge></TableCell>
                        <TableCell>{day(s.signupDate)}</TableCell>
                        <TableCell>{day(s.confirmedDate)}</TableCell>
                        <TableCell className="text-right">
                          {s.status !== "Unsubscribed" && (
                            <Button variant="ghost" size="icon" aria-label={`Remove ${s.email}`} onClick={() => setRemoveId(s.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          )}
      </div>
      <AlertModal open={removeId !== null} icon={Trash2} iconClassName="text-red-700" title="Remove this subscriber?"
        description="They stop receiving bulletins. They can sign up again on the website and confirm by email."
        confirmLabel="Remove" cancelLabel="Cancel" onConfirm={remove} onCancel={() => setRemoveId(null)} />
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
    </ProtectedRoute>
  );
}
