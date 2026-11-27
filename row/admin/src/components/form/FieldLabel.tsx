import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type Props = {
  children: ReactNode;
  hint?: ReactNode;
  /** Shows the red star. */
  required?: boolean;
  /** Shows "(optional)". */
  optional?: boolean;
  htmlFor?: string;
};

/** The label above a form field. */
export default function FieldLabel({ children, hint, required, optional, htmlFor }: Props) {
  return (
    <Label htmlFor={htmlFor} className="row-label">
      {children}
      {required && !optional && <span className="ml-0.5 text-red-700">*</span>}
      {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      {hint && <span className="ml-1 font-normal text-muted-foreground">{hint}</span>}
    </Label>
  );
}
