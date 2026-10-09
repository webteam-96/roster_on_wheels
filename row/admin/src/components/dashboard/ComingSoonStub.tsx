import { CalendarClock, Sparkles } from "lucide-react";
import { fmtDate } from "@/components/dashboard/formatters";

interface ComingSoonStubProps {
  moduleName: string;
  comingSoonDate?: string | null;
}

export default function ComingSoonStub({ moduleName, comingSoonDate }: ComingSoonStubProps) {
  const dateLabel = comingSoonDate ? fmtDate(comingSoonDate) : null;
  const hasDate = !!dateLabel && dateLabel !== "—";
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md w-full rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <Sparkles size={26} className="text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">{moduleName}</h2>
        <p className="text-sm font-semibold text-amber-700 mt-1 uppercase tracking-wider">
          {hasDate ? `Coming Soon — Launches on ${dateLabel}` : "Coming Soon"}
        </p>
        <p className="text-sm text-slate-600 mt-4">
          The new version is rolling out one room at a time. This room&apos;s still getting painted.
        </p>
        {hasDate && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-700">
            <CalendarClock size={14} className="text-amber-600" />
            <span>Targeted launch: <span className="font-semibold">{dateLabel}</span></span>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-6">
          You will see it appear in your sidebar automatically once it goes live.
        </p>
      </div>
    </div>
  );
}
