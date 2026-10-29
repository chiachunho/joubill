import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  counterpartOf,
  findUnpairedChanges,
  renderComment,
} from "../page-pairs.mjs";

// exists() stands in for the working tree: it is true for every path listed here.
const tree = (...paths) => {
  const present = new Set(paths);
  return (path) => present.has(path);
};

describe("counterpartOf", () => {
  it("maps a page to the same page in the other tree, in both directions", () => {
    expect(counterpartOf("src/app/mini/groups/[id]/page.tsx")).toBe(
      "src/app/app/groups/[id]/page.tsx",
    );
    expect(counterpartOf("src/app/app/settings/page.tsx")).toBe("src/app/mini/settings/page.tsx");
  });

  it("keeps nested dynamic segments intact", () => {
    expect(counterpartOf("src/app/mini/groups/[id]/expenses/[expenseId]/edit/loading.tsx")).toBe(
      "src/app/app/groups/[id]/expenses/[expenseId]/edit/loading.tsx",
    );
  });

  it("returns null for paths outside both trees", () => {
    expect(counterpartOf("src/components/mini/StoreProvider.tsx")).toBeNull();
    expect(counterpartOf("src/app/help/page.mdx")).toBeNull();
    // A sibling directory that only shares a prefix is not part of the tree.
    expect(counterpartOf("src/app/mini-preview/page.tsx")).toBeNull();
  });
});

describe("findUnpairedChanges", () => {
  it("reports nothing when both copies changed", () => {
    const changes = [
      { status: "M", path: "src/app/mini/groups/[id]/page.tsx" },
      { status: "M", path: "src/app/app/groups/[id]/page.tsx" },
    ];
    const exists = tree(...changes.map((c) => c.path));
    expect(findUnpairedChanges(changes, exists)).toEqual([]);
  });

  it("reports an edit to one copy when the other copy is still there", () => {
    const changes = [{ status: "M", path: "src/app/mini/groups/[id]/page.tsx" }];
    const exists = tree("src/app/mini/groups/[id]/page.tsx", "src/app/app/groups/[id]/page.tsx");
    expect(findUnpairedChanges(changes, exists)).toEqual([
      {
        path: "src/app/mini/groups/[id]/page.tsx",
        counterpart: "src/app/app/groups/[id]/page.tsx",
        status: "M",
        reason: "unchanged",
      },
    ]);
  });

  it("does not report an edit to a file that has no counterpart", () => {
    // app/StoreProvider.tsx is web-only: the Mini App takes its provider from components/.
    const changes = [{ status: "M", path: "src/app/app/StoreProvider.tsx" }];
    const exists = tree("src/app/app/StoreProvider.tsx", "src/components/mini/StoreProvider.tsx");
    expect(findUnpairedChanges(changes, exists)).toEqual([]);
  });

  it("reports a new page that has no counterpart", () => {
    const changes = [{ status: "A", path: "src/app/mini/groups/[id]/stats/loading.tsx" }];
    expect(findUnpairedChanges(changes, tree())).toEqual([
      {
        path: "src/app/mini/groups/[id]/stats/loading.tsx",
        counterpart: "src/app/app/groups/[id]/stats/loading.tsx",
        status: "A",
        reason: "missing",
      },
    ]);
  });

  it("reports a deleted page whose counterpart was left in place", () => {
    const changes = [{ status: "D", path: "src/app/app/groups/[id]/stats/page.tsx" }];
    const exists = tree("src/app/mini/groups/[id]/stats/page.tsx");
    expect(findUnpairedChanges(changes, exists)).toEqual([
      {
        path: "src/app/app/groups/[id]/stats/page.tsx",
        counterpart: "src/app/mini/groups/[id]/stats/page.tsx",
        status: "D",
        reason: "unchanged",
      },
    ]);
  });

  it("reports nothing when a page is deleted from both copies", () => {
    const changes = [
      { status: "D", path: "src/app/mini/old/page.tsx" },
      { status: "D", path: "src/app/app/old/page.tsx" },
    ];
    expect(findUnpairedChanges(changes, tree())).toEqual([]);
  });

  it("ignores paths outside the page trees", () => {
    const changes = [{ status: "M", path: "src/lib/expense-view.ts" }];
    expect(findUnpairedChanges(changes, tree("src/lib/expense-view.ts"))).toEqual([]);
  });
});

describe("renderComment", () => {
  it("renders an all-clear with the marker when nothing is one-sided", () => {
    const body = renderComment([]);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("No page changed on one side only.");
  });

  it("names each one-sided page and says the check is advisory", () => {
    const body = renderComment([
      {
        path: "src/app/mini/groups/[id]/page.tsx",
        counterpart: "src/app/app/groups/[id]/page.tsx",
        status: "M",
        reason: "unchanged",
      },
    ]);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain(
      "- `src/app/mini/groups/[id]/page.tsx` changed, but its counterpart `src/app/app/groups/[id]/page.tsx` did not.",
    );
    expect(body).toContain("It does not block the pull request.");
  });
});
