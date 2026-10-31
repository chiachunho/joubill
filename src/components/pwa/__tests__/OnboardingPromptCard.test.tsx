import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingPromptCard } from "@/components/pwa/OnboardingPromptCard";
import type { PwaEnv } from "@/lib/pwa";
import type { PushDevice } from "@/lib/use-push-device";

const HOME_SCREEN_APP: PwaEnv = {
  standalone: true,
  ios: true,
  inAppBrowser: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};

let device: PushDevice;
vi.mock("@/lib/use-push-device", () => ({ usePushDevice: () => device }));
vi.mock("@/lib/use-pwa-env", () => ({ usePwaEnv: () => HOME_SCREEN_APP }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  device = {
    support: "supported",
    configured: true,
    permission: "default",
    endpoint: null,
    loading: false,
    enable: vi.fn(),
    disable: vi.fn(),
  };
});
afterEach(cleanup);

describe("OnboardingPromptCard", () => {
  it("keeps the card with a retry when turning push on fails", async () => {
    device.enable = vi.fn().mockResolvedValue("failed");
    render(<OnboardingPromptCard />);

    fireEvent.click(await screen.findByRole("button", { name: "開啟通知" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("沒有開成功");
    expect(screen.getByText("朋友記了你要分的帳時通知你？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下次再說" })).toBeEnabled();

    device.enable = vi.fn().mockResolvedValue("on");
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    expect(await screen.findByText("通知開好了。")).toBeInTheDocument();
  });
});
