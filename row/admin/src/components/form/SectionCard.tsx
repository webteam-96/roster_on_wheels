import type { ElementType, ReactNode } from "react";

type Props = {
  title: string;
  number?: number;
  icon?: ElementType;
  action?: ReactNode;
  children: ReactNode;
};

/** One section of a form: a card with a numbered heading. */
export default function SectionCard({ title, number, icon: Icon, action, children }: Props) {
  return (
    <section className="row-card row-section">
      <div className="flex items-center gap-3 border-b border-[color:var(--row-line)] px-5 py-3">
        {number !== undefined && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-azure text-xs font-semibold text-white">{number}</span>
        )}
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <h2 className="row-h2 min-w-0 flex-1">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
