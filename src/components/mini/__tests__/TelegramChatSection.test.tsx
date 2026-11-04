import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TelegramChatSection } from "@/components/mini/TelegramChatSection";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

const CHAT = "/api/groups/9/chat";

function renderSection(request: ReturnType<typeof fakeRequest>) {
  return render(
    <StoreWrapper request={request}>
      <TelegramChatSection groupId="9" />
    </StoreWrapper>,
  );
}

describe("TelegramChatSection", () => {
  it("shows the bound chat and asks before unlinking", async () => {
    renderSection(fakeRequest({ [CHAT]: { linked: true, title: "日本行" } }));

    expect(await screen.findByText("日本行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /解除綁定/ }));

    expect(await screen.findByText("解除與「日本行」的綁定？")).toBeInTheDocument();
    expect(screen.getByText(/bot 會離開那個 Telegram 群組/)).toBeInTheDocument();
  });

  it("does not unlink until the dialog is confirmed", async () => {
    const request = fakeRequest({ [CHAT]: { linked: true, title: "日本行" } });
    renderSection(request);

    fireEvent.click(await screen.findByRole("button", { name: /解除綁定/ }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("sends the DELETE and then shows the group as unbound", async () => {
    let linked = true;
    const request = fakeRequest({
      [CHAT]: (init) => {
        if (init?.method === "DELETE") {
          linked = false;
          return { ok: true };
        }
        return { linked, title: linked ? "日本行" : null };
      },
    });
    renderSection(request);

    fireEvent.click(await screen.findByRole("button", { name: /解除綁定/ }));
    const confirm = await screen.findAllByRole("button", { name: "解除綁定" });
    fireEvent.click(confirm[confirm.length - 1]);

    expect(await screen.findByText("尚未綁定")).toBeInTheDocument();
  });

  it("offers /link to a group with no chat, and no way to unlink", async () => {
    renderSection(fakeRequest({ [CHAT]: { linked: false, title: null } }));

    expect(await screen.findByText(/\/link 邀請碼/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /解除綁定/ })).not.toBeInTheDocument();
  });

  it("treats a 409 as done: another member unlinked first", async () => {
    let linked = true;
    renderSection(
      fakeRequest({
        [CHAT]: (init) => {
          if (init?.method === "DELETE") {
            linked = false;
            return new Failure(409);
          }
          return { linked, title: linked ? "日本行" : null };
        },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /解除綁定/ }));
    const confirm = await screen.findAllByRole("button", { name: "解除綁定" });
    fireEvent.click(confirm[confirm.length - 1]);

    expect(await screen.findByText("尚未綁定")).toBeInTheDocument();
    expect(screen.queryByText("解除失敗，請再試一次")).not.toBeInTheDocument();
  });

  it("says so when the unlink fails, and keeps the group bound", async () => {
    renderSection(
      fakeRequest({
        [CHAT]: (init) =>
          init?.method === "DELETE" ? new Failure(500) : { linked: true, title: "日本行" },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /解除綁定/ }));
    const confirm = await screen.findAllByRole("button", { name: "解除綁定" });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() => expect(screen.getByText("解除失敗，請再試一次")).toBeInTheDocument());
  });
});
