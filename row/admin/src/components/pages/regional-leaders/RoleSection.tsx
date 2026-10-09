import { LeaderTable } from "./LeaderTable";
import type { SectionData } from "./data";

/**
 * One role group within a zone: quiet Fraunces header, then its ledger-list
 * rosters. No entrance data-attributes — zone switches crossfade via
 * AnimatePresence, never replay reveals.
 */
export function RoleSection({ section }: { section: SectionData }) {
  const headingId = `${section.id}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="font-display text-xl font-[560] leading-tight tracking-[-0.01em] text-navy-950 sm:text-2xl"
      >
        {section.title}
      </h2>

      <div className="mt-4 space-y-7">
        {section.subTables.map((table, i) => (
          <LeaderTable key={table.title ?? `table-${i}`} table={table} />
        ))}
      </div>
    </section>
  );
}
