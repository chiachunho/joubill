import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthConsentPage } from "@/components/pages/OAuthConsentPage";
import type { Platform } from "@/components/pages/platform";
import { miniPlatform } from "@/components/pages/platform.mini";
import { webPlatform } from "@/components/pages/platform.web";

// Radix's Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const QUERY = "?client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=xyz";
let assigned: string | null;

beforeEach(() => {
  assigned = null;
  const location = {
    search: QUERY,
    pathname: "/app/oauth/consent",
    set href(v: string) {
      assigned = v;
    },
    get href() {
      return "";
    },
  };
  vi.stubGlobal("location", location);
  Object.defineProperty(window, "location", { value: location, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const INFO = {
  client: { name: "Claude", redirectLabel: "claude.ai" },
  requestedAccess: "write",
  groups: [
    { id: 1, title: "東京旅行", defaultCurrency: "JPY" },
    { id: 2, title: "室友", defaultCurrency: "TWD" },
  ],
};

function webWith(rawRequest: Platform["rawRequest"]): Platform {
  return { ...webPlatform, useBack: () => {}, rawRequest };
}

describe("OAuthConsentPage in the Mini App", () => {
  it("says it is not supported, offers the browser, and asks the server nothing", () => {
    const openInBrowser = vi.fn();
    const rawRequest = vi.fn();
    render(
      <OAuthConsentPage
        platform={{ ...miniPlatform, useBack: () => {}, openInBrowser, rawRequest }}
      />,
    );
    expect(screen.getByText(/Mini App 不支援/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "允許" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /用瀏覽器開啟/ }));
    expect(openInBrowser).toHaveBeenCalledWith(`/app/oauth/consent${QUERY}`);
    expect(rawRequest).not.toHaveBeenCalled();
  });
});

describe("OAuthConsentPage in the Web App", () => {
  it("shows who asks and where the code goes, and won't allow before a group is chosen", async () => {
    render(<OAuthConsentPage platform={webWith(async () => json(200, INFO))} />);
    expect(await screen.findByText(/「Claude」想要連線/)).toBeInTheDocument();
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "允許" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /東京旅行/ }));
    expect(screen.getByRole("button", { name: "允許" })).toBeEnabled();
  });

  it("posts the choice and the request, then goes where the server says", async () => {
    const rawRequest = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(200, { redirectTo: "https://claude.ai/cb?code=abc" })
        : json(200, INFO),
    );
    render(<OAuthConsentPage platform={webWith(rawRequest)} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /東京旅行/ }));
    fireEvent.click(screen.getByRole("button", { name: "允許" }));
    await waitFor(() => expect(assigned).toBe("https://claude.ai/cb?code=abc"));
    const post = rawRequest.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      approve: true,
      access: "write",
      allGroups: false,
      groupIds: [1],
      params: { client_id: "c1", state: "xyz" },
    });
  });

  it("cancel sends approve: false", async () => {
    const rawRequest = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(200, { redirectTo: "https://claude.ai/cb?error=access_denied" })
        : json(200, INFO),
    );
    render(<OAuthConsentPage platform={webWith(rawRequest)} />);
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));
    await waitFor(() => expect(assigned).toContain("access_denied"));
    const post = rawRequest.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string).approve).toBe(false);
  });

  it("an untrusted request shows the error and no way back to the client", async () => {
    render(
      <OAuthConsentPage
        platform={webWith(async () =>
          json(400, {
            error: "invalid_request",
            error_description: "unknown client_id",
            redirectTo: null,
          }),
        )}
      />,
    );
    expect(await screen.findByText("unknown client_id")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "回到應用程式" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "允許" })).not.toBeInTheDocument();
  });

  it("a read-only request offers no write choice", async () => {
    render(
      <OAuthConsentPage
        platform={webWith(async () => json(200, { ...INFO, requestedAccess: "read" }))}
      />,
    );
    await screen.findByText(/「Claude」想要連線/);
    expect(screen.queryByRole("radio", { name: "可記帳" })).not.toBeInTheDocument();
  });
});
