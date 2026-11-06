import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupActivityPage } from "@/components/pages/GroupActivityPage";
import type { Platform } from "@/components/pages/platform";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

const { search } = vi.hoisted(() => ({ search: { value: "" } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

afterEach(() => {
  cleanup();
  search.value = "";
});

const ENTRY = {
  id: 1,
  action: "created",
  at: "2026-10-28T04:00:00Z",
  actor: { userId: 1, displayName: null, firstName: "小明", lastName: null, username: null },
  recordId: 7,
  recordType: "expense",
  recordLabel: "晚餐",
};

function platform(): Platform {
  return {
    basePath: "/app",
    useBack: () => {},
    // The real one is a link with this href; that is all this test reads.
    BackLink: ({ href }: { href: string }) => <a href={href}>返回</a>,
  } as unknown as Platform;
}

async function backHref(query: string) {
  search.value = query;
  const params = Object.assign(Promise.resolve({ id: "7" }), {
    status: "fulfilled" as const,
    value: { id: "7" },
  });
  const request = fakeRequest({
    "/api/groups/7/activity?record=7": { entries: [ENTRY], nextCursor: null },
    "/api/groups/7/avatars": { groupPhoto: null, userPhotos: {} },
    "/api/me/groups": { userId: 1, groups: [] },
  });
  render(
    <StoreWrapper request={request}>
      <GroupActivityPage params={params} platform={platform()} />
    </StoreWrapper>,
  );
  return (await screen.findByRole("link", { name: "返回" })).getAttribute("href");
}

describe("GroupActivityPage: a record's 返回", () => {
  it("goes back to the page it was opened from", async () => {
    const from = "/app/groups/7/expenses/7/edit";

    expect(await backHref(`record=7&from=${encodeURIComponent(from)}`)).toBe(from);
  });

  it("falls back to the group home when there is no from", async () => {
    expect(await backHref("record=7")).toBe("/app/groups/7");
  });

  it("ignores a from outside this group", async () => {
    expect(await backHref(`record=7&from=${encodeURIComponent("https://evil.test/")}`)).toBe(
      "/app/groups/7",
    );
  });
});
