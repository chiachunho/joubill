import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimezonePrompt } from "@/components/mini/TimezonePrompt";
import { timezonePromptKey } from "@/lib/timezone";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

const { device } = vi.hoisted(() => ({ device: { zone: "Asia/Taipei" } }));
vi.mock("@/lib/timezone", async (orig) => ({
  ...(await orig<typeof import("@/lib/timezone")>()),
  deviceTimeZone: () => device.zone,
}));

/** The zone this device reports, which is what the prompt compares the group's with. */
function deviceIs(timeZone: string) {
  device.zone = timeZone;
}

function renderPrompt(groupZone: string, extra: Record<string, unknown> = {}) {
  const request = fakeRequest({
    "/api/groups/7/settings": { defaultCurrency: "TWD", timezone: groupZone },
    ...extra,
  });
  render(
    <StoreWrapper request={request}>
      <TimezonePrompt groupId="7" />
    </StoreWrapper>,
  );
  return request;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("TimezonePrompt", () => {
  it("asks when the device is at another UTC offset, naming both zones", async () => {
    deviceIs("Asia/Tokyo");
    renderPrompt("Asia/Taipei");

    expect(await screen.findByText(/你的裝置時區是/)).toBeInTheDocument();
    expect(screen.getAllByText(/Asia\/Tokyo \(UTC\+9\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Asia\/Taipei \(UTC\+8\)/)).toBeInTheDocument();
    expect(screen.getByText(/記在這個時區的今天/)).toBeInTheDocument();
  });

  it("says nothing for a zone at the same offset", async () => {
    deviceIs("Asia/Singapore");
    const request = renderPrompt("Asia/Taipei");

    await waitFor(() => expect(request).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/你的裝置時區是/)).not.toBeInTheDocument();
  });

  it("remembers 不用 on this device, for this device zone only", async () => {
    deviceIs("Asia/Tokyo");
    renderPrompt("Asia/Taipei");
    fireEvent.click(await screen.findByRole("button", { name: "不用" }));

    expect(screen.queryByText(/你的裝置時區是/)).not.toBeInTheDocument();
    expect(localStorage.getItem(timezonePromptKey("7", "Asia/Tokyo"))).not.toBeNull();
    expect(localStorage.getItem(timezonePromptKey("7", "Asia/Seoul"))).toBeNull();
  });

  it("stays quiet when this device already said 不用", async () => {
    deviceIs("Asia/Tokyo");
    localStorage.setItem(timezonePromptKey("7", "Asia/Tokyo"), "1");
    const request = renderPrompt("Asia/Taipei");

    await waitFor(() => expect(request).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/你的裝置時區是/)).not.toBeInTheDocument();
  });

  it("sends the device zone when accepted", async () => {
    deviceIs("Asia/Tokyo");
    const request = renderPrompt("Asia/Taipei", {
      "/api/groups/7/settings?": {},
    });
    fireEvent.click(await screen.findByRole("button", { name: "改成 Asia/Tokyo" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/api/groups/7/settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ timezone: "Asia/Tokyo" }),
        }),
      ),
    );
  });
});
