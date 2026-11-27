import type { ReactNode } from "react";

/** Label over value on a detail page; nothing when there is no value. */
export default function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  if (!value || value === "-") return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
