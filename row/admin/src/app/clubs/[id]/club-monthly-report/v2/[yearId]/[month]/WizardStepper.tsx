import { Card } from "@/components/ui/card";
import { CheckCircle2 } from "@/components/icons";
import { STEPS } from "./monthlyReportWizardShared";
import type { MonthlyReportWizardCtx } from "./useMonthlyReportWizard";

export default function WizardStepper({ v }: { v: MonthlyReportWizardCtx }) {
  const { currentStep, setCurrentStep, loadStepData } = v;
  return (
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive    = index === currentStep;
            const isCompleted = index <  currentStep;
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => { setCurrentStep(index); loadStepData(index); }}
                  className="flex flex-col items-center flex-1 group focus:outline-none"
                >
                  <div
                    className={`
                      flex items-center justify-center w-10 h-10 rounded-full border-2 mb-2 transition-colors
                      ${isActive    ? "border-blue-600 bg-blue-600 text-white" : ""}
                      ${isCompleted ? "border-emerald-500 bg-emerald-700 text-white" : ""}
                      ${!isActive && !isCompleted ? "border-slate-300 text-slate-400 group-hover:border-slate-400" : ""}
                    `}
                  >
                    {isCompleted ? <CheckCircle2 size={18} /> : <StepIcon size={18} />}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      isActive    ? "text-blue-700"
                      : isCompleted ? "text-emerald-600"
                      : "text-slate-500"
                    }`}
                  >
                    {step.label}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 mt-[-1.5rem] ${
                      index < currentStep ? "bg-emerald-500" : "bg-slate-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>
  );
}
