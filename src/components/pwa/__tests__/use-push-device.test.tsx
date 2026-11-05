import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PwaEnv } from "@/lib/pwa";
import { usePushDevice } from "@/lib/use-push-device";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

const ENV: PwaEnv = {
  standalone: true,
  ios: false,
  inAppBrowser: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};

const ENDPOINT = "https://push.example/endpoint-1";

let permission: NotificationPermission;
let status: EventTarget;
let subscription: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null;

beforeEach(() => {
  status = new EventTarget();
  subscription = null;
  vi.stubGlobal("Notification", {
    get permission() {
      return permission;
    },
    requestPermission: vi.fn(),
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(async () => status) },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "permissions");
  Reflect.deleteProperty(navigator, "serviceWorker");
});

function Probe() {
  const device = usePushDevice(ENV);
  return (
    <>
      <span>permission:{device.permission ?? "none"}</span>
      <span>endpoint:{device.endpoint ?? "none"}</span>
    </>
  );
}

function renderProbe() {
  const request = fakeRequest({
    "/api/me/push-subscriptions": { configured: false, count: 0 },
  });
  render(
    <StoreWrapper request={request}>
      <Probe />
    </StoreWrapper>,
  );
  return request;
}

describe("usePushDevice", () => {
  it("follows the permission the browser reports, including a change made in its settings", async () => {
    permission = "default";
    renderProbe();
    expect(await screen.findByText("permission:default")).toBeInTheDocument();

    permission = "denied";
    act(() => {
      status.dispatchEvent(new Event("change"));
    });

    expect(await screen.findByText("permission:denied")).toBeInTheDocument();
  });

  it("drops a subscription the browser will no longer show", async () => {
    permission = "denied";
    subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn(async () => true) };
    const request = renderProbe();

    // The server copy goes first, then the browser's, then the switch reads off.
    await waitFor(() => {
      const deleteCall = request.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(deleteCall?.[1]?.body).toBe(JSON.stringify({ endpoint: ENDPOINT }));
    });
    await waitFor(() => expect(subscription?.unsubscribe).toHaveBeenCalled());
    expect(await screen.findByText("endpoint:none")).toBeInTheDocument();
  });

  it("keeps a subscription while notifications are still allowed", async () => {
    permission = "granted";
    subscription = { endpoint: ENDPOINT, unsubscribe: vi.fn(async () => true) };
    const request = renderProbe();

    expect(await screen.findByText(`endpoint:${ENDPOINT}`)).toBeInTheDocument();
    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});
