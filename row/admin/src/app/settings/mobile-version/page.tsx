"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Plus, Smartphone, Loader2 } from "@/components/icons";
import { getMobileVersions, createMobileVersion } from "@/services/api";
import { ListPageSkeleton } from "@/components/row/AppKit";

const DEFAULT_URL = process.env.NEXT_PUBLIC_IOS_APP_URL ?? "";
// Default store URLs — pre-filled but fully editable in the Add dialog.
const DEFAULT_PLAY_STORE_URL = process.env.NEXT_PUBLIC_ANDROID_APP_URL ?? "";
const DEFAULT_APP_STORE_URL = process.env.NEXT_PUBLIC_IOS_APP_URL ?? "";

export default function MobileVersionPage() {
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    version: "", message: "", playStoreUrl: DEFAULT_PLAY_STORE_URL, appStoreUrl: DEFAULT_APP_STORE_URL, url: DEFAULT_URL, isForceUpdate: true,
  });
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    setLoading(true);
    try { setRows(await getMobileVersions()); }
    catch (e: any) { setError(e?.response?.data?.message || "Failed to load versions"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (isSuperAdmin) reload(); /* eslint-disable-next-line */ }, [isSuperAdmin]);

  const openAdd = () => {
    setForm({ version: "", message: "", playStoreUrl: DEFAULT_PLAY_STORE_URL, appStoreUrl: DEFAULT_APP_STORE_URL, url: DEFAULT_URL, isForceUpdate: true });
    setFormOpen(true);
  };

  const onSave = async () => {
    if (!form.version.trim()) { setError("Version is required"); return; }
    setSaving(true);
    try {
      await createMobileVersion(form);
      setSuccess(`Version ${form.version} added and activated`);
      setFormOpen(false);
      await reload();
    } catch (e: any) { setError(e?.response?.data?.message || "Failed to save"); }
    finally { setSaving(false); }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div>
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
                <Smartphone className="h-6 w-6" />Mobile App Version
              </h2>
              <p className="text-muted-foreground text-base">
                Add a new version to make it the live version. The newest row is automatically active and all previous rows are deactivated.
                To correct a mistake, simply add a new version. No edit or delete option is provided by design.
              </p>
            </div>
          </div>
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Version</Button>
        </div>

        {loading && <div className="flex justify-center py-12"><ListPageSkeleton /></div>}

        {!loading && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Force Update</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: any) => (
                    <TableRow key={row.id} className={row.isActive ? "bg-green-50" : ""}>
                      <TableCell className="font-mono font-bold">{row.version}</TableCell>
                      <TableCell>
                        {row.isForceUpdate ? (
                          <Badge className="bg-red-100 text-red-800 border-red-300">Force</Badge>
                        ) : (
                          <Badge variant="secondary">Optional</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate" title={row.message}>{row.message || "–"}</TableCell>
                      <TableCell>
                        {row.isActive ? (
                          <Badge className="bg-green-600 text-white">ACTIVE</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{row.createdDate ? new Date(row.createdDate).toLocaleString() : "–"}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No versions yet. Click Add Version</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Add dialog */}
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Add Mobile App Version</DialogTitle>
              <DialogDescription>
                Single version applies to both iOS + Android. The newly added version becomes Active automatically and all previous versions are deactivated.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Version *</Label>
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="e.g., 1.4.0" />
              </div>
              <div>
                <Label>Message (shown in popup)</Label>
                <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Critical bug fixes. Please update" />
              </div>
              <div>
                <Label>Play Store URL (Android)</Label>
                <Input value={form.playStoreUrl} onChange={(e) => setForm({ ...form, playStoreUrl: e.target.value })} placeholder="https://play.google.com/..." />
              </div>
              <div>
                <Label>App Store URL (iOS)</Label>
                <Input value={form.appStoreUrl} onChange={(e) => setForm({ ...form, appStoreUrl: e.target.value })} placeholder="https://apps.apple.com/..." />
              </div>
              <div>
                <Label>URL (legacy)</Label>
                <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">Default iTunes update viewer. Leave as-is unless instructed.</p>
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <div>
                  <Label className="font-semibold">Force Update</Label>
                  <p className="text-xs text-muted-foreground">If ON, app shows non-dismissable popup. If OFF, app shows optional update dialog.</p>
                </div>
                <Switch checked={form.isForceUpdate} onCheckedChange={(v) => setForm({ ...form, isForceUpdate: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={onSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {saving ? "Saving..." : "Add & Activate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      </div>
    </ProtectedRoute>
  );
}
