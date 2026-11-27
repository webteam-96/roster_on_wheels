import Link from "next/link";
import { ArrowLeft, ArrowRight, FileText } from "@/components/icons";
import LoadingButton from "@/components/v2/LoadingButton";
import type { MonthlyReportWizardCtx } from "./useMonthlyReportWizard";

export default function WizardFooter({ v }: { v: MonthlyReportWizardCtx }) {
  const { currentStep, handlePrevious, saving, cmrLandingHref, handleNext, handleSaveAndGenerate } = v;
  return (
      <div className="sticky bottom-0 -mx-2 sm:-mx-0 bg-card border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        {currentStep > 0 ? (
          <LoadingButton
            type="button"
            onAction={handlePrevious}
            forcePending={saving}
            spinnerSize={14}
            className="row-btn row-btn-secondary row-btn-sm"
          >
            <ArrowLeft size={14} /> Previous
          </LoadingButton>
        ) : <span />}

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={cmrLandingHref}
            className="row-btn row-btn-secondary row-btn-sm"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          {currentStep < 3 ? (
            <LoadingButton
              type="button"
              onAction={handleNext}
              forcePending={saving}
              loadingLabel="Saving…"
              spinnerSize={14}
              className="row-btn row-btn-primary row-btn-sm"
            >
              Save and Next <ArrowRight size={14} />
            </LoadingButton>
          ) : (
            <LoadingButton
              type="button"
              onAction={handleSaveAndGenerate}
              forcePending={saving}
              loadingLabel="Saving…"
              spinnerSize={14}
              className="row-btn row-btn-primary row-btn-sm"
            >
              <FileText size={14} /> Save &amp; Generate Report
            </LoadingButton>
          )}
        </div>
      </div>
  );
}
