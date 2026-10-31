import { describe, expect, it } from "vitest";

import {
  isUnauthorizedError,
  loginCallbackUrl,
  loginUrl,
  WEB_LOGIN_PATH,
} from "@/lib/auth-redirect";

describe("isUnauthorizedError", () => {
  it("recognises the message the fetchers throw for a 401", () => {
    expect(isUnauthorizedError(new Error("401 /api/me/groups: Unauthorized"))).toBe(true);
  });

  it("accepts a plain string and an error-shaped object", () => {
    expect(isUnauthorizedError("401 /api/me")).toBe(true);
    expect(isUnauthorizedError({ message: "401 /api/me" })).toBe(true);
  });

  it("does not treat a 401 inside the path or body as unauthorized", () => {
    expect(isUnauthorizedError(new Error("403 /api/groups/401/stats"))).toBe(false);
    expect(isUnauthorizedError(new Error("500 /api/me: upstream said 401"))).toBe(false);
  });

  it("is false for other statuses and for values that are not errors", () => {
    expect(isUnauthorizedError(new Error("404 /api/me"))).toBe(false);
    expect(isUnauthorizedError(undefined)).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
    expect(isUnauthorizedError(401)).toBe(false);
    expect(isUnauthorizedError({})).toBe(false);
  });
});

describe("loginUrl", () => {
  it("carries the current path and query so sign-in returns there", () => {
    expect(loginUrl(WEB_LOGIN_PATH, "/app/groups/7/stats", "?range=1y")).toBe(
      "/login?next=%2Fapp%2Fgroups%2F7%2Fstats%3Frange%3D1y",
    );
  });

  it("works with no query string", () => {
    expect(loginUrl("/login", "/app", "")).toBe("/login?next=%2Fapp");
  });
});

describe("loginCallbackUrl", () => {
  const REMEMBERED = "https://splitbill.example/join/K7M2QX9PAB";

  it("returns to ?next= when it is a path on this site", () => {
    expect(loginCallbackUrl("/join/K7M2QX9PAB", undefined, undefined)).toBe("/join/K7M2QX9PAB");
  });

  it("prefers ?next= over the remembered attempt", () => {
    expect(loginCallbackUrl("/app/groups/1", "OAuthCallbackError", REMEMBERED)).toBe(
      "/app/groups/1",
    );
  });

  it("refuses a ?next= that could leave the site", () => {
    expect(loginCallbackUrl("//evil.example", undefined, undefined)).toBe("/app");
    expect(loginCallbackUrl("/\\evil.example", undefined, undefined)).toBe("/app");
    expect(loginCallbackUrl("https://evil.example", undefined, undefined)).toBe("/app");
  });

  it("returns a failed sign-in to where that attempt was headed", () => {
    expect(loginCallbackUrl(undefined, "OAuthCallbackError", REMEMBERED)).toBe("/join/K7M2QX9PAB");
  });

  it("keeps the query of the remembered page", () => {
    expect(
      loginCallbackUrl(undefined, "AccessDenied", "https://splitbill.example/app/groups/3?tab=x"),
    ).toBe("/app/groups/3?tab=x");
  });

  it("keeps only the path of a remembered URL on another origin", () => {
    expect(loginCallbackUrl(undefined, "OAuthCallbackError", "https://evil.example/app")).toBe(
      "/app",
    );
    expect(loginCallbackUrl(undefined, "OAuthCallbackError", "https://evil.example/join/X")).toBe(
      "/join/X",
    );
  });

  it("ignores the cookie without an error, since it may be from a sign-in long ago", () => {
    expect(loginCallbackUrl(undefined, undefined, REMEMBERED)).toBe("/app");
  });

  it("ignores a cookie that is not an absolute URL", () => {
    expect(loginCallbackUrl(undefined, "OAuthCallbackError", "not a url")).toBe("/app");
  });
});
