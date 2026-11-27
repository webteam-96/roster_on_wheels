import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mail } from "@/components/icons";
import { ListPageSkeleton } from "@/components/row/AppKit";
import Pagination from "@/components/Pagination";
import { LinkButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";
import type { DuesMembersCtx } from "./useDuesMembers";

export default function DuesMembersTable({ v }: { v: DuesMembersCtx }) {
  const { loading, enabledFeeTypes, paged, currentPage, pageSize, isNotAllocated, getRowColor, getEditFeeStatus, cur, getDisplayFeeAmount, getStatusBadge, getPaymentChannelIcon, openOfflineEntry, getUnpaidFeeTypes, emailOn, setEmailRemarkMemberFeeId, setEmailRemark, setEmailRemarkDialogOpen, hasAnyPaidFee, handleReceipt, openApprovePopup, openRejectPopup, totalPages, members, setCurrentPage } = v;
  return (
    <>
        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Sr.</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    {enabledFeeTypes.map(ft => (
                      <TableHead key={ft.type} className="text-center">{ft.label}</TableHead>
                    ))}
                    <TableHead className="text-center">Offline Entry</TableHead>
                    <TableHead className="text-center">Reminder</TableHead>
                    <TableHead className="text-center">Receipt</TableHead>
                    <TableHead className="text-center">Approve/Reject</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.length === 0 ? (
                    <TableRow><TableCell colSpan={20} className="text-center text-muted-foreground py-8">No members found</TableCell></TableRow>
                  ) : paged.map((m, idx) => {
                    const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                    const isNew = isNotAllocated(m);
                    const isPending = m.hasPendingApproval || m.HasPendingApproval;
                    return (
                      <TableRow key={m.memberFeeId || idx} className={`border-b ${getRowColor(m)}`}>
                        <TableCell className="text-center">{globalIdx}</TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {m.memberName || "-"}
                          {m.isNewMember && <Badge variant="secondary" className="ml-2">New</Badge>}
                          {isPending && <Badge variant="outline" className="ml-2 border-yellow-500 text-yellow-700">Pending</Badge>}
                        </TableCell>
                        <TableCell>{m.categoryType || "-"}</TableCell>

                        {/* Fee Amount + Status merged into one column per fee type */}
                        {enabledFeeTypes.map(ft => {
                          const status = getEditFeeStatus(m, ft.type);
                          return (
                            <TableCell key={ft.type} className="text-center">
                              {status === "N/A" ? (
                                <span className="text-muted-foreground">N/A</span>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <span>{cur}{getDisplayFeeAmount(m, ft.type).toFixed(0)}</span>
                                  {getStatusBadge(status)}
                                  {status === "Paid" && getPaymentChannelIcon(m, ft.type)}
                                </div>
                              )}
                            </TableCell>
                          );
                        })}

                        {/* Offline Entry — one button per row; dialog auto-pre-fills from
                            pending/paid-offline based on the fee type the admin picks. */}
                        <TableCell className="text-center">
                          {!isNew && (
                            <LinkButton
                              onClick={() => openOfflineEntry(m)} className="whitespace-nowrap" size="sm">
                              Offline Entry
                            </LinkButton>
                          )}
                        </TableCell>

                        <TableCell>
                          {!isNew && getUnpaidFeeTypes(m).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {emailOn && (
                              <IconButton title="Send Email Reminder" onClick={() => { setEmailRemarkMemberFeeId(m.memberFeeId); setEmailRemark(""); setEmailRemarkDialogOpen(true); }} type="button" aria-label="Send Email Reminder">
                                <Mail className="h-4 w-4" />
                              </IconButton>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* Receipt — same as SuperAdmin */}
                        <TableCell>
                          {!isNew && hasAnyPaidFee(m) && emailOn && (
                            <LinkButton onClick={() => handleReceipt(m.memberFeeId)} className="whitespace-nowrap" tone="muted" size="sm">Send</LinkButton>
                          )}
                        </TableCell>

                        {/* Approve/Reject — same as SuperAdmin: Approve direct, Reject dialog */}
                        <TableCell>
                          {!isNew && isPending && (
                            <div className="flex gap-1">
                              <LinkButton onClick={() => openApprovePopup(m)} size="sm">Approve</LinkButton>
                              <LinkButton onClick={() => openRejectPopup(m)} tone="danger" size="sm">Reject</LinkButton>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4"><Pagination page={currentPage} totalPages={totalPages} totalCount={members.length} pageSize={pageSize} onPageChange={setCurrentPage} /></div>
            )}
          </>
        )}
    </>
  );
}
