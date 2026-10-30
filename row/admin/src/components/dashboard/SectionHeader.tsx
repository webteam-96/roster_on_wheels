import { type LucideIcon } from "@/components/icons";
import { PageHeader } from "@/components/row/AppKit";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Kept for existing callers; the ROW page header shows no icon. */
  icon?: LucideIcon;
}

export default function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return <PageHeader title={title} description={subtitle} />;
}
