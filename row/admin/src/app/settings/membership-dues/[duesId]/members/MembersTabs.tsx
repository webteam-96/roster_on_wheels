import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Mail, MoreHorizontal, Receipt, CreditCard, Pencil, Check, X, Undo2 } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import { ListPageSkeleton } from "@/components/row/AppKit";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function MembersTabs({ v }: { v: DuesMembersCtx }) {
  const { activeTab, setActiveTab, allCount, paidCount, unpaidCount, pendingCount, loading, duesDetail, fees1Label, offlineOnly, fees2Label, fees3Label, sortedMembers, colCount, rowBgClass, formatCurrency, renderVendorCell, balanceClass, getPaymentChannelIcon, busyAction, openEditDialog, openOfflineDialog, emailOn, getUnpaidFeeTypes, openReminderEmailDialog, isFullyPaid, handleSendReceipt, openApproveDialog, isSuperAdmin, getPaidFeeTypes, openRevertDialog } = v;
  return (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All ({allCount})</TabsTrigger>
            <TabsTrigger value="paid">Paid ({paidCount})</TabsTrigger>
            <TabsTrigger value="unpaid">Unpaid ({unpaidCount})</TabsTrigger>
            <TabsTrigger value="pending">Pending Approval ({pendingCount})</TabsTrigger>
          </TabsList>

          {["all", "paid", "unpaid", "pending"].map(tab => (
            <TabsContent key={tab} value={tab}>
              {loading ? (
                <div className="flex justify-center py-10"><ListPageSkeleton /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">Sr.No</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category Type</TableHead>
                        {duesDetail?.isFees1 && (
                          <>
                            <TableHead className="text-right">{fees1Label} Amount</TableHead>
                            {!offlineOnly && <TableHead className="text-center">{fees1Label} Accounts</TableHead>}
                            <TableHead className="text-right">{fees1Label} Balance</TableHead>
                          </>
                        )}
                        {duesDetail?.isFees2 && (
                          <>
                            <TableHead className="text-right">{fees2Label} Amount</TableHead>
                            {!offlineOnly && <TableHead className="text-center">{fees2Label} Accounts</TableHead>}
                            <TableHead className="text-right">{fees2Label} Balance</TableHead>
                          </>
                        )}
                        {duesDetail?.isFees3 && (
                          <>
                            <TableHead className="text-right">{fees3Label} Amount</TableHead>
                            {!offlineOnly && <TableHead className="text-center">{fees3Label} Accounts</TableHead>}
                            <TableHead className="text-right">{fees3Label} Balance</TableHead>
                          </>
                        )}
                        <TableHead className="w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedMembers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                            No members found
                          </TableCell>
                        </TableRow>
                      ) : sortedMembers.map((m, index) => (
                        <TableRow key={m.id} className={rowBgClass(m)}>
                          <TableCell className="text-center">{index + 1}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap">
                            {m.memberName || "-"}
                            {m.isNewMember && <Badge variant="secondary" className="ml-2">New</Badge>}
                            {m.hasPendingApproval && <Badge variant="outline" className="ml-2 border-yellow-500 text-yellow-700">Pending</Badge>}
                          </TableCell>
                          <TableCell>{m.categoryType || "-"}</TableCell>
                          {duesDetail?.isFees1 && (
                            <>
                              <TableCell className="text-right">{formatCurrency(m.fees1Amount)}</TableCell>
                              {!offlineOnly && <TableCell className="text-center">{renderVendorCell(m.annualVendors)}</TableCell>}
                              <TableCell className={`text-right ${balanceClass(m.fees1Balance)}`}>
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(m.fees1Balance)}</span>
                                  {(m.fees1Balance ?? 0) === 0 && (((m as any).annualPaid ?? 0) > 0) && getPaymentChannelIcon(m, 1)}
                                </div>
                              </TableCell>
                            </>
                          )}
                          {duesDetail?.isFees2 && (
                            <>
                              <TableCell className="text-right">{formatCurrency(m.fees2Amount)}</TableCell>
                              {!offlineOnly && <TableCell className="text-center">{renderVendorCell(m.semi1Vendors)}</TableCell>}
                              <TableCell className={`text-right ${balanceClass(m.fees2Balance)}`}>
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(m.fees2Balance)}</span>
                                  {(m.fees2Balance ?? 0) === 0 && (((m as any).semi1Paid ?? 0) > 0) && getPaymentChannelIcon(m, 2)}
                                </div>
                              </TableCell>
                            </>
                          )}
                          {duesDetail?.isFees3 && (
                            <>
                              <TableCell className="text-right">{formatCurrency(m.fees3Amount)}</TableCell>
                              {!offlineOnly && <TableCell className="text-center">{renderVendorCell(m.semi2Vendors)}</TableCell>}
                              <TableCell className={`text-right ${balanceClass(m.fees3Balance)}`}>
                                <div className="flex flex-col items-end">
                                  <span>{formatCurrency(m.fees3Balance)}</span>
                                  {(m.fees3Balance ?? 0) === 0 && (((m as any).semi2Paid ?? 0) > 0) && getPaymentChannelIcon(m, 3)}
                                </div>
                              </TableCell>
                            </>
                          )}
                          <TableCell>
                            {/* Per-row busy check: when any action for this row is in flight,
                                show the spinner inline (the dropdown trigger gets replaced).
                                Match keys defined in handleSendReceipt. */}
                            {(() => {
                              const rowBusy =
                                busyAction != null && (
                                  busyAction.startsWith(`wa-${m.id}-`) ||
                                  busyAction === `receipt-${m.pendingPaymentId || m.id}`
                                );
                              if (rowBusy) {
                                return (
                                  <div className="flex items-center justify-center w-10 h-10">
                                    <RotaryLoader size="sm" />
                                  </div>
                                );
                              }
                              return (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button aria-label="More actions" variant="ghost" size="icon" disabled={busyAction !== null}>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openEditDialog(m)}>
                                      <Pencil className="h-4 w-4 mr-2" />Edit Fee
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openOfflineDialog(m)}>
                                      <CreditCard className="h-4 w-4 mr-2" />Offline Entry
                                    </DropdownMenuItem>
                                    {/* Reminder sub-items: one per unpaid fee type */}
                                    {emailOn && getUnpaidFeeTypes(m).map(ft => (
                                      <DropdownMenuItem
                                        key={`email-${ft.value}`}
                                        onClick={() => {
                                          if (window.confirm(`Send email reminder to ${m.memberName || "this member"}?`)) {
                                            openReminderEmailDialog(m.id, ft.value);
                                          }
                                        }}
                                      >
                                        <Mail className="h-4 w-4 mr-2" />Email Reminder ({ft.label})
                                      </DropdownMenuItem>
                                    ))}
                                    {emailOn && isFullyPaid(m) && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          if (window.confirm(`Send receipt to ${m.memberName || "this member"}?`)) {
                                            handleSendReceipt(m.pendingPaymentId || m.id);
                                          }
                                        }}
                                      >
                                        <Receipt className="h-4 w-4 mr-2" />Send Receipt
                                      </DropdownMenuItem>
                                    )}
                                    {m.hasPendingApproval && m.pendingPaymentId && (
                                      <>
                                        <DropdownMenuItem onClick={() => openApproveDialog(m.pendingPaymentId!, "approve", m)} className="text-green-600">
                                          <Check className="h-4 w-4 mr-2" />Approve
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => openApproveDialog(m.pendingPaymentId!, "reject", m)} className="text-red-600">
                                          <X className="h-4 w-4 mr-2" />Reject
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                    {/* SuperAdmin-only status correction — one entry per fee
                                        type that is currently Paid. Hidden while an offline
                                        payment is awaiting approval (that has Reject). */}
                                    {isSuperAdmin && !m.hasPendingApproval && getPaidFeeTypes(m).map(ft => (
                                      <DropdownMenuItem
                                        key={`revert-${ft.value}`}
                                        disabled={ft.isOnline}
                                        onClick={() => { if (!ft.isOnline) openRevertDialog(m, ft); }}
                                        className={ft.isOnline ? "" : "text-orange-600"}
                                      >
                                        <Undo2 className="h-4 w-4 mr-2" />
                                        {ft.isOnline
                                          ? `Revert ${ft.label} (online. Not allowed)`
                                          : `Revert ${ft.label} to Unpaid`}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
  );
}
