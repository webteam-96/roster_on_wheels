import type { ReactNode } from "react";

// ROW "Fellowship" application parts (row/website/design.md section 8). Presentation only: every text comes in
// through props, no data fetching here.

export type Tone = "sky" | "lilac" | "cream2" | "coral" | "azure";

// Fill + readable ink per tone (design.md section 1, tone system). Gold is never a fill.
const TONE: Record<Tone, string> = {
  sky: "bg-[#CFE2F6] text-[#0B3F7A]",
  lilac: "bg-[#A9C6EA] text-[#1B2C42]",
  cream2: "bg-[#EDF4FB] text-[#1B2C42]",
  coral: "bg-[#FFC65C] text-[#1B2C42]",
  azure: "bg-[#17458F] text-[#F7F9FC]",
};

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 pb-2 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-[13px] font-semibold text-[#64748B]">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1B2C42] md:text-[28px]">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-[60ch] text-[15px] text-[#64748B]">{description}</p>}
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
    <section className={`flex flex-col rounded-[20px] border border-[color:var(--row-line)] bg-[#FCFDFE] ${className}`}>
      <div className="flex items-start justify-between gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="font-display text-[18px] font-semibold leading-tight text-[#1B2C42]">{title}</h2>
          {subtitle && <p className="mt-1 text-[13px] text-[#64748B]">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      <div className="flex-1 px-6 pb-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--row-line)] px-6 py-3 text-[13px]">
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
  tone: Tone;
};

export function KpiTile({ label, value, note, tone }: KpiTileProps) {
  return (
    <div className={`rounded-[20px] px-6 py-5 ${TONE[tone]}`}>
      <p className="text-[13px] font-semibold opacity-80">{label}</p>
      <p className="mt-2 font-display text-[32px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{value}</p>
      {note && <p className="mt-2 text-[13px] opacity-80">{note}</p>}
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
        <span className="text-[#64748B]">{label}</span>
        <span className="font-semibold tabular-nums text-[#1B2C42]">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#EDF4FB]">
        <div className="h-full rounded-full" style={{ width, background: color }} />
      </div>
    </div>
  );
}

// Table styles shared by every ROW list (design.md 8.3 ListPage): cream-2 header, 52px rows, hairline dividers.
export const rowTable = {
  wrap: "overflow-x-auto",
  table: "min-w-full text-[14px]",
  head: "bg-[#EDF4FB] text-[13px] text-[#64748B]",
  th: "px-6 py-3 text-left font-semibold",
  body: "divide-y divide-[color:var(--row-line)]",
  tr: "h-[52px] hover:bg-[#EDF4FB]/70",
  td: "px-6 py-2 text-[#1B2C42]",
  tdMuted: "px-6 py-2 text-[#64748B]",
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
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748B]">{icon}</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-[12px] border border-[color:var(--row-line)] bg-[#FCFDFE] pl-10 pr-3 text-[14px] text-[#1B2C42] placeholder:text-[#64748B] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
      />
    </label>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-[20px] border border-red-200 bg-red-50 px-6 py-5 text-[15px] text-red-800">
      <p>{message}</p>
      {onRetry && retryLabel && (
        <button type="button" onClick={onRetry} className="h-11 rounded-full border-2 border-red-800 px-5 font-semibold">
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
      <div className="h-8 w-56 animate-pulse rounded-full bg-[#EDF4FB]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="h-[116px] animate-pulse rounded-[20px] bg-[#EDF4FB]" />
        ))}
      </div>
      <div className="rounded-[20px] border border-[color:var(--row-line)] bg-[#FCFDFE] p-6">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="mb-3 h-9 animate-pulse rounded-[12px] bg-[#EDF4FB] last:mb-0" />
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
        <div key={i} className="h-9 animate-pulse rounded-[12px] bg-[#EDF4FB]" />
      ))}
    </div>
  );
}
