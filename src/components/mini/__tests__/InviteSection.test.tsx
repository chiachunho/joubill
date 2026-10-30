import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InviteSection } from "@/components/mini/InviteSection";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

function renderSection(routes: Parameters<typeof fakeRequest>[0]) {
  return render(
    <StoreWrapper request={fakeRequest(routes)}>
      <InviteSection groupId="9" />
    </StoreWrapper>,
  );
}

describe("InviteSection", () => {
  it("shows the code grouped 5-5 with a reset action", async () => {
    renderSection({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } });

    expect(await screen.findByText("K7M2Q-X9PAB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重設邀請碼" })).toBeInTheDocument();
  });

  it("offers the Telegram link only when the server could build one", async () => {
    renderSection({
      "/api/groups/9/invite": {
        code: "K7M2QX9PAB",
        miniLink: "https://t.me/bot/app?startapp=join_K7M2QX9PAB",
      },
    });
    expect(await screen.findByRole("button", { name: "複製 Telegram 連結" })).toBeInTheDocument();
  });

  it("hides the Telegram link when there is none", async () => {
    renderSection({ "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null } });
    await screen.findByText("K7M2Q-X9PAB");
    expect(screen.queryByRole("button", { name: "複製 Telegram 連結" })).not.toBeInTheDocument();
  });

  it("offers to issue a first code instead of creating one on read", async () => {
    let code: string | null = null;
    const request = fakeRequest({
      "/api/groups/9/invite": (init) => {
        if (init?.method === "POST") code = "CCCCCDDDDD";
        return { code, miniLink: null };
      },
    });
    render(
      <StoreWrapper request={request}>
        <InviteSection groupId="9" />
      </StoreWrapper>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "產生邀請碼" }));
    await waitFor(() => expect(screen.getByText("CCCCC-DDDDD")).toBeInTheDocument());
  });
});
