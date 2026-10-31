import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationSection } from "@/components/pwa/NotificationSection";
import type { PwaEnv } from "@/lib/pwa";
import type { PushDevice } from "@/lib/use-push-device";
import { StoreWrapper, fakeRequest } from "@/store/test-utils";

let device: PushDevice;
vi.mock("@/lib/use-push-device", () => ({ usePushDevice: () => device }));

afterEach(cleanup);

const ENV: PwaEnv = {
  standalone: true,
  ios: false,
  inAppBrowser: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};

function setDevice(over: Partial<PushDevice>) {
  device = {
    support: "supported",
    configured: true,
    permission: "default",
    endpoint: null,
    loading: false,
    enable: vi.fn(),
    disable: vi.fn(),
    ...over,
  };
}

function renderSection() {
  return render(
    <StoreWrapper request={fakeRequest({})}>
      <NotificationSection env={ENV} />
    </StoreWrapper>,
  );
}

describe("NotificationSection", () => {
  it("is hidden when the server has no push", () => {
    setDevice({ configured: false });
    renderSection();
    expect(screen.queryByText("通知")).not.toBeInTheDocument();
  });

  it("offers the switch, off, until this device subscribes", () => {
    setDevice({});
    renderSection();
    const toggle = screen.getByRole("switch", { name: "這台裝置的推播" });
    expect(toggle).toBeEnabled();
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText("傳送測試通知")).not.toBeInTheDocument();
  });

  it("shows the test button once on", () => {
    setDevice({ endpoint: "https://fcm.googleapis.com/fcm/send/x", permission: "granted" });
    renderSection();
    expect(screen.getByRole("switch", { name: "這台裝置的推播" })).toBeChecked();
    expect(screen.getByText("傳送測試通知")).toBeInTheDocument();
  });

  it("keeps the switch but disables it on an iPhone outside the home screen", () => {
    setDevice({ support: "needs-home-screen", permission: null });
    renderSection();
    expect(screen.getByRole("switch", { name: "這台裝置的推播" })).toBeDisabled();
    expect(screen.getByText("需要先加到主畫面")).toBeInTheDocument();
  });

  it("explains where to turn notifications back on after 不允許", () => {
    setDevice({ permission: "denied" });
    renderSection();
    expect(screen.getByRole("switch", { name: "這台裝置的推播" })).toBeDisabled();
    expect(screen.getByText("通知已被封鎖")).toBeInTheDocument();
  });

  it("replaces the switch where the browser has no push", () => {
    setDevice({ support: "unsupported", permission: null });
    renderSection();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(/這個瀏覽器不支援推播通知/)).toBeInTheDocument();
  });
});
