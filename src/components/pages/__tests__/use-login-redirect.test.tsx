import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLoginRedirect } from "@/components/pages/use-login-redirect";

afterEach(() => {
  vi.unstubAllGlobals();
});

// jsdom cannot navigate, so stand in for window.location and watch what is assigned to it.
function stubLocation() {
  const location = { href: "/app", pathname: "/app/settings", search: "?a=1" };
  vi.stubGlobal("location", location);
  return location;
}

describe("useLoginRedirect", () => {
  it("sends the viewer to the login path on a 401", () => {
    const location = stubLocation();
    const { result } = renderHook(() => useLoginRedirect(new Error("401 /api/me"), "/login"));
    expect(result.current).toBe(true);
    expect(location.href).toBe("/login?next=%2Fapp%2Fsettings%3Fa%3D1");
  });

  it("does not treat a 401 inside the request path as unauthorized", () => {
    const location = stubLocation();
    const { result } = renderHook(() =>
      useLoginRedirect(new Error("403 /api/groups/401/stats"), "/login"),
    );
    expect(result.current).toBe(false);
    expect(location.href).toBe("/app");
  });

  it("does nothing when the platform has no login path", () => {
    const location = stubLocation();
    const { result } = renderHook(() => useLoginRedirect(new Error("401 /api/me"), null));
    expect(result.current).toBe(false);
    expect(location.href).toBe("/app");
  });

  it("does nothing for an error that is not a 401", () => {
    const location = stubLocation();
    const { result } = renderHook(() => useLoginRedirect(new Error("500 /api/me"), "/login"));
    expect(result.current).toBe(false);
    expect(location.href).toBe("/app");
  });

  it("does nothing while there is no error", () => {
    const location = stubLocation();
    const { result } = renderHook(() => useLoginRedirect(undefined, "/login"));
    expect(result.current).toBe(false);
    expect(location.href).toBe("/app");
  });
});
