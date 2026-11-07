import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupTelegramPage } from "@/components/pages/GroupTelegramPage";
import type { Platform } from "@/components/pages/platform";
import type { GroupChatResponse } from "@/lib/api-types";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

const CHAT = "/api/groups/9/chat";
const TOPIC = "/api/groups/9/chat/topic";
const INVITE = "/api/groups/9/invite";

const BOUND: GroupChatResponse = {
  linked: true,
  title: "日本行",
  isForum: false,
  noticeThread: null,
};
const UNBOUND: GroupChatResponse = {
  linked: false,
  title: null,
  isForum: null,
  noticeThread: null,
};

function fakePlatform(): Platform {
  return {
    basePath: "/app",
    rawRequest: vi.fn() as Platform["rawRequest"],
    useSelfPhoto: () => null,
    HeaderLeading: () => null,
    useBack: () => {},
    BackLink: () => null,
    HomeHeader: () => null,
    loginPath: null,
    HelpAction: () => null,
    canDownloadExport: false,
    linkIdentity: null,
    openInBrowser: null,
    inviteHint: () => "",
    DeviceSettings: () => null,
    GroupPrompt: () => null,
    GroupNotificationSetting: () => null,
    AccountSection: () => null,
  };
}

function renderPage(request: ReturnType<typeof fakeRequest>) {
  // A thenable already marked fulfilled, so `use(params)` resolves without suspending.
  const params = Object.assign(Promise.resolve({ id: "9" }), {
    status: "fulfilled" as const,
    value: { id: "9" },
  });
  return render(
    <StoreWrapper request={request}>
      <GroupTelegramPage params={params} platform={fakePlatform()} />
    </StoreWrapper>,
  );
}

async function confirmUnlink() {
  fireEvent.click(await screen.findByRole("button", { name: /解除綁定/ }));
  const confirm = await screen.findAllByRole("button", { name: "解除綁定" });
  fireEvent.click(confirm[confirm.length - 1]);
}

describe("GroupTelegramPage: binding", () => {
  it("shows the bound chat and asks before unlinking", async () => {
    renderPage(fakeRequest({ [CHAT]: BOUND }));

    expect(await screen.findByText("日本行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /解除綁定/ }));

    expect(await screen.findByText("解除與「日本行」的綁定？")).toBeInTheDocument();
    expect(screen.getByText(/bot 會離開那個 Telegram 群組/)).toBeInTheDocument();
  });

  it("does not unlink until the dialog is confirmed", async () => {
    const request = fakeRequest({ [CHAT]: BOUND });
    renderPage(request);

    fireEvent.click(await screen.findByRole("button", { name: /解除綁定/ }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("sends the DELETE and then shows the group as unbound", async () => {
    let linked = true;
    renderPage(
      fakeRequest({
        [CHAT]: (init) => {
          if (init?.method === "DELETE") {
            linked = false;
            return { ok: true };
          }
          return linked ? BOUND : UNBOUND;
        },
        [INVITE]: { code: "K7M2QX9PAB", miniLink: null },
      }),
    );

    await confirmUnlink();
    expect(await screen.findByText("尚未綁定")).toBeInTheDocument();
  });

  it("treats a 409 as done: another member unlinked first", async () => {
    let linked = true;
    renderPage(
      fakeRequest({
        [CHAT]: (init) => {
          if (init?.method === "DELETE") {
            linked = false;
            return new Failure(409);
          }
          return linked ? BOUND : UNBOUND;
        },
        [INVITE]: { code: "K7M2QX9PAB", miniLink: null },
      }),
    );

    await confirmUnlink();
    expect(await screen.findByText("尚未綁定")).toBeInTheDocument();
    expect(screen.queryByText("解除失敗，請再試一次")).not.toBeInTheDocument();
  });

  it("says so when the unlink fails, and keeps the group bound", async () => {
    renderPage(
      fakeRequest({ [CHAT]: (init) => (init?.method === "DELETE" ? new Failure(500) : BOUND) }),
    );

    await confirmUnlink();
    await waitFor(() => expect(screen.getByText("解除失敗，請再試一次")).toBeInTheDocument());
  });

  it("shows the ready-made /link command to a group with no chat, and no way to unlink", async () => {
    renderPage(fakeRequest({ [CHAT]: UNBOUND, [INVITE]: { code: "K7M2QX9PAB", miniLink: null } }));

    expect(await screen.findByText("尚未綁定")).toBeInTheDocument();
    expect(await screen.findByText("/link K7M2Q-X9PAB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /解除綁定/ })).not.toBeInTheDocument();
    expect(screen.queryByText("記帳通知發送位置")).not.toBeInTheDocument();
  });

  it("copies the command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage(fakeRequest({ [CHAT]: UNBOUND, [INVITE]: { code: "K7M2QX9PAB", miniLink: null } }));

    fireEvent.click(await screen.findByRole("button", { name: "複製指令" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/link K7M2Q-X9PAB"));
    expect(await screen.findByRole("button", { name: "已複製" })).toBeInTheDocument();
  });

  it("issues a code when the group has none, then shows the command", async () => {
    let code: string | null = null;
    renderPage(
      fakeRequest({
        [CHAT]: UNBOUND,
        [INVITE]: (init) => {
          if (init?.method === "POST") code = "K7M2QX9PAB";
          return { code, miniLink: null };
        },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "產生邀請碼" }));
    expect(await screen.findByText("/link K7M2Q-X9PAB")).toBeInTheDocument();
  });
});

describe("GroupTelegramPage: 記帳通知發送位置", () => {
  it("is hidden for a chat without topics", async () => {
    renderPage(fakeRequest({ [CHAT]: BOUND }));

    await screen.findByText("日本行");
    expect(screen.queryByText("記帳通知發送位置")).not.toBeInTheDocument();
    expect(screen.getByText(/開啟群組的「主題」功能後/)).toBeInTheDocument();
  });

  it("shows General and the /topic command, with nothing to go back to", async () => {
    renderPage(fakeRequest({ [CHAT]: { ...BOUND, isForum: true } }));

    expect(await screen.findByText("記帳通知發送位置")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("/topic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "改回 General" })).not.toBeInTheDocument();
  });

  it("shows the chosen topic and puts it back to General after confirming", async () => {
    let thread: GroupChatResponse["noticeThread"] = { id: 42, name: "旅遊記帳" };
    const request = fakeRequest({
      [CHAT]: () => ({ ...BOUND, isForum: true, noticeThread: thread }),
      [TOPIC]: (init) => {
        if (init?.method === "DELETE") thread = null;
        return { ok: true };
      },
    });
    renderPage(request);

    expect(await screen.findByText("旅遊記帳")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改回 General" }));
    expect(await screen.findByText(/已經發在「旅遊記帳」的卡片會留在原處/)).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "改回 General" });
    fireEvent.click(confirm[confirm.length - 1]);

    expect(await screen.findByText("General")).toBeInTheDocument();
    expect(
      request.mock.calls.some(([path, init]) => path === TOPIC && init?.method === "DELETE"),
    ).toBe(true);
  });

  it("still shows a topic left from before topics were switched off, so it can be cleared", async () => {
    renderPage(
      fakeRequest({
        [CHAT]: { ...BOUND, isForum: false, noticeThread: { id: 42, name: "旅遊記帳" } },
      }),
    );

    expect(await screen.findByText("旅遊記帳")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "改回 General" })).toBeInTheDocument();
  });
});
