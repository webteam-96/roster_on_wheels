import { Construction } from "@/components/icons";

interface PhasePlaceholderProps {
  pageName: string;
  phaseLabel?: string;
}

export default function PhasePlaceholder({ pageName, phaseLabel = "Phase B" }: PhasePlaceholderProps) {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Construction size={26} className="text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">{pageName}</h2>
        <p className="text-sm text-slate-500 mt-2">Coming up in {phaseLabel}.</p>
        <p className="text-xs text-slate-400 mt-4">
          The tab is wired and the route is live: content will land in the next pass.
        </p>
      </div>
    </div>
  );
}
