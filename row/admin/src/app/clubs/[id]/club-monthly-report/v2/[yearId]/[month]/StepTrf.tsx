import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { IconButton } from "@/components/ui/icon-button";
import { Plus, Pencil, Trash2, DollarSign, Loader2 } from "@/components/icons";
import LoadingLink from "@/components/v2/LoadingLink";
import { formatDate, SectionCard } from "./monthlyReportWizardShared";
import type { MonthlyReportWizardCtx } from "./useMonthlyReportWizard";

export default function StepTrf({ v }: { v: MonthlyReportWizardCtx }) {
  const { currentStep, addTrfHref, trfContributions, editTrfHref, handleDeleteTrf, deletingTrfId } = v;
  return (
    <>
      {currentStep === 1 && (
        <SectionCard
          icon={DollarSign}
          title="TRF Contributions"
          action={
            <LoadingLink
              href={addTrfHref}
              className="row-btn row-btn-primary row-btn-sm"
            >
              <Plus size={12} /> Add TRF
            </LoadingLink>
          }
        >
          {trfContributions.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No TRF contributions for this month</p>
              <p className="text-xs text-slate-500 mt-1">Click &quot;Add TRF&quot; to manage</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px] md:min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-12">#</TableHead>
                    <TableHead className="text-left">Date</TableHead>
                    <TableHead className="text-left">Name</TableHead>
                    <TableHead className="text-right">Amount (USD)</TableHead>
                    <TableHead className="text-left">Fund Type</TableHead>
                    <TableHead className="text-right w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trfContributions.map((entry, idx) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-slate-500 tabular-nums">{idx + 1}</TableCell>
                      <TableCell className="text-slate-700 whitespace-nowrap">{formatDate(entry.trfDate)}</TableCell>
                      <TableCell className="font-medium text-slate-800">{entry.donorName}</TableCell>
                      <TableCell className="text-right tabular-nums">${entry.amountUSD.toLocaleString()}</TableCell>
                      <TableCell className="text-slate-700">
                        {entry.fundType === "Others" ? entry.otherFundName || "Others" : entry.fundType}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <LoadingLink
                            href={editTrfHref(entry.id)}
                            className="row-icon-btn"
                            aria-label="Edit"
                          >
                            <Pencil size={12} />
                          </LoadingLink>
                          <IconButton
                            type="button"
                            onClick={() => handleDeleteTrf(entry.id)}
                            disabled={deletingTrfId === entry.id}
                            className="text-rose-600"
                            aria-label="Delete"
                          >
                            {deletingTrfId === entry.id
                              ? <Loader2 className="animate-spin" size={12} />
                              : <Trash2 size={12} />}
                          </IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right text-xs font-semibold text-slate-700">Total</TableCell>
                    <TableCell className="text-right text-sm font-bold tabular-nums text-blue-700">
                      ${trfContributions.reduce((sum, e) => sum + e.amountUSD, 0).toLocaleString()} USD
                    </TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}
