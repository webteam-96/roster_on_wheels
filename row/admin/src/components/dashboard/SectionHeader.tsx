import { type LucideIcon } from "@/components/icons";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
}

export default function SectionHeader({ title, subtitle, icon: Icon }: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-azure/10 text-azure">
          <Icon size={18} />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-slate-800 leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
