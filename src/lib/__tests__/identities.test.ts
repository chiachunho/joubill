import { describe, expect, it } from "vitest";

import {
  authErrorRedirect,
  canUnlink,
  isLoginProvider,
  linkableNow,
  linkErrorMessage,
  loginErrorMessage,
} from "@/lib/identities";

describe("canUnlink", () => {
  it("refuses the last login method", () => {
    expect(canUnlink("google", ["google"])).toEqual({ ok: false, reason: "last" });
  });

  it("refuses Telegram, which the bot and Mini App resolve the user by", () => {
    expect(canUnlink("telegram", ["telegram", "google"])).toEqual({
      ok: false,
      reason: "telegram",
    });
  });

  it("allows removing one of several", () => {
    expect(canUnlink("line", ["telegram", "line"])).toEqual({ ok: true });
  });
});

describe("linkableNow", () => {
  it("offers enabled providers that are not linked", () => {
    expect(linkableNow(["telegram", "line", "google"], ["telegram", "google"])).toEqual(["line"]);
  });

  it("offers Telegram to an account that signed in without it", () => {
    expect(linkableNow(["telegram", "google"], ["google"])).toEqual(["telegram"]);
  });

  it("offers nothing for a provider the deployment has not configured", () => {
    expect(linkableNow(["telegram"], ["telegram"])).toEqual([]);
  });
});

describe("isLoginProvider", () => {
  it("accepts known providers and rejects others", () => {
    expect(isLoginProvider("line")).toBe(true);
    expect(isLoginProvider("facebook")).toBe(false);
  });
});

describe("loginErrorMessage", () => {
  it("offers a retry for any sign-in failure", () => {
    expect(loginErrorMessage("OAuthCallbackError")).toBe("登入失敗，請再試一次。");
  });

  it("is silent without an error", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});

describe("authErrorRedirect", () => {
  it("sends a signed-in visitor back to settings with the code", () => {
    expect(authErrorRedirect("OAuthCallbackError", true)).toBe(
      "/app/settings?linkError=OAuthCallbackError",
    );
  });

  it("keeps a signed-out visitor on the login page", () => {
    expect(authErrorRedirect("OAuthCallbackError", false)).toBeNull();
  });

  it("does nothing without an error", () => {
    expect(authErrorRedirect(undefined, true)).toBeNull();
  });

  it("encodes a code it doesn't recognise", () => {
    expect(authErrorRedirect("a&b", true)).toBe("/app/settings?linkError=a%26b");
  });
});

describe("linkErrorMessage", () => {
  it("explains a cancelled consent, naming the provider", () => {
    expect(linkErrorMessage("OAuthCallbackError", "line")).toBe(
      "沒有連結 LINE：授權沒有完成，可能是在 LINE 的頁面取消了。",
    );
  });

  it("explains a cancelled consent without a provider", () => {
    expect(linkErrorMessage("OAuthCallbackError", null)).toBe(
      "沒有連結：授權沒有完成，可能是在授權頁取消了。",
    );
  });

  it("falls back to a retry for anything else", () => {
    expect(linkErrorMessage("AccessDenied", "google")).toBe("連結 Google 失敗，請再試一次。");
    expect(linkErrorMessage("Configuration", null)).toBe("連結失敗，請再試一次。");
  });

  it("has no special text for an identity owned by another account", () => {
    // The signIn callback turns that case into a merge offer before Auth.js can raise it.
    expect(linkErrorMessage("OAuthAccountNotLinked", "line")).toBe("連結 LINE 失敗，請再試一次。");
  });
});
