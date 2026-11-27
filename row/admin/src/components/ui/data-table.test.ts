import { describe, expect, it } from "vitest"

import { sortRows } from "./data-table"

const rows = [
  { n: "b", v: 10 },
  { n: "a", v: null },
  { n: "c", v: 2 },
  { n: "d", v: 2 },
  { n: "e", v: undefined },
]

describe("sortRows", () => {
  it("sorts numbers both ways, ties keep order, empty values last", () => {
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.n)).toEqual(["c", "d", "b", "a", "e"])
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.n)).toEqual(["b", "c", "d", "a", "e"])
  })

  it("sorts text by natural order, ignoring case", () => {
    const t = [{ s: "Club 10" }, { s: "club 2" }, { s: "" }, { s: "Club 1" }]
    expect(sortRows(t, (r) => r.s, "asc").map((r) => r.s)).toEqual(["Club 1", "club 2", "Club 10", ""])
  })

  it("puts NaN and invalid dates with the empty values", () => {
    const n = [{ v: NaN }, { v: 3 }, { v: 1 }]
    expect(sortRows(n, (r) => r.v, "asc").map((r) => r.v)).toEqual([1, 3, NaN])
    const d = [{ d: new Date("nope") }, { d: new Date("2026-01-01") }]
    expect(sortRows(d, (r) => r.d, "desc")[0]).toBe(d[1])
  })

  it("sorts dates and does not change the input", () => {
    const d = [{ d: new Date("2026-02-01") }, { d: new Date("2025-12-01") }]
    expect(sortRows(d, (r) => r.d, "asc")[0]).toBe(d[1])
    expect(d[0].d.getUTCMonth()).toBe(1)
  })
})
