import { describe, expect, it } from "vitest";

import { connectionStatus, updateConnectionSchema } from "../mcp-connection-input";

describe("updateConnectionSchema", () => {
  it("accepts a permission change alone", () => {
    expect(updateConnectionSchema.safeParse({ access: "read" }).success).toBe(true);
  });
  it("accepts a scope change with both halves", () => {
    expect(updateConnectionSchema.safeParse({ allGroups: false, groupIds: [1, 2] }).success).toBe(
      true,
    );
    expect(updateConnectionSchema.safeParse({ allGroups: true, groupIds: [] }).success).toBe(true);
  });
  it("refuses a half-given scope", () => {
    expect(updateConnectionSchema.safeParse({ allGroups: true }).success).toBe(false);
    expect(updateConnectionSchema.safeParse({ groupIds: [1] }).success).toBe(false);
  });
  it("refuses an empty change and an empty explicit scope", () => {
    expect(updateConnectionSchema.safeParse({}).success).toBe(false);
    expect(updateConnectionSchema.safeParse({ allGroups: false, groupIds: [] }).success).toBe(
      false,
    );
  });
  it("does not let the name or expiry change", () => {
    const r = updateConnectionSchema.safeParse({ access: "read", name: "x", expiresInDays: 9 });
    expect(r.success && "name" in r.data).toBe(false);
  });
});

describe("connectionStatus", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  it("tells active, expired and revoked apart, revoked first", () => {
    expect(connectionStatus({ revokedAt: null, expiresAt: null }, now)).toBe("active");
    expect(connectionStatus({ revokedAt: null, expiresAt: "2026-12-01T00:00:00Z" }, now)).toBe(
      "active",
    );
    expect(connectionStatus({ revokedAt: null, expiresAt: "2026-11-05T00:00:00Z" }, now)).toBe(
      "expired",
    );
    expect(
      connectionStatus(
        { revokedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-05T00:00:00Z" },
        now,
      ),
    ).toBe("revoked");
  });
});
