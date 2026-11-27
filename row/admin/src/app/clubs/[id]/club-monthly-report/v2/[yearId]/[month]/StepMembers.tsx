import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Users, Loader2, RefreshCw } from "@/components/icons";
import { SectionCard } from "./monthlyReportWizardShared";
import type { MonthlyReportWizardCtx } from "./useMonthlyReportWizard";

export default function StepMembers({ v }: { v: MonthlyReportWizardCtx }) {
  const { currentStep, recalcMemberStats, recalculating, memberCountLastMonth, setMemberCountLastMonth, membersDeleted, setMembersDeleted, membersAdded, setMembersAdded, additionalRemarks, setAdditionalRemarks } = v;
  return (
    <>
      {currentStep === 3 && (
        <SectionCard
          icon={Users}
          title="Members Info"
          action={
            <Button
              type="button"
              onClick={recalcMemberStats}
              disabled={recalculating}
              variant="outline" size="sm"
            >
              {recalculating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Recalculate from members
            </Button>
          }
        >
          <p className="text-xs text-slate-500 mb-5">
            Auto-filled from the club&apos;s member records: last-month count (as at the 1st),
            plus joins and terminations dated within this month. Adjust if needed; the current
            count auto-calculates below.
          </p>
          <div className="grid gap-4 max-w-xl">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Member count as on last month <span className="text-rose-600">*</span>
              </label>
              <Input
                type="number"
                min={0}
                value={memberCountLastMonth}
                onChange={(e) => setMemberCountLastMonth(parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Members Deleted/Terminated <span className="text-rose-600">*</span>
              </label>
              <Input
                type="number"
                min={0}
                value={membersDeleted}
                onChange={(e) => setMembersDeleted(parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Members Added <span className="text-rose-600">*</span>
              </label>
              <Input
                type="number"
                min={0}
                value={membersAdded}
                onChange={(e) => setMembersAdded(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Current No. Of Members</span>
              <span className="text-2xl font-bold text-blue-700 tabular-nums">
                {memberCountLastMonth - membersDeleted + membersAdded}
              </span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Additional achievement / participation / hosting of events / projects above club if any
              </label>
              <Textarea
                maxLength={1000}
                rows={4}
                value={additionalRemarks}
                onChange={(e) => setAdditionalRemarks(e.target.value)}
                placeholder="Please input details of participation /hosting of events or projects above club level with Date, short description, Participated Rotarians etc."
              />
              <p className="text-[10px] text-slate-500 mt-1 text-right tabular-nums">
                {additionalRemarks.length}/1000 characters
              </p>
            </div>
          </div>
        </SectionCard>
      )}
    </>
  );
}
