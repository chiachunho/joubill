import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteActions } from "@/components/mini/InviteActions";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

const MINI = "https://t.me/bot/app?startapp=join_K7M2QX9PAB";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // `navigator.share` is stubbed per test; jsdom has none of its own.
  delete (navigator as { share?: unknown }).share;
});

function renderActions(request: ReturnType<typeof fakeRequest>) {
  return render(
    <StoreWrapper request={request}>
      <InviteActions
        groupId="9"
        hint={({ telegramLink }) => (telegramLink ? "hint with telegram" : "the hint")}
      />
    </StoreWrapper>,
  );
}

const COPY_OR_SHARE = /^(複製|分享)/;

describe("InviteActions", () => {
  it("shows the code grouped 5-5, the web link row and 重設邀請碼", async () => {
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } }));

    expect(await screen.findByText("K7M2Q-X9PAB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "複製邀請碼" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "複製網頁連結" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重設邀請碼" })).toBeInTheDocument();
    expect(screen.getByText("the hint")).toBeInTheDocument();
  });

  it("offers the Telegram link only when the server could build one", async () => {
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: MINI } }));
    expect(await screen.findByRole("button", { name: "複製 Telegram 連結" })).toBeInTheDocument();
  });

  it("hides the Telegram link when there is none", async () => {
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } }));
    await screen.findByText("K7M2Q-X9PAB");
    expect(screen.queryByRole("group", { name: "Telegram 連結" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "複製 Telegram 連結" })).not.toBeInTheDocument();
  });

  it("puts a share button beside each copy only where the browser can share", async () => {
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: MINI } }));
    await screen.findByText("K7M2Q-X9PAB");
    expect(screen.queryByRole("button", { name: /^分享/ })).not.toBeInTheDocument();
    cleanup();

    Object.assign(navigator, { share: vi.fn().mockResolvedValue(undefined) });
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: MINI } }));
    expect(await screen.findByRole("button", { name: "分享網頁連結" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分享 Telegram 連結" })).toBeInTheDocument();
  });

  it("copies the formatted code and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } }));

    fireEvent.click(await screen.findByRole("button", { name: "複製邀請碼" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("K7M2Q-X9PAB"));
    expect(await screen.findByText("已複製")).toBeInTheDocument();
  });

  it("tells the hint whether a Telegram link is on offer", async () => {
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: MINI } }));
    expect(await screen.findByText("hint with telegram")).toBeInTheDocument();
    cleanup();
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } }));
    expect(await screen.findByText("the hint")).toBeInTheDocument();
  });

  it("shows the link as selectable text when the clipboard refuses", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: MINI } }));

    expect(screen.queryByLabelText("要複製的內容")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "複製 Telegram 連結" }));

    expect(await screen.findByLabelText("要複製的內容")).toHaveValue(MINI);
    expect(screen.getByText(/無法自動複製/)).toBeInTheDocument();
  });

  it("asks before replacing a live code", async () => {
    const request = fakeRequest({
      "/api/groups/9/invite": (init) =>
        init?.method === "POST"
          ? { code: "CCCCCDDDDD", miniLink: null }
          : { code: "K7M2QX9PAB", miniLink: null },
    });
    renderActions(request);

    fireEvent.click(await screen.findByRole("button", { name: "重設邀請碼" }));
    expect(await screen.findByText("重設邀請碼？")).toBeInTheDocument();
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "重設" }));
    await waitFor(() =>
      expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
  });

  it("with no code yet shows only 產生邀請碼, and the buttons appear once one is issued", async () => {
    let code: string | null = null;
    const request = fakeRequest({
      "/api/groups/9/invite": (init) => {
        if (init?.method === "POST") code = "CCCCCDDDDD";
        return { code, miniLink: null };
      },
    });
    renderActions(request);

    expect(await screen.findByText("這個群組還沒有邀請碼")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY_OR_SHARE })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重設邀請碼" })).not.toBeInTheDocument();
    // Reading never issues one: whoever taps 產生邀請碼 is the inviter on record.
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "產生邀請碼" }));
    expect(await screen.findByText("CCCCC-DDDDD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "複製邀請碼" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "複製網頁連結" })).toBeInTheDocument();
  });

  it("shows no copy or share button while loading", () => {
    renderActions(fakeRequest({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } }));
    expect(screen.getByLabelText("載入中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY_OR_SHARE })).not.toBeInTheDocument();
  });

  it("shows the failure with a retry, and no copy or share button", async () => {
    let fail = true;
    renderActions(
      fakeRequest({
        "/api/groups/9/invite": () =>
          fail ? new Failure(500, { error: "boom" }) : { code: "K7M2QX9PAB", miniLink: null },
      }),
    );

    expect(await screen.findByText("無法載入邀請碼")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY_OR_SHARE })).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(await screen.findByText("K7M2Q-X9PAB")).toBeInTheDocument();
  });
});
