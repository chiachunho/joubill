import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BeancountExportSection } from "@/components/mini/BeancountExportSection";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

const SUMMARY = "/api/groups/9/beancount/export/summary";

function summary(over: Record<string, unknown> = {}) {
  return {
    included: 4,
    corrected: 0,
    skipped: 1,
    lastExportedAt: null,
    telegramLinked: true,
    ...over,
  };
}

function renderSection(routes: Parameters<typeof fakeRequest>[0], canDownloadExport = true) {
  const request = fakeRequest(routes);
  const rawRequest = vi.fn(async () => new Response("", { status: 500 }));
  render(
    <StoreWrapper request={request}>
      <BeancountExportSection groupId="9" platform={{ canDownloadExport, rawRequest }} />
    </StoreWrapper>,
  );
  return request;
}

describe("BeancountExportSection", () => {
  it("starts on 全部 and offers no 上次匯出後 before the first export", async () => {
    renderSection({ [`${SUMMARY}?range=new`]: summary(), [`${SUMMARY}?range=all`]: summary() });

    expect(await screen.findByRole("radio", { name: /全部/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByRole("radio", { name: /上次匯出後/ })).not.toBeInTheDocument();
    expect(await screen.findByText("4 筆")).toBeInTheDocument();
  });

  it("starts on 上次匯出後 once there is a last export", async () => {
    renderSection({
      [`${SUMMARY}?range=new`]: summary({ included: 2, lastExportedAt: "2026-10-20T13:14:00Z" }),
    });
    expect(await screen.findByRole("radio", { name: /上次匯出後/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/新增 2 筆，修正 0 筆/)).toBeInTheDocument();
  });

  it("counts corrections apart from new records, and lets a corrections-only file go out", async () => {
    renderSection({
      [`${SUMMARY}?range=new`]: summary({
        included: 0,
        corrected: 3,
        lastExportedAt: "2026-10-20T13:14:00Z",
      }),
    });
    expect(await screen.findByText(/新增 0 筆，修正 3 筆/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "傳到我的私訊" })).toBeEnabled();
  });

  it("disables both actions when the range holds nothing of the viewer's", async () => {
    renderSection({
      [`${SUMMARY}?range=new`]: summary({ included: 0, lastExportedAt: "2026-10-20T13:14:00Z" }),
    });
    expect(await screen.findByText(/沒有新的變動/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載 .beancount" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "傳到我的私訊" })).toBeDisabled();
  });

  it("offers no download where the platform can't save files", async () => {
    renderSection({ [`${SUMMARY}?range=new`]: summary() }, false);
    await screen.findByText("4 筆");
    expect(screen.queryByRole("button", { name: "下載 .beancount" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "傳到我的私訊" })).toBeEnabled();
  });

  it("hides 傳到我的私訊 for an account with no Telegram", async () => {
    renderSection({ [`${SUMMARY}?range=new`]: summary({ telegramLinked: false }) });
    await screen.findByText("4 筆");
    expect(screen.queryByRole("button", { name: "傳到我的私訊" })).not.toBeInTheDocument();
  });

  it("shows the server's words when the bot can't reach the viewer", async () => {
    renderSection({
      [`${SUMMARY}?range=new`]: summary(),
      "/api/groups/9/beancount/export/send": new Failure(409, { error: "請先打開和機器人的私訊" }),
    });
    await screen.findByText("4 筆");
    fireEvent.click(screen.getByRole("button", { name: "傳到我的私訊" }));
    await waitFor(() => expect(screen.getByText("請先打開和機器人的私訊")).toBeInTheDocument());
  });
});
