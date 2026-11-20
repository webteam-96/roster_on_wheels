// A club tag as a small label in its colour (member flexibility).
import type { ClubTag } from "@/services/api";

export default function TagChip({ tag }: { tag: Pick<ClubTag, "name" | "color"> }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[12px] leading-none text-slate-700"
      style={{ borderColor: tag.color }}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tag.color }} />
      {tag.name}
    </span>
  );
}
