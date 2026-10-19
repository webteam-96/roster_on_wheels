"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRiDirectorWeblinks, deleteRiDirectorWeblink } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, FolderOpen, AlertTriangle, ExternalLink, Link2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

interface Item {
  id: number; title: string; writeup: string | null;
  linkType: string; linkUrl: string | null; youtubeUrl: string | null;
  buttonText: string | null; sortOrder: number; isActive: boolean;
}

export default function Page() {
  const router = useRouter();
  const { isSuperAdmin, isRIDirector } = useAuth();
  const canManage = isSuperAdmin || isRIDirector;

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try { setItems(await getRiDirectorWeblinks()); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteRiDirectorWeblink(deleteTarget.id); setDeleteTarget(null); setSuccessMessage("Deleted."); fetchItems(); }
    catch { setDeleteTarget(null); setErrorMessage("Failed to delete."); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild><Link href="/ri-director"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director - Web Links</h2>
              <p className="text-muted-foreground text-base">Shareable links across all zones</p>
            </div>
          </div>
          {canManage && <Button onClick={() => router.push("/ri-director/weblinks/add")}><Plus className="mr-2 h-4 w-4" />Add Link</Button>}
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}
        {!loading && items.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-center"><FolderOpen className="h-12 w-12 text-muted-foreground mb-4" /><h3 className="text-lg font-semibold">No web links</h3></div>}
        {!loading && items.length > 0 && (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-12 text-primary-foreground font-semibold">#</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Title</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Type</TableHead>
                  <TableHead className="text-primary-foreground font-semibold">Link</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Order</TableHead>
                  <TableHead className="text-primary-foreground font-semibold text-center">Active</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w, i) => {
                  const url = w.linkType === "youtube" ? w.youtubeUrl : w.linkUrl;
                  return (
                    <TableRow key={w.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-emerald-600" />
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline" title="Open link">{w.title}</a>
                          ) : (
                            w.title
                          )}
                        </span>
                      </TableCell>
                      <TableCell><span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">{w.linkType}</span></TableCell>
                      <TableCell>{url ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm">Open <ExternalLink className="h-3 w-3" /></a> : "-"}</TableCell>
                      <TableCell className="text-center">{w.sortOrder}</TableCell>
                      <TableCell className="text-center"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${w.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{w.isActive ? "Yes" : "No"}</span></TableCell>
                      {canManage && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/ri-director/weblinks/${w.id}/edit`)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(w)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        )}

        <AlertModal open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} icon={AlertTriangle} iconClassName="text-destructive" title="Delete Web Link" description={<>Delete <span className="font-semibold">{deleteTarget?.title}</span>?</>} confirmLabel="Delete" confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90" onConfirm={handleDelete} cancelLabel="Cancel" onCancel={() => setDeleteTarget(null)} />
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
