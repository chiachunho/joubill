import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  via: null,
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

describe("GroupActivityPage: the source filter", () => {
  function renderFeed() {
    const params = Object.assign(Promise.resolve({ id: "7" }), {
      status: "fulfilled" as const,
      value: { id: "7" },
    });
    const request = fakeRequest({
      "/api/groups/7/activity": { entries: [ENTRY], nextCursor: null },
      "/api/groups/7/activity?source=mcp": {
        entries: [{ ...ENTRY, id: 2, via: "Claude" }],
        nextCursor: null,
      },
      "/api/groups/7/activity?source=manual": { entries: [], nextCursor: null },
      "/api/groups/7/avatars": { groupPhoto: null, userPhotos: {} },
      "/api/me/groups": { userId: 1, groups: [] },
    });
    render(
      <StoreWrapper request={request}>
        <GroupActivityPage params={params} platform={platform()} />
      </StoreWrapper>,
    );
    return request;
  }

  it("asks the server for the chosen source, and says so when nothing matches", async () => {
    const request = renderFeed();
    await screen.findByText(/晚餐/);

    fireEvent.click(screen.getByRole("radio", { name: "透過應用程式" }));
    expect(await screen.findByText(/透過 Claude/)).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/api/groups/7/activity?source=mcp", expect.anything());

    fireEvent.click(screen.getByRole("radio", { name: "手動記錄" }));
    expect(await screen.findByText("沒有符合的動態")).toBeInTheDocument();
  });

  it("has no filter on a single record's history", async () => {
    search.value = "record=7";
    const params = Object.assign(Promise.resolve({ id: "7" }), {
      status: "fulfilled" as const,
      value: { id: "7" },
    });
    render(
      <StoreWrapper
        request={fakeRequest({
          "/api/groups/7/activity?record=7": { entries: [ENTRY], nextCursor: null },
          "/api/groups/7/avatars": { groupPhoto: null, userPhotos: {} },
          "/api/me/groups": { userId: 1, groups: [] },
        })}
      >
        <GroupActivityPage params={params} platform={platform()} />
      </StoreWrapper>,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "變更紀錄" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
