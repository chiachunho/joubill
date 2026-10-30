import { describe, expect, it } from "vitest";

import { isInAppBrowser } from "@/lib/in-app-browser";

describe("isInAppBrowser", () => {
  it("detects LINE's built-in browser", () => {
    expect(
      isInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.0.0",
      ),
    ).toBe(true);
  });

  it("detects Telegram's built-in browser", () => {
    expect(
      isInAppBrowser("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Telegram-Android/10.0"),
    ).toBe(true);
  });

  it("does not flag an ordinary browser or a missing UA", () => {
    expect(isInAppBrowser("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(
      false,
    );
    expect(isInAppBrowser(null)).toBe(false);
  });
});
