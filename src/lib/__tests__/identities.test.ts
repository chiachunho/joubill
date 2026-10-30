import { describe, expect, it } from "vitest";

import { canUnlink, isLoginProvider, linkableNow, loginErrorMessage } from "@/lib/identities";

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
  it("offers enabled providers that are not linked, never Telegram", () => {
    expect(linkableNow(["telegram", "line", "google"], ["telegram", "google"])).toEqual(["line"]);
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
  it("explains an identity that belongs to another account", () => {
    expect(loginErrorMessage("OAuthAccountNotLinked")).toContain("不會自動合併");
  });

  it("is silent without an error", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});
