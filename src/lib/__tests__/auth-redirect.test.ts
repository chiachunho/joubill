import { describe, expect, it } from "vitest";

import { isUnauthorizedError, loginUrl, WEB_LOGIN_PATH } from "@/lib/auth-redirect";

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
