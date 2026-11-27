"use client";

import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

export const CITATION_DESC_MAX_CHARS = 1000;
export const citationQuillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", "clean"],
  ],
};

export function citationPlainTextLength(html: string): number {
  if (typeof window === "undefined" || !html) return 0;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").length;
}


// Integer-only onChange guard for number inputs.
export const intOnly = (v: string) => v.replace(/[.,]/g, "").replace(/[^\d-]/g, "");

export function BonusFieldsInner({ form, setField }: { form: any; setField: (f: string, v: any) => void }) {
  return (
    <div className="space-y-2 pl-4 border-l-2 border-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <Switch checked={form.isBonus} onCheckedChange={v => setField("isBonus", v)} /><Label className="text-sm">Bonus</Label>
      </div>
      {form.isBonus && (
        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">Bonus Points</Label><Input type="number" step="1" value={form.bonusPoints} onChange={e => setField("bonusPoints", intOnly(e.target.value))} /></div>
          <div><Label className="text-xs">Min for Bonus</Label><Input type="number" step="1" value={form.minBonus} onChange={e => setField("minBonus", intOnly(e.target.value))} /></div>
          <div><Label className="text-xs">Max for Bonus</Label><Input type="number" step="1" value={form.maxBonus} onChange={e => setField("maxBonus", intOnly(e.target.value))} /></div>
        </div>
      )}
    </div>
  );
}

// rotarySections (new "RCC & District Goals" page only, user 2026-11-16): the Category dropdown of a new
// question also lists these Rotary.org section names; picking one the district does not have yet creates
// it as a category of the year on Add. E-Governance passes nothing, so it is unchanged.
export const RCC_PREFIX = "rcc:";
