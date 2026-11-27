import type { ElementType } from "react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  checked: boolean;
  onChange: () => void;
  icon?: ElementType;
  name?: string;
  value?: string;
  disabled?: boolean;
};

/** One choice of a short radio group, as a bordered button. */
export default function RadioPill({ label, checked, onChange, icon: Icon, name, value, disabled }: Props) {
  return (
    <label
      className={cn(
        "row-btn row-btn-secondary focus-within:outline focus-within:outline-2 focus-within:outline-azure",
        checked && "border-azure bg-blue-100 text-azure",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="sr-only" />
      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", checked ? "border-azure" : "border-slate-300")}>
        {checked && <span className="h-2 w-2 rounded-full bg-azure" />}
      </span>
      {Icon && <Icon />}
      {label}
    </label>
  );
}
