"use client"

import * as React from "react"

import { ChevronDown, ChevronUp, ChevronsUpDown } from "@/components/icons"
import { cn } from "@/lib/utils"

// The one list table (design.md 8.9): card, scroll, well head, rows, empty row, loading rows, optional sort.
// Pages give columns and rows; they never write <table>.

export type SortDir = "asc" | "desc"
export type SortValue = string | number | Date | null | undefined

export type DataColumn<T> = {
  key: string
  header: React.ReactNode
  cell: (row: T, index: number) => React.ReactNode
  /** Makes the column sortable. */
  sortValue?: (row: T) => SortValue
  align?: "left" | "right" | "center"
  className?: string
}

/** Sorted copy; empty values go last in both directions. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const norm = (v: SortValue) => (v instanceof Date ? v.getTime() : v)
  // NaN (a bad number or an invalid date) counts as empty, or the comparator would return NaN.
  const empty = (v: SortValue) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))
  const sign = dir === "asc" ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, v: norm(value(row)) }))
    .sort((a, b) => {
      const ae = empty(a.v)
      const be = empty(b.v)
      if (ae || be) return ae && be ? a.i - b.i : ae ? 1 : -1
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: "base" })
      return c === 0 ? a.i - b.i : c * sign
    })
    .map((x) => x.row)
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" }

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  loadingRows = 5,
  empty = "Nothing to show yet.",
  onRowClick,
  rowClassName,
  initialSort,
  card = true,
  className,
}: {
  columns: DataColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T, index: number) => React.Key
  /** Read by screen readers; say what the table lists. */
  caption: string
  loading?: boolean
  loadingRows?: number
  empty?: React.ReactNode
  onRowClick?: (row: T) => void
  /** Extra classes for one row (a state tint). */
  rowClassName?: (row: T) => string | undefined
  initialSort?: { key: string; dir: SortDir }
  /** false when the table already sits inside a Card or Panel (never a card in a card). */
  card?: boolean
  className?: string
}) {
  const [sort, setSort] = React.useState(initialSort)
  const sortCol = sort && columns.find((c) => c.key === sort.key && c.sortValue)
  const shown = React.useMemo(
    () => (sortCol && sort ? sortRows(rows, sortCol.sortValue!, sort.dir) : rows),
    [rows, sortCol, sort]
  )

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))

  return (
    <div className={cn(card && "row-card", "row-table-wrap", className)}>
      <table className="row-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key
              const Icon = active ? (sort!.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(alignClass[c.align ?? "left"], c.className)}
                >
                  {c.sortValue ? (
                    <button type="button" className="row-th-sort" onClick={() => toggle(c.key)}>
                      {c.header}
                      <Icon size={12} aria-hidden />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody aria-busy={loading || undefined}>
          {loading ? (
            Array.from({ length: loadingRows }, (_, i) => (
              <tr key={i}>
                <td colSpan={columns.length}>
                  <div className="h-5 row-skeleton rounded" />
                </td>
              </tr>
            ))
          ) : shown.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="row-table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            shown.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn(alignClass[c.align ?? "left"], c.className)}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Dense grid for goal and report matrices: small cells, sticky first column and head. */
export function MatrixTable({
  caption,
  corner,
  columns,
  rows,
  className,
}: {
  caption: string
  corner?: React.ReactNode
  columns: { key: string; header: React.ReactNode; className?: string }[]
  rows: { key: React.Key; label: React.ReactNode; cells: React.ReactNode[]; className?: string }[]
  className?: string
}) {
  return (
    <div className={cn("row-table-wrap", className)}>
      <table className="row-matrix">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{corner}</th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.className}>
              <th scope="row">{r.label}</th>
              {r.cells.map((cell, i) => (
                <td key={columns[i]?.key ?? i} className={columns[i]?.className}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
