"use client";

import { MenuItemButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Filter, MoreHorizontal, Pencil, Trash2, Eye, Loader2 } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { getPhotoUrl } from "@/services/api";
import { appLocale } from "@/lib/appFormat";

// Back to the same tab and Rotary year after add / edit / view all (ROW-69: GML returned to Upcoming Events).
export const returnQs = (tab: string, yearId?: string | null) =>
  `?returnTo=${encodeURIComponent(`/district-admin-dashboard/communication?${yearId ? `yearId=${yearId}&` : ""}tab=${tab}`)}`;

export const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Published", label: "Published" },
  { value: "Unpublished", label: "Unpublished" },
  { value: "Expired", label: "Expired" },
];

export const PAGE_SIZE_PREVIEW = 8;
export const PAGE_SIZE_FETCH = 15;

// ── helpers ──────────────────────────────────────────────────────────────

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

export function statusChipStyle(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "published":   return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "unpublished": return "bg-amber-50 text-amber-700 border-amber-200";
    case "expired":     return "bg-rose-50 text-rose-700 border-rose-200";
    default:            return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusChipStyle(status)}`}>
      {status || "–"}
    </span>
  );
}

// ── Shared section shell ─────────────────────────────────────────────────

export interface SectionShellProps {
  icon: React.ElementType;
  iconClass: string;
  title: string;
  count: number;
  status: string;
  onStatusChange: (s: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  addHref: string;
  /** False hides Add and shows why. */
  canAdd?: boolean;
  editableYears?: string[];
  /**
   * Set on sections whose data is NOT filed by Rotary year (upcoming events,
   * announcements, documents). Only a CURRENT-year admin can ever change those,
   * so naming the member's own years would be untrue — pass the current year's
   * label instead and the badge says so.
   */
  currentYearOnly?: string;
  loading: boolean;
  children: React.ReactNode;
}

export function SectionShell({
  icon: Icon, iconClass, title, count,
  status, onStatusChange, search, onSearchChange,
  addHref, canAdd = true, editableYears = [], currentYearOnly, loading, children,
}: SectionShellProps) {
  const activeStatusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "All";
  const [filterOpen, setFilterOpen] = useState(false);
  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <Icon size={16} className={iconClass} />
        <h3 className="row-h3 truncate">{title}</h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 tabular-nums">
          {count}
        </span>
        {loading && <Loader2 size={12} className="text-slate-400 animate-spin" />}

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline" size="sm"
                title="Filter by status"
              >
                <Filter size={11} />
                <span className="whitespace-nowrap">{activeStatusLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              {STATUS_OPTIONS.map((o) => (
                <MenuItemButton
                  key={o.value}
                  selected={status === o.value}
                  onClick={() => {
                    onStatusChange(o.value);
                    setFilterOpen(false);
                  }}
                >
                  {o.label}
                </MenuItemButton>
              ))}
            </PopoverContent>
          </Popover>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="row-field-sm pl-6 pr-2 w-28"
            />
          </div>

          {canAdd && (
            <Link
              href={addHref}
              className="row-btn row-btn-primary row-btn-sm"
            >
              <Plus size={12} /> Add
            </Link>
          )}
        </div>
      </div>
      {!canAdd && (currentYearOnly !== undefined
        ? <ViewOnlyBadge currentYearOnly={currentYearOnly} className="mb-3" />
        : <ViewOnlyBadge editableYears={editableYears} className="mb-3" />)}
      {children}
    </Card>
  );
}

// ── Row actions (View / Edit / Delete) ───────────────────────────────────

export interface RowActionsProps {
  onView: () => void;
  editHref: string;
  onDelete: () => void;
  /** Editing follows the year rule; View never does. */
  canEdit: boolean;
  canDelete: boolean;
}

export function RowActions({ onView, editHref, onDelete, canEdit, canDelete }: RowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          type="button"
          onClick={(e) => e.stopPropagation()}
          
          aria-label="Row actions"
        >
          <MoreHorizontal size={14} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem onClick={onView} className="text-xs cursor-pointer">
          <Eye size={12} className="mr-1.5" /> View
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem asChild className="text-xs cursor-pointer">
            <Link href={editHref}>
              <Pencil size={12} className="mr-1.5" /> Edit
            </Link>
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            onClick={onDelete}
            className="text-xs text-rose-600 focus:text-rose-700 focus:bg-rose-50 cursor-pointer"
          >
            <Trash2 size={12} className="mr-1.5" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────

export interface DetailField {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}

export function DetailModal({
  open, onClose, title, imagePath, status, fields,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  imagePath?: string | null;
  status?: string;
  fields: DetailField[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-3 flex-wrap pr-8">
            <span className="min-w-0 flex-1 break-words">{title || "–"}</span>
            {status && (
              <span className="flex-shrink-0">
                <StatusChip status={status} />
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {imagePath && (
            <div className="w-full aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getPhotoUrl(imagePath) || ""}
                alt={title}
                className="h-full w-full object-contain"
              />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {fields.map((f, i) => (
              <div
                key={i}
                className={`min-w-0 ${f.full ? "sm:col-span-2" : ""}`}
              >
                <p className="text-[10px] uppercase text-slate-400 font-semibold tracking-wide">{f.label}</p>
                <div className="text-sm text-slate-800 mt-0.5 break-words">{f.value ?? "–"}</div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Debounce hook ────────────────────────────────────────────────────────

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
