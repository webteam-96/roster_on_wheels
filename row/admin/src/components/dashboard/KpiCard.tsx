import { ReactNode } from "react";
import { type LucideIcon } from "@/components/icons";
import { KpiTile, type Tone } from "@/components/row/AppKit";

type KpiColor = "blue" | "gold" | "green" | "purple" | "red" | "teal";

// Old accent names map onto the ROW tone cycle (design.md 8.3 KpiTile; gold is never a fill).
const TONE: Record<KpiColor, Tone> = {
  blue: "sky",
  teal: "lilac",
  purple: "lilac",
  green: "cream2",
  red: "cream2",
  gold: "coral",
};

interface KpiCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  /** Kept for existing callers; ROW KPI tiles show no icon. */
  icon?: LucideIcon;
  color?: KpiColor;
}

export default function KpiCard({ title, value, subtitle, color = "blue" }: KpiCardProps) {
  return <KpiTile label={title} value={value} note={subtitle} tone={TONE[color]} />;
}
