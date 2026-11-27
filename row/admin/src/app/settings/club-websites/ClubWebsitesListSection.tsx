import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Pagination from "@/components/Pagination";
import { Pencil, Trash2, Power, PowerOff, Send, FileText, Download, AlertTriangle, XCircle, RotateCw, Loader2, Lock, ChevronDown, Zap, MoreHorizontal, Search } from "@/components/icons";
import { appLocale } from "@/lib/appFormat";
import { SearchField, SkeletonRows } from "@/components/row/AppKit";
import { toVisitUrl, PAGE_SIZE, LIST_HEAD, statusBadge } from "./clubWebsitesShared";
import type { ClubWebsitesCtx } from "./useClubWebsites";

export default function ClubWebsitesListSection({ v }: { v: ClubWebsitesCtx }) {
  const { loadRows, search, setSearch, statusFilter, setStatusFilter, districtFilter, setDistrictFilter, districts, filteredRows, exportExcel, exportThirdPartyDomains, selectedIds, bulkTrialDays, setBulkTrialDays, doBulkStartTrial, bulkBusy, setSelectedIds, loading, pagedRows, parentDomain, busyId, openEdit, doToggle, doRetry, doForceActivate, hasPlesk, doRetrySsl, doReminder, viewLogs, doDeleteDbOnly, doDelete, currentPage, totalPages, setPage } = v;
  return (
        <section className="row-card row-rise overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-6 py-4">
            <div className="w-full sm:w-72" onKeyDown={(e) => e.key === "Enter" && loadRows()}>
              <SearchField
                label="Search club or subdomain"
                placeholder="Search club or subdomain"
                value={search}
                onChange={setSearch}
                icon={<Search className="h-4 w-4" />}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
                <SelectItem value="Expired">Expired</SelectItem>
                <SelectItem value="ActivationFailed">Activation Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={districtFilter || "all"} onValueChange={(v) => setDistrictFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by district"><SelectValue placeholder="District" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {districts.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-3 sm:ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={filteredRows.length === 0}>
                    <Download className="mr-2 h-4 w-4" />Export<ChevronDown className="ml-2 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={exportExcel}>Export Excel</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportThirdPartyDomains} title="Export report focused on Third party Domains (all rows)">
                    Export Third party Domains
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Bulk Start-Trial toolbar — visible only when at least 1 row is selected. */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--row-line)] bg-muted px-6 py-3">
              <div className="text-sm text-[#1B2C42]">
                <span className="font-semibold">{selectedIds.size}</span> selected. Start a trial period and notify President + Secretary.
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
                <Label className="text-xs whitespace-nowrap">Trial Period (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={bulkTrialDays}
                  onChange={(e) => setBulkTrialDays(e.target.value)}
                  className="row-field-sm w-24"
                />
                <Button size="sm" onClick={doBulkStartTrial} disabled={bulkBusy}>
                  {bulkBusy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Zap className="mr-2 h-3 w-3" />}
                  Start Trial & Notify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="border-t border-[color:var(--row-line)] px-6 py-4"><SkeletonRows rows={6} /></div>
          ) : filteredRows.length === 0 ? (
            <div className="border-t border-[color:var(--row-line)] py-20 text-center text-[15px] text-muted-foreground">No websites found.</div>
          ) : (
            <Table className="text-[14px]">
              <TableHeader><TableRow>
                <TableHead className="w-10 pl-6">
                  <Checkbox
                    checked={pagedRows.length > 0 && pagedRows.every(r => selectedIds.has(r.id))}
                    onCheckedChange={(checked) => {
                      // This page only: bulk trial emails each selected club, so never tick rows the admin cannot see.
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        pagedRows.forEach(r => { if (checked) next.add(r.id); else next.delete(r.id); });
                        return next;
                      });
                    }}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead className={LIST_HEAD}>District</TableHead>
                <TableHead className={LIST_HEAD}>Club</TableHead>
                <TableHead className={LIST_HEAD}>Address</TableHead>
                <TableHead className={LIST_HEAD}>Template</TableHead>
                <TableHead className={LIST_HEAD}>Term</TableHead>
                <TableHead className={LIST_HEAD}>Status</TableHead>
                <TableHead className={`${LIST_HEAD} pr-6 text-right`}>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pagedRows.map(r => {
                  // Phase 4 kill-switch: row is "chain inactive" when its club, district, or zone is inactive.
                  const chainInactive = r.chainActive === 0;
                  const subUrl = toVisitUrl(r.subdomain, parentDomain);
                  const clientUrl = r.clientDomain ? toVisitUrl(r.clientDomain) : null;
                  const isPaid = !!r.isPurchased || (r.amountPaid != null && r.amountPaid > 0) || !!(r.transactionId && r.transactionId.trim());
                  const trialLabel = r.daysLeft > 0 ? `${r.daysLeft}d left` : (r.daysLeft === 0 ? "ends today" : "expired");
                  const rowBusy = !!busyId && busyId.startsWith(`${r.id}-`);
                  return (
                  <TableRow key={r.id} className={selectedIds.has(r.id) ? "bg-muted" : "hover:bg-muted/70"}>
                    <TableCell className="pl-6">
                      <Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={(checked) => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(r.id); else next.delete(r.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${r.clubName}`}
                      />
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums text-[#1B2C42]">D{r.districtNumber}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold text-[#1B2C42]">{r.clubName}</div>
                        {chainInactive && <Badge variant="destructive">Inactive</Badge>}
                      </div>
                      <div className="text-[13px] tabular-nums text-muted-foreground">{r.clubRotaryId}</div>
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      {subUrl ? (
                        <a
                          href={subUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-[#17458F] hover:underline"
                          title={`Open ${subUrl} in new tab`}
                        >
                          {subUrl.replace(/^https:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{r.subdomain}</span>
                      )}
                      {/* Imported rows often repeat the subdomain as the client domain: show it only when it differs. */}
                      {r.clientDomain && clientUrl !== subUrl && (
                        clientUrl ? (
                          <a
                            href={clientUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-[13px] text-muted-foreground hover:text-[#17458F] hover:underline"
                            title={`Open ${clientUrl} in new tab`}
                          >
                            {clientUrl.replace(/^https:\/\//, "")}
                          </a>
                        ) : (
                          <span className="block truncate text-[13px] text-muted-foreground">{r.clientDomain}</span>
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-[#1B2C42]">{r.themeName || "–"}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">
                      <div>{r.startDate ? new Date(r.startDate).toLocaleDateString(appLocale()) : "–"}</div>
                      <div>{r.endDate ? new Date(r.endDate).toLocaleDateString(appLocale()) : "–"}</div>
                    </TableCell>
                    <TableCell>
                      {statusBadge(r.status, r.daysLeft)}
                      <div className="mt-1 whitespace-nowrap text-[12px] text-muted-foreground">{isPaid ? "Purchased" : `Trial · ${trialLabel}`}</div>
                    </TableCell>
                    <TableCell className="pr-6">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit website details" aria-label={`Edit ${r.clubName}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" title="More actions" aria-label={`More actions for ${r.clubName}`}>
                              {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            {chainInactive && (
                              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Inactive: reactivate from Clubs/Districts page</DropdownMenuLabel>
                            )}
                            <DropdownMenuItem onClick={() => doToggle(r)} disabled={rowBusy || chainInactive} title={r.status === "Active" ? "Deactivate website" : "Activate website (creates subdomain in Plesk + sends welcome email)"}>
                              {r.status === "Active" ? <><PowerOff className="mr-2 h-4 w-4" />Deactivate website</> : <><Power className="mr-2 h-4 w-4" />Activate website</>}
                            </DropdownMenuItem>
                            {r.status === "ActivationFailed" && (
                              <>
                                <DropdownMenuItem onClick={() => doRetry(r.id)} disabled={rowBusy || chainInactive} title="Retry Plesk activation">
                                  <RotateCw className="mr-2 h-4 w-4" />Retry activation
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => doForceActivate(r.id)} disabled={rowBusy || chainInactive} title="Force Activate (skip Plesk: manual setup required)">
                                  <AlertTriangle className="mr-2 h-4 w-4" />Force activate
                                </DropdownMenuItem>
                              </>
                            )}
                            {hasPlesk && r.status === "Active" && (
                              <DropdownMenuItem onClick={() => doRetrySsl(r.id)} disabled={rowBusy || chainInactive} title="Re-apply wildcard SSL certificate in Plesk (use if site shows 'not secure')">
                                <Lock className="mr-2 h-4 w-4" />Re-apply SSL
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => doReminder(r.id)} disabled={rowBusy || r.status !== "Active" || chainInactive} title="Send renewal reminder email to Pres/Sec now (Active websites only)">
                              <Send className="mr-2 h-4 w-4" />Send renewal reminder
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => viewLogs(r.id)} title="View activity log (all changes, activations, reminders)">
                              <FileText className="mr-2 h-4 w-4" />View activity log
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => doDeleteDbOnly(r.id)} disabled={rowBusy || chainInactive} className="text-red-600 focus:text-red-700" title="Delete portal record only (keep Plesk subdomain intact)">
                              <XCircle className="mr-2 h-4 w-4" />Delete portal record only
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => doDelete(r.id)} disabled={rowBusy || chainInactive} className="text-red-600 focus:text-red-700" title="Delete website: removes from Plesk + portal">
                              <Trash2 className="mr-2 h-4 w-4" />Delete website
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {!loading && filteredRows.length > 0 && (
            <div className="border-t border-[color:var(--row-line)] px-6 py-4">
              <Pagination page={currentPage} totalPages={totalPages} totalCount={filteredRows.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          )}
        </section>
  );
}
