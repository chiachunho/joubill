import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JoinPage } from "@/components/pages/JoinPage";
import { webPlatform } from "@/components/pages/platform.web";
import { CLAIM_UNAVAILABLE } from "@/lib/invite";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  mockReplace.mockClear();
  vi.unstubAllGlobals();
});

const CODE = "K7M2QX9PAB";
const PREVIEW = {
  groupId: 9,
  title: "東京旅行",
  memberCount: 3,
  alreadyMember: false,
  placeholders: [] as { id: number; name: string }[],
};

function renderJoin(routes: Parameters<typeof fakeRequest>[0], code = CODE) {
  // A thenable already marked fulfilled, so `use(params)` resolves without suspending.
  const params = Object.assign(Promise.resolve({ code }), {
    status: "fulfilled" as const,
    value: { code },
  });
  return render(
    <StoreWrapper request={fakeRequest(routes)}>
      <JoinPage params={params} platform={webPlatform} />
    </StoreWrapper>,
  );
}

describe("JoinPage", () => {
  it("previews the group, joins, and goes to it", async () => {
    renderJoin({
      [`/api/invites/${CODE}`]: PREVIEW,
      [`/api/invites/${CODE}/accept`]: { groupId: 9 },
    });

    expect(await screen.findByText("東京旅行")).toBeInTheDocument();
    expect(screen.getByText("3 位成員")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加入" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/app/groups/9"));
  });

  describe("claiming a name-only member", () => {
    const withPlaceholders = {
      ...PREVIEW,
      placeholders: [
        { id: 31, name: "小明" },
        { id: 32, name: "阿華" },
      ],
    };

    it("sends the chosen placeholder with the join", async () => {
      const accept = vi.fn(() => ({ groupId: 9 }));
      renderJoin({
        [`/api/invites/${CODE}`]: withPlaceholders,
        [`/api/invites/${CODE}/accept`]: accept,
      });

      fireEvent.click(await screen.findByRole("radio", { name: "小明" }));
      fireEvent.click(screen.getByRole("button", { name: "加入並認領「小明」" }));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/app/groups/9"));
      expect(accept).toHaveBeenCalledWith(
        expect.objectContaining({ body: JSON.stringify({ placeholderUserId: 31 }) }),
      );
    });

    it("joins without a claim when 都不是 is left selected", async () => {
      const accept = vi.fn(() => ({ groupId: 9 }));
      renderJoin({
        [`/api/invites/${CODE}`]: withPlaceholders,
        [`/api/invites/${CODE}/accept`]: accept,
      });

      expect(await screen.findByRole("radio", { name: "都不是，我是新成員" })).toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "加入" }));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/app/groups/9"));
      const init = accept.mock.calls[0] as unknown as [RequestInit | undefined];
      expect(init[0]?.body ?? null).toBeNull();
    });

    it("explains a claim that was taken meanwhile and drops the stale pick", async () => {
      // The second read is the refetch after the refusal: 小明 has been merged by someone else.
      const preview = vi
        .fn()
        .mockReturnValueOnce(withPlaceholders)
        .mockReturnValue({ ...withPlaceholders, placeholders: [{ id: 32, name: "阿華" }] });
      renderJoin({
        [`/api/invites/${CODE}`]: preview,
        [`/api/invites/${CODE}/accept`]: new Failure(404, { error: CLAIM_UNAVAILABLE }),
      });

      fireEvent.click(await screen.findByRole("radio", { name: "小明" }));
      fireEvent.click(screen.getByRole("button", { name: "加入並認領「小明」" }));

      expect(await screen.findByText(CLAIM_UNAVAILABLE)).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole("radio", { name: "小明" })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("radio", { name: "都不是，我是新成員" })).toBeChecked();
      expect(screen.getByRole("button", { name: "加入" })).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("shows no picker when nobody is waiting to be claimed", async () => {
      renderJoin({ [`/api/invites/${CODE}`]: PREVIEW });

      expect(await screen.findByRole("button", { name: "加入" })).toBeInTheDocument();
      expect(screen.queryByText("你是下面其中一位嗎？")).not.toBeInTheDocument();
    });
  });

  it("offers a link instead of a join button to someone already in the group", async () => {
    renderJoin({ [`/api/invites/${CODE}`]: { ...PREVIEW, alreadyMember: true } });

    expect(await screen.findByRole("link", { name: "前往群組" })).toHaveAttribute(
      "href",
      "/app/groups/9",
    );
    expect(screen.queryByRole("button", { name: "加入" })).not.toBeInTheDocument();
  });

  it("says the same thing for any code that can't be used", async () => {
    renderJoin({ [`/api/invites/${CODE}`]: new Failure(404, { error: "邀請碼無效或已失效" }) });
    expect(await screen.findByText("邀請碼無效或已失效")).toBeInTheDocument();
    cleanup();

    // A malformed code never reaches the server and reads exactly the same.
    renderJoin({}, "nope");
    expect(await screen.findByText("邀請碼無效或已失效")).toBeInTheDocument();
  });

  it("offers a retry, not an invalid-code verdict, when the server fails", async () => {
    renderJoin({ [`/api/invites/${CODE}`]: new Failure(500) });

    expect(await screen.findByRole("button", { name: "重試" })).toBeInTheDocument();
    expect(screen.queryByText("邀請碼無效或已失效")).not.toBeInTheDocument();
  });

  it("treats a malformed link parameter as an invalid code instead of crashing", async () => {
    renderJoin({}, "%zz");
    expect(await screen.findByText("邀請碼無效或已失效")).toBeInTheDocument();
  });

  it("sends a signed-out viewer to login, carrying the join link", async () => {
    const location = { href: `/join/${CODE}`, pathname: `/join/${CODE}`, search: "" };
    vi.stubGlobal("location", location);
    renderJoin({ [`/api/invites/${CODE}`]: new Failure(401) });

    await waitFor(() => expect(location.href).toBe(`/login?next=%2Fjoin%2F${CODE}`));
  });
});
