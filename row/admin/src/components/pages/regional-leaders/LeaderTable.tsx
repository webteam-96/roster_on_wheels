import type { SubTable } from "./data";

/**
 * One sub-labelled roster as a LEDGER LIST: muted role label, then full-width
 * rows on hairline rules — district .figure, Inter 600 name.
 */
export function LeaderTable({ table }: { table: SubTable }) {
  return (
    <div>
      {table.title && (
        <h3 className="microlabel-gold mb-1.5 min-w-0 leading-relaxed">{table.title}</h3>
      )}

      <ul className="border-t border-navy-950/10">
        {table.rows.map((row, i) => (
          <li key={`${row.dist}-${row.name}-${i}`} className="ledger-row">
            <div className="flex items-center gap-3.5 px-2 py-2.5 sm:gap-6 sm:px-3">
              <span className="figure w-12 shrink-0 text-[14px] text-navy-950">{row.dist}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-snug text-navy-950">
                  {row.name}
                </p>
                {(row.supporting || row.dgYear) && (
                  <p className="mt-0.5 text-[12px] leading-snug text-muted">
                    {[
                      row.supporting && `Supporting ${row.supporting}`,
                      row.dgYear && `DG ${row.dgYear}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
