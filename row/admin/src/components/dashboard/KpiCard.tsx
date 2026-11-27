import { ReactNode } from "react";
import { type LucideIcon } from "@/components/icons";
import { KpiTile } from "@/components/row/AppKit";

type KpiColor = "blue" | "gold" | "green" | "purple" | "red" | "teal";

interface KpiCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  /** Kept for existing callers; ROW KPI tiles show no icon. */
  icon?: LucideIcon;
  /** Kept for existing callers; tiles no longer take a colour each (design.md 8.3). */
  color?: KpiColor;
}

export default function KpiCard({ title, value, subtitle }: KpiCardProps) {
  return <KpiTile label={title} value={value} note={subtitle} />;
}
