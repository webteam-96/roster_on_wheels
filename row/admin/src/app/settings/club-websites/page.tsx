"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import WebsiteTrainingAppointmentsTab from "./WebsiteTrainingAppointmentsTab";
import TrainingAvailabilityTab from "./TrainingAvailabilityTab";
import { Loader2 } from "@/components/icons";
import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
import { useClubWebsites } from "./useClubWebsites";
import ClubWebsitesHeader from "./ClubWebsitesHeader";
import ClubWebsitesListSection from "./ClubWebsitesListSection";
import EditWebsiteDialog from "./EditWebsiteDialog";
import { sanitizeDomainInput } from "./clubWebsitesShared";

export default function ClubWebsitesPage() {
  const h = useClubWebsites();
  const { successMessage, setSuccessMessage, errorMessage, setErrorMessage, busyId, rows, active, expiringSoon, expired, loading, logsOpen, setLogsOpen, logsLoading, logs, diagOpen, setDiagOpen, diagType, runDiag, diagLoading, diagData, sslDiagOpen, setSslDiagOpen, sslDiagLoading, sslDiagText, pleskListOpen, setPleskListOpen, pleskList, pleskListLoading, settingsOpen, setSettingsOpen, settingsParent, setSettingsParent, settingsDays, setSettingsDays, saveSettings } = h;
  const v = h;

  return (
    <ProtectedRoute>
      <Tabs defaultValue="websites" className="space-y-4">
        <ClubWebsitesHeader v={v} />
        <TabsList>
          <TabsTrigger value="websites">Club Websites</TabsTrigger>
          <TabsTrigger value="training">Website Training Appointments</TabsTrigger>
          <TabsTrigger value="availability">Training Availability</TabsTrigger>
        </TabsList>
        <TabsContent value="websites">
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {busyId && (busyId.endsWith("-toggle") || busyId.endsWith("-retry") || busyId.endsWith("-force") || busyId.endsWith("-del")) && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
            <div className="bg-card rounded-lg shadow-xl p-8 max-w-md flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="text-center">
                <p className="font-semibold text-lg">
                  {busyId.endsWith("-del") ? "Deleting website..." :
                   busyId.endsWith("-force") ? "Activating (manual mode)..." :
                   "Activating website..."}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {busyId.endsWith("-del")
                    ? "Removing subdomain from Plesk + IIS and deleting the portal record. Please wait. Do not close this tab."
                    : busyId.endsWith("-force")
                    ? "Updating status and sending emails."
                    : "Creating subdomain in Plesk, provisioning SSL, and sending welcome email. This may take up to 30 seconds."}
                </p>
              </div>
            </div>
          </div>
        )}
        {/* Colour only when a count needs attention: a zero stays quiet. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[color:var(--row-line)] bg-[color:var(--row-line)] lg:grid-cols-4">
          {[
            { label: "Total", value: rows.length, alert: "" },
            { label: "Active", value: active, alert: "" },
            { label: "Expiring in 30 days", value: expiringSoon, alert: "text-amber-800" },
            { label: "Expired", value: expired, alert: "text-red-800" },
          ].map((s) => (
            <div key={s.label} className="bg-card px-6 py-4">
              <dt className="text-[13px] text-muted-foreground">{s.label}</dt>
              <dd className={`mt-1 font-display text-[26px] font-semibold leading-none tabular-nums ${s.value > 0 && s.alert ? s.alert : "text-[#1B2C42]"}`}>
                {loading ? "–" : s.value}
              </dd>
            </div>
          ))}
        </dl>

        <ClubWebsitesListSection v={v} />

        {/* Add / Edit Dialog */}
        <EditWebsiteDialog v={v} />

        {/* Logs Dialog */}
        <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Activity Log</DialogTitle></DialogHeader>
            {logsLoading ? (
              <div className="flex justify-center py-12"><ListPageSkeleton /></div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No log entries.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Action</TableHead>
                  <TableHead>By</TableHead><TableHead>Details</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logs.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{new Date(l.performedDate).toLocaleString(appLocale())}</TableCell>
                      <TableCell><Badge variant="outline">{l.action}</Badge></TableCell>
                      <TableCell className="text-xs">{l.performedByName || (l.performedBy === 0 ? "System" : "–")}</TableCell>
                      <TableCell className="text-xs">{l.details || "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DialogContent>
        </Dialog>

        {/* Plesk Raw Diagnostic Dialog */}
        <Dialog open={diagOpen} onOpenChange={setDiagOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Plesk Raw Diagnostic</DialogTitle></DialogHeader>
            <div className="flex gap-2 flex-wrap mb-2">
              <Button size="sm" variant={diagType === "list-subdomains" ? "default" : "outline"} onClick={() => runDiag("list-subdomains")}>Subdomains</Button>
              <Button size="sm" variant={diagType === "list-sites" ? "default" : "outline"} onClick={() => runDiag("list-sites")}>Sites / Domains</Button>
              <Button size="sm" variant={diagType === "list-webspaces" ? "default" : "outline"} onClick={() => runDiag("list-webspaces")}>Webspaces</Button>
            </div>
            {diagLoading ? (
              <div className="flex justify-center py-12"><ListPageSkeleton /></div>
            ) : diagData ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold">Request XML sent to Plesk</Label>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{diagData.request}</pre>
                </div>
                <div>
                  <Label className="text-xs font-semibold">Response XML from Plesk</Label>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{diagData.response}</pre>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDiagOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* SSL Diagnostic Dialog */}
        <Dialog open={sslDiagOpen} onOpenChange={setSslDiagOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>SSL Diagnostic (raw Plesk XML)</DialogTitle></DialogHeader>
            {sslDiagLoading ? (
              <div className="flex justify-center py-12"><ListPageSkeleton /></div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">Copy this full output and paste it back in chat. It shows exactly how Plesk represents this subdomain and which endpoint exposes cert properties.</p>
                <Textarea readOnly value={sslDiagText} className="font-mono h-[60vh]" onFocus={(e) => e.currentTarget.select()} />
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(sslDiagText); setSuccessMessage("Copied to clipboard."); }}>Copy</Button>
              <Button variant="outline" onClick={() => setSslDiagOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Plesk Subdomains List Dialog */}
        <Dialog open={pleskListOpen} onOpenChange={setPleskListOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>All Subdomains in Plesk ({pleskList.length})</DialogTitle></DialogHeader>
            {pleskListLoading ? (
              <div className="flex justify-center py-12"><ListPageSkeleton /></div>
            ) : pleskList.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No subdomains found in Plesk.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Plesk ID</TableHead><TableHead>Subdomain</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pleskList.map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{s.id}</TableCell>
                      <TableCell className="font-mono">{s.name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPleskListOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Settings Dialog */}
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Club Website Settings</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Parent Domain</Label>
                <Input value={settingsParent} onChange={(e) => setSettingsParent(sanitizeDomainInput(e.target.value))} placeholder="e.g., portal.example.org" />
                <p className="text-xs text-muted-foreground mt-1">All club subdomains are created under this domain. Changing this does not rewrite existing records.</p>
              </div>
              <div>
                <Label>Default Reminder Days</Label>
                <Input type="number" min="1" max="180" value={settingsDays} onChange={(e) => setSettingsDays(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">
                  Reminders start this many days before expiry. Can be overridden per-record.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button onClick={saveSettings}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
        </TabsContent>
        <TabsContent value="training">
          <WebsiteTrainingAppointmentsTab />
        </TabsContent>
        {/* When the training team is free / blocked — drives the club's "Request a Training Date". */}
        <TabsContent value="availability">
          <TrainingAvailabilityTab />
        </TabsContent>
      </Tabs>
    </ProtectedRoute>
  );
}
