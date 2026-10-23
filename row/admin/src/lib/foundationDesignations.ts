// Rotary Foundation designations (build spec 3.12). Levels and labels match api/Controllers/FoundationDesignationsController.cs.
import type { DesignationType } from "@/services/api";

export interface DesignationOption {
  value: string;
  type: DesignationType;
  level: number | null;
  label: string;
}

export function designationLabel(type: DesignationType, level: number | null): string {
  if (type === "PHF") return level ? `Paul Harris Fellow +${level}` : "Paul Harris Fellow";
  if (type === "MAJOR_DONOR") return `Major Donor Level ${level}`;
  return "Bequest Society";
}

const option = (type: DesignationType, level: number | null): DesignationOption => ({
  value: `${type}:${level ?? ""}`,
  type,
  level,
  label: designationLabel(type, level),
});

/** Every designation an admin can record: Paul Harris Fellow and +1 to +8, Major Donor levels 1 to 4, Bequest Society. */
export const DESIGNATION_OPTIONS: DesignationOption[] = [
  ...Array.from({ length: 9 }, (_, i) => option("PHF", i)),
  ...Array.from({ length: 4 }, (_, i) => option("MAJOR_DONOR", i + 1)),
  option("BEQUEST_SOCIETY", null),
];
