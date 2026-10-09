import { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

type KpiColor = "blue" | "gold" | "green" | "purple" | "red" | "teal";

const COLORS: Record<KpiColor, { bg: string; text: string; ring: string }> = {
  blue:   { bg: "bg-blue-50",    text: "text-blue-700",   ring: "ring-blue-100" },
  gold:   { bg: "bg-amber-50",   text: "text-amber-700",  ring: "ring-amber-100" },
  green:  { bg: "bg-emerald-50", text: "text-emerald-700",ring: "ring-emerald-100" },
  purple: { bg: "bg-purple-50",  text: "text-purple-700", ring: "ring-purple-100" },
  red:    { bg: "bg-red-50",     text: "text-red-700",    ring: "ring-red-100" },
  teal:   { bg: "bg-teal-50",    text: "text-teal-700",   ring: "ring-teal-100" },
};

interface KpiCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon: LucideIcon;
  color?: KpiColor;
}

export default function KpiCard({ title, value, subtitle, icon: Icon, color = "blue" }: KpiCardProps) {
  const c = COLORS[color];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.bg} ${c.text} ring-1 ${c.ring}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">{title}</p>
        <p className="text-xl font-bold text-slate-800 tabular-nums leading-tight mt-0.5 truncate">{value}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
    </div>
  );
}
