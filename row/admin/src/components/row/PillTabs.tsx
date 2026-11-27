"use client";

import Glide from "@/components/motion/Glide";

type Props<K extends string> = {
  items: readonly { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
};

/** Pill tab strip for views switched in the page (links and Radix tabs have their own). The pill glides. */
export default function PillTabs<K extends string>({ items, active, onChange }: Props<K>) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="relative inline-flex items-center rounded-lg bg-muted p-1">
        <Glide className="rounded bg-card ring-1 ring-[color:var(--row-line)]" />
        {items.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={active === t.key}
            data-state={active === t.key ? "active" : "inactive"}
            onClick={() => onChange(t.key)}
            className="relative inline-flex h-8 items-center whitespace-nowrap rounded px-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground data-[state=active]:text-foreground"
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
