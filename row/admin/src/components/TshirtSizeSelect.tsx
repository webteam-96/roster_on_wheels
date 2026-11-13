"use client";

// T-shirt size dropdown for the member add / edit forms (upstream 2026-11-06).
// Sizes come from Settings > Event Masters > T-Shirt. Optional. Never shown publicly
// (the API returns it only to the member, Admins and Super Admin).
import { useEffect, useState } from "react";
import { getEventTshirtSizes } from "@/services/api";

// Members use only XS to XXXL; events keep the full list. Same list in MemberService.
const MEMBER_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

type Size = { id: number; sizeName: string; sortOrder: number; isActive: boolean | number };

type Props = {
  value: number | null | undefined;
  currentName?: string | null; // saved size, kept visible even if switched off in the master
  onChange: (id: number | null) => void;
  className?: string;
};

export default function TshirtSizeSelect({ value, currentName, onChange, className }: Props) {
  const [sizes, setSizes] = useState<Size[]>([]);
  useEffect(() => {
    getEventTshirtSizes()
      .then((d: Size[]) => setSizes(Array.isArray(d) ? d : []))
      .catch(() => setSizes([]));
  }, []);

  const active = sizes.filter(
    (s) => (s.isActive === true || s.isActive === 1) && MEMBER_SIZES.includes(s.sizeName.trim().toUpperCase()),
  );
  const showCurrent = !!value && !active.some((s) => s.id === value);
  return (
    <select
      value={value ? String(value) : ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={className}
      aria-label="T-Shirt Size"
    >
      <option value="">Select T-Shirt Size</option>
      {showCurrent && <option value={String(value)}>{currentName || "Current size"}</option>}
      {active.map((s) => <option key={s.id} value={String(s.id)}>{s.sizeName}</option>)}
    </select>
  );
}
