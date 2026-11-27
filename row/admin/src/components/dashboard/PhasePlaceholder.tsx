import { PageHeader } from "@/components/row/AppKit";

interface PhasePlaceholderProps {
  pageName: string;
  phaseLabel?: string;
}

export default function PhasePlaceholder({ pageName, phaseLabel = "Phase B" }: PhasePlaceholderProps) {
  return (
    <PageHeader title={pageName} description={<><p className="text-sm text-slate-500 mt-2">Coming up in {phaseLabel}.</p> <p className="text-xs text-slate-400 mt-4"> The tab is wired and the route is live: content will land in the next pass. </p></>} />
  );
}
