import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import CountUp from "@/components/motion/CountUp";

// ROW "Fellowship" application parts (row/website/design.md section 8). Presentation only: every text comes in
// through props, no data fetching here.

export type Tone = "sky" | "lilac" | "cream2" | "coral" | "azure";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Where the back button goes: a link, or a handler. Pages opened from the menu have none. */
  back?: string | (() => void);
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
};

/** The only page header (design.md 8.3): back and title on the left, actions on the right. One per page. */
export function PageHeader({ title, description, back, backLabel = "Back", actions, className = "" }: PageHeaderProps) {
  return (
    <header className={`row-page-header ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {typeof back === "string" && (
          <Link href={back} className="row-btn row-btn-secondary row-btn-icon" aria-label={backLabel}><ArrowLeft /></Link>
        )}
        {typeof back === "function" && (
          <button type="button" onClick={back} className="row-btn row-btn-secondary row-btn-icon" aria-label={backLabel}><ArrowLeft /></button>
        )}
        <div className="min-w-0">
          <h1 className="row-h1">{title}</h1>
          {description && <div className="row-page-description">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type PanelProps = {
  title: string;
  subtitle?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, subtitle, headerRight, footer, children, className = "" }: PanelProps) {
  return (
    <section className={`row-card row-rise flex flex-col ${className}`}>
      <div className="row-card-head">
        <div className="min-w-0">
          <h2 className="row-h2">{title}</h2>
          {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      <div className="flex-1 px-5 pb-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--row-line)] px-5 py-3 text-[13px]">
          {footer}
        </div>
      )}
    </section>
  );
}

type KpiTileProps = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Kept for existing callers: tiles no longer take a colour each (design.md 8.3). */
  tone?: Tone;
};

export function KpiTile({ label, value, note }: KpiTileProps) {
  return (
    <div className="row-card row-rise flex flex-col p-5">
      <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-azure">
        {typeof value === "string" || typeof value === "number" ? <CountUp value={String(value)} /> : value}
      </p>
      {note && <p className="mt-auto pt-2 text-[13px] text-muted-foreground">{note}</p>}
    </div>
  );
}

type MetricBarProps = {
  label: string;
  value: ReactNode;
  percent: number;
  color: string;
};

export function MetricBar({ label, value, percent, color }: MetricBarProps) {
  const width = `${Math.max(0, Math.min(100, percent))}%`;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="row-grow h-full rounded-full" style={{ width, background: color }} />
      </div>
    </div>
  );
}

// Table styles shared by every ROW list (design.md 8.3 ListPage): well header, 48px rows, hairline dividers.
export const rowTable = {
  wrap: "overflow-x-auto",
  table: "min-w-full text-[14px]",
  head: "",
  th: "px-4 py-2.5 text-left",
  body: "divide-y divide-[color:var(--row-line)]",
  tr: "h-12 hover:bg-muted/70",
  td: "px-4 py-2 text-foreground",
  tdMuted: "px-4 py-2 text-muted-foreground",
};

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  icon: ReactNode;
};

export function SearchField({ value, onChange, placeholder, label, icon }: SearchFieldProps) {
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{label}</span>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="row-field w-full pl-10"
      />
    </label>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-[15px] text-red-800">
      <p>{message}</p>
      {onRetry && retryLabel && (
        <button type="button" onClick={onRetry} className="row-btn row-btn-secondary">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

// Skeleton in the shape of a page with tiles and a table (design.md 8.3: every async area gets one).
export function ListPageSkeleton({ tiles = 4, rows = 6 }: { tiles?: number; rows?: number }) {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-56 row-skeleton rounded" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="h-[116px] row-skeleton rounded-xl" />
        ))}
      </div>
      <div className="row-card row-rise p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="mb-3 h-9 row-skeleton rounded-md last:mb-0" />
        ))}
      </div>
    </div>
  );
}

// Skeleton rows for a list or panel that is loading (design.md 8.3: skeleton, never a lone spinner).
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 row-skeleton rounded-md" />
      ))}
    </div>
  );
}
