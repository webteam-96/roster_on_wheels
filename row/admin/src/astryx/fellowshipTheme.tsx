"use client";

// ROW "Fellowship" theme for Astryx components (row/website/design.md): azure primary, marigold accent,
// cream page, ink text, Figtree body + Bricolage Grotesque display, Phosphor icons (FRONTEND-RULES #12: no Lucide).
// Built on Astryx's neutral theme so every token we don't set keeps a sane value.
import { defineTheme } from "@astryxdesign/core/theme";
import type { IconRegistry } from "@astryxdesign/core/Icon";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import {
  ArrowDownIcon, ArrowSquareOutIcon, ArrowUpIcon, ArrowsDownUpIcon, CalendarBlankIcon, CaretDoubleLeftIcon,
  CaretDoubleRightIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, CheckCircleIcon, CheckIcon, ChecksIcon,
  ClockIcon, ColumnsIcon, CopyIcon, DotsThreeIcon, EyeSlashIcon, FunnelIcon, InfoIcon, ListIcon,
  MagnifyingGlassIcon, MicrophoneIcon, StopIcon, UploadSimpleIcon, WarningIcon, WrenchIcon, XCircleIcon, XIcon,
} from "@phosphor-icons/react";

const p = { size: "1em", "aria-hidden": true as const };

const icons: IconRegistry = {
  close: <XIcon {...p} />,
  chevronDown: <CaretDownIcon {...p} />,
  chevronLeft: <CaretLeftIcon {...p} />,
  chevronRight: <CaretRightIcon {...p} />,
  chevronsLeft: <CaretDoubleLeftIcon {...p} />,
  chevronsRight: <CaretDoubleRightIcon {...p} />,
  check: <CheckIcon {...p} />,
  success: <CheckCircleIcon {...p} />,
  error: <XCircleIcon {...p} />,
  warning: <WarningIcon {...p} />,
  info: <InfoIcon {...p} />,
  calendar: <CalendarBlankIcon {...p} />,
  clock: <ClockIcon {...p} />,
  externalLink: <ArrowSquareOutIcon {...p} />,
  menu: <ListIcon {...p} />,
  moreHorizontal: <DotsThreeIcon {...p} />,
  search: <MagnifyingGlassIcon {...p} />,
  upload: <UploadSimpleIcon {...p} />,
  arrowUp: <ArrowUpIcon {...p} />,
  arrowDown: <ArrowDownIcon {...p} />,
  arrowsUpDown: <ArrowsDownUpIcon {...p} />,
  funnel: <FunnelIcon {...p} />,
  eyeSlash: <EyeSlashIcon {...p} />,
  viewColumns: <ColumnsIcon {...p} />,
  copy: <CopyIcon {...p} />,
  checkDouble: <ChecksIcon {...p} />,
  wrench: <WrenchIcon {...p} />,
  stop: <StopIcon {...p} />,
  microphone: <MicrophoneIcon {...p} />,
};

const sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Light only: the admin has no dark mode, so each tuple repeats the light value.
const t = (v: string): [string, string] => [v, v];

export const fellowshipTheme = defineTheme({
  name: "row-fellowship",
  extends: neutralTheme,
  icons,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    // next/font sets these variables in app/layout.tsx.
    body: { family: "var(--font-body)", fallbacks: sans },
    heading: { family: "var(--font-display)", fallbacks: sans, weights: { 3: "bold", 4: "bold" } },
    code: { family: "ui-monospace", fallbacks: 'Consolas, "Courier New", monospace' },
  },
  tokens: {
    "--color-accent": t("#17458F"), // azure
    "--color-accent-muted": t("#DCE5EF"), // well
    "--color-text-accent": t("#17458F"),
    "--color-icon-accent": t("#17458F"),
    "--color-on-accent": t("#FCFDFE"),
    "--color-background-body": t("#E6ECF3"), // ground, no pure white (rule 3)
    "--color-background-surface": t("#F7F9FC"),
    "--color-background-card": t("#F4F7FA"),
    "--color-background-popover": t("#F4F7FA"),
    "--color-background-muted": t("#DCE5EF"),
    "--color-text-primary": t("#1B2C42"), // ink
    "--color-text-secondary": t("#526177"), // ink-soft
    "--color-icon-primary": t("#1B2C42"),
    "--color-icon-secondary": t("#526177"),
    "--color-border": t("#C9D5E2"),
    "--color-border-emphasized": t("#A9C6EA"),
    "--color-warning": t("#F7A81B"), // marigold
    "--color-on-warning": t("#1B2C42"),
    // One deliberate radius family, tighter than the stock theme (rule 23).
    "--radius-inner": "0.25rem",
    "--radius-element": "0.375rem",
    "--radius-container": "0.625rem",
  },
});
