import { IconButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { Mail, Search } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appLocale } from "@/lib/appFormat";
import { ClearButton, LinkButton } from "@/components/ui/text-buttons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusChip, isPendingMember } from "./duesV2MembersShared";
import type { DuesV2MembersCtx } from "./useDuesV2Members";

export default function DuesMembersCard({ v }: { v: DuesV2MembersCtx }) {
  const { members, filter, setFilter, searchInput, setSearchInput, emailOn, setBulkEmailConfirmOpen, loading, enabledFeeTypes, canManage, paged, currentPage, pageSize, isNotAllocated, getRowBgClass, getEditFeeStatus, cur, getDisplayFeeAmount, getPaymentChannelIcon, openOfflineEntry, getUnpaidFeeTypes, handleEmailReminder, hasAnyPaidFee, receiptSendingId, handleReceipt, openApprovePopup, openRejectPopup } = v;
  return (
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="row-h3">Member Payments</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage offline entries, reminders &amp; receipts · {members.length} member
                  {members.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-auto"
                >
                  <option value="">All Members</option>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="pending">Pending Approval</option>
                </NativeSelect>
                <div className="relative w-full sm:w-auto">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search by name…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-7 pr-7 sm:w-56"
                  />
                  {searchInput && (
                    <ClearButton
                      type="button"
                      onClick={() => setSearchInput("")}
                      aria-label="Clear search" />
                  )}
                </div>
                {emailOn && (
                <Button
                  type="button"
                  onClick={() => setBulkEmailConfirmOpen(true)}
                  title="Click here to send Email reminders to all unpaid members"
                  variant="outline" size="sm"
                >
                  <Mail size={13} /> Click here to send Email reminders to all unpaid members
                </Button>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="px-5 py-2 border-b border-slate-100 flex gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> Pending Approval
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> New Member
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RotaryLoader size="md" label="Loading members…" />
                </div>
              ) : (
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left w-10">Sr</TableHead>
                      <TableHead className="text-left">Name</TableHead>
                      <TableHead className="text-left">Category</TableHead>
                      {enabledFeeTypes.map((ft) => (
                        <TableHead key={`f-${ft.type}`} className="text-center">
                          {ft.label}
                        </TableHead>
                      ))}
                      {canManage && (<>
                        <TableHead className="text-center">Offline Entry</TableHead>
                        <TableHead className="text-center">Reminder</TableHead>
                        <TableHead className="text-center">Receipt</TableHead>
                        <TableHead className="text-center">Approve / Reject</TableHead>
                      </>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={20} className="py-10 text-center text-muted-foreground">
                          No members found.
                        </TableCell>
                      </TableRow>
                    ) : paged.map((m, idx) => {
                      const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                      const isNew = isNotAllocated(m);
                      const isPending = isPendingMember(m);
                      return (
                        <TableRow key={m.memberFeeId || idx} className={getRowBgClass(m)}>
                          <TableCell>{globalIdx}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{m.memberName || "–"}</span>
                              {m.isNewMember && (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                                  New
                                </span>
                              )}
                              {isPending && (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                  Pending
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{m.categoryType || "–"}</TableCell>

                          {/* Fee Amount (the ONE true base amount,
                              comma-formatted — sum matches the dashboard's
                              Total Amount tile) + Status merged into one
                              column per fee type. */}
                          {enabledFeeTypes.map((ft) => {
                            const st = getEditFeeStatus(m, ft.type);
                            return (
                              <TableCell key={`f-${ft.type}`} className="text-center">
                                {st === "N/A" ? (
                                  <span className="text-slate-400">N/A</span>
                                ) : (
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-slate-700">{cur}{getDisplayFeeAmount(m, ft.type).toLocaleString(appLocale())}</span>
                                    {statusChip(st)}
                                    {st === "Paid" && getPaymentChannelIcon(m, ft.type)}
                                  </div>
                                )}
                              </TableCell>
                            );
                          })}

                          {/* Offline Entry / Reminder / Receipt / Approve are all
                              management actions on a year this member may not
                              administer — the header columns hide with them so the
                              table does not shear. */}
                          {canManage && (<>
                          {/* Offline Entry — single button, smart fee-type pre-fill */}
                          <TableCell className="text-center">
                            {!isNew && (
                              <LinkButton
                                type="button"
                                 onClick={() => openOfflineEntry(m)}
                               className="whitespace-nowrap" size="sm">
                                Offline Entry
                              </LinkButton>
                            )}
                          </TableCell>

                          {/* Reminder */}
                          <TableCell className="text-center">
                            {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                              <div className="inline-flex items-center gap-2">
                                {emailOn && (
                                <IconButton
                                  type="button"
                                   title="Send Email Reminder"
                                  onClick={() => {
                                    if (window.confirm(`Send email reminder to ${m.memberName || "this member"}?`)) {
                                      handleEmailReminder(m.memberFeeId, 0);
                                    }
                                  }}
                                >
                                  <Mail size={14} />
                                </IconButton>
                                )}
                              </div>
                            )}
                          </TableCell>

                          {/* Receipt */}
                          <TableCell className="text-center">
                            {!isNew && hasAnyPaidFee(m) && emailOn && (
                              receiptSendingId === m.memberFeeId ? (
                                <RotaryLoader size="sm" label="Sending…" />
                              ) : (
                                <LinkButton
                                  type="button"
                                  disabled={receiptSendingId !== null}
                                   onClick={() => {
                                    if (window.confirm(`Send receipt to ${m.memberName || "this member"}?`)) {
                                      handleReceipt(m.memberFeeId);
                                    }
                                  }}
                                 className="whitespace-nowrap" tone="muted" size="sm">
                                  Send
                                </LinkButton>
                              )
                            )}
                          </TableCell>

                          {/* Approve / Reject */}
                          <TableCell className="text-center">
                            {!isNew && isPending && (
                              <div className="inline-flex items-center gap-2">
                                <LinkButton
                                  type="button"
                                   onClick={() => openApprovePopup(m)}
                                 size="sm">
                                  Approve
                                </LinkButton>
                                <span className="text-slate-300">|</span>
                                <LinkButton
                                  type="button"
                                   onClick={() => openRejectPopup(m)}
                                 tone="danger" size="sm">
                                  Reject
                                </LinkButton>
                              </div>
                            )}
                          </TableCell>
                          </>)}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
              {members.length} member{members.length === 1 ? "" : "s"}
            </div>
          </Card>
  );
}
