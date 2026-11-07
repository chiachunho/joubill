import { describe, expect, it } from "vitest";

import {
  capAccess,
  clientCredentials,
  isAcceptableRedirectUri,
  newAccessToken,
  parseAccessToken,
  parseScope,
  pkcePair,
  redirectLabel,
  sanitizeClientName,
  scopeOf,
  verifyPkce,
} from "@/lib/oauth";

describe("parseScope", () => {
  it("asks for the narrowest access when nothing is requested", () => {
    expect(parseScope(undefined)).toBe("read");
    expect(parseScope("  ")).toBe("read");
  });
  it("write includes read, and an unknown scope is refused", () => {
    expect(parseScope("records:read")).toBe("read");
    expect(parseScope("records:read records:write")).toBe("write");
    expect(parseScope("records:write")).toBe("write");
    expect(parseScope("records:read admin")).toBeNull();
  });
  it("is reported back as a scope string", () => {
    expect(scopeOf("read")).toBe("records:read");
    expect(parseScope(scopeOf("write"))).toBe("write");
  });
  it("a person can't grant more than was asked for", () => {
    expect(capAccess("read", "write")).toBe("read");
    expect(capAccess("write", "read")).toBe("read");
    expect(capAccess("write", "write")).toBe("write");
  });
});

describe("isAcceptableRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:8123/callback",
    "http://127.0.0.1/cb",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
  ])("accepts %s", (uri) => expect(isAcceptableRedirectUri(uri)).toBe(true));

  it.each([
    "http://evil.example/cb",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "https://user:pw@claude.ai/cb",
    "https://claude.ai/cb#frag",
    "not a url",
    "https://",
    `https://x.example/${"a".repeat(2100)}`,
  ])("refuses %s", (uri) => expect(isAcceptableRedirectUri(uri)).toBe(false));
});

describe("redirectLabel", () => {
  it("shows the host for web URLs and the scheme for an app's own", () => {
    expect(redirectLabel("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectLabel("http://localhost:8123/cb")).toBe("localhost:8123");
    expect(redirectLabel("cursor://x/y")).toBe("cursor://");
  });
});

describe("sanitizeClientName", () => {
  it("strips controls, bidi overrides and runs of spaces, and caps the length", () => {
    expect(sanitizeClientName("  Claude\n‮evil‬   app ")).toBe("Claude evil app");
    expect(sanitizeClientName("x".repeat(200))).toHaveLength(60);
  });
  it("falls back when there is nothing printable", () => {
    expect(sanitizeClientName("\u0000‮")).toBe("未命名的應用程式");
    expect(sanitizeClientName(42)).toBe("未命名的應用程式");
  });
});

describe("verifyPkce", () => {
  it("accepts the matching verifier only", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(pkcePair().verifier, challenge)).toBe(false);
  });
  it("refuses a verifier of the wrong shape and a plain challenge", () => {
    const { verifier } = pkcePair();
    expect(verifyPkce("short", verifier)).toBe(false);
    expect(verifyPkce(verifier, verifier)).toBe(false);
  });
});

describe("tokens", () => {
  it("an access token parses from a bearer header, and a personal token does not", () => {
    const t = newAccessToken();
    expect(parseAccessToken(`Bearer ${t}`)).toBe(t);
    expect(parseAccessToken(`Bearer sbk_${"a".repeat(43)}`)).toBeNull();
    expect(parseAccessToken(null)).toBeNull();
  });
});

describe("clientCredentials", () => {
  it("reads HTTP Basic, preferring it over the form", () => {
    const basic = "Basic " + Buffer.from("cid:secret%21").toString("base64");
    expect(clientCredentials(basic, new URLSearchParams("client_id=other"))).toEqual({
      clientId: "cid",
      clientSecret: "secret!",
    });
  });
  it("falls back to the form, and survives a malformed header", () => {
    expect(clientCredentials(null, new URLSearchParams("client_id=a&client_secret=b"))).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
    const bad = "Basic " + Buffer.from("a:%E0%A4%A").toString("base64");
    expect(clientCredentials(bad, new URLSearchParams())).toEqual({
      clientId: null,
      clientSecret: null,
    });
  });
});
