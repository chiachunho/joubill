import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountMergePage } from "@/components/pages/AccountMergePage";
import { miniPlatform } from "@/components/pages/platform.mini";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(cleanup);

describe("AccountMergePage in the Mini App", () => {
  it("explains the steps and opens the web settings in the browser, without reading a ticket", async () => {
    const openInBrowser = vi.fn();
    // No routes: any request, such as the merge preview, would fail the page.
    const request = vi.fn(fakeRequest({}));
    render(
      <StoreWrapper request={request}>
        <AccountMergePage platform={{ ...miniPlatform, useBack: () => {}, openInBrowser }} />
      </StoreWrapper>,
    );

    expect(screen.getByText(/合併要在網頁版操作/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /在瀏覽器開啟網頁版/ }));
    expect(openInBrowser).toHaveBeenCalledWith("/app/settings");
    expect(request).not.toHaveBeenCalled();
  });
});
