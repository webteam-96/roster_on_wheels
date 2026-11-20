import { describe, expect, it } from "vitest";
import { flattenTree, subtreeIds } from "./CommitteesWorkspace";
import type { CommitteeNode } from "@/services/api";

const n = (id: number, parentId: number | null): CommitteeNode =>
  ({ id, name: `c${id}`, parentId, memberCount: 0, documentCount: 0, messageCount: 0 });

describe("committee tree", () => {
  // 1 > 2 > 3, 4 alone, 5 points at a parent that is gone
  const nodes = [n(3, 2), n(1, null), n(4, null), n(2, 1), n(5, 99)];

  it("lists parents before children with their depth; a missing parent counts as top level", () => {
    expect(flattenTree(nodes).map((r) => [r.node.id, r.depth])).toEqual([[1, 0], [2, 1], [3, 2], [4, 0], [5, 0]]);
  });

  it("a committee cannot move under itself or anything below it", () => {
    expect([...subtreeIds(nodes, 1)].sort()).toEqual([1, 2, 3]);
    expect([...subtreeIds(nodes, 4)]).toEqual([4]);
  });
});
