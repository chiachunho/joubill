import { describe, expect, it } from "vitest";

import type { AgentConnectionItem } from "../api-types";
import {
  activeConnections,
  expiryLabel,
  lastUsedLabel,
  sameScope,
  scopeSummary,
  usableConnections,
} from "../agent-ui";

const now = new Date("2026-11-06T12:00:00Z");
const conn = (over: Partial<AgentConnectionItem>): AgentConnectionItem => ({
  id: 1,
  kind: "token",
  name: "n",
  tokenPrefix: "sbk_abcd",
  access: "read",
  allGroups: false,
  groupIds: [],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("connection lists", () => {
  const list = [
    conn({ id: 1 }),
    conn({ id: 2, expiresAt: "2026-11-01T00:00:00Z" }),
    conn({ id: 3, revokedAt: "2026-11-02T00:00:00Z" }),
  ];
  it("hides revoked ones from the list and counts only the active", () => {
    expect(usableConnections(list, now).map((c) => c.id)).toEqual([1, 2]);
    expect(activeConnections(list, now).map((c) => c.id)).toEqual([1]);
  });
});

describe("scopeSummary", () => {
  const groups = [
    { id: 1, title: "東京旅行" },
    { id: 2, title: "室友" },
  ];
  it("names the groups, all of them, or says none are left", () => {
    expect(scopeSummary({ allGroups: true, groupIds: [] }, groups)).toBe("所有群組");
    expect(scopeSummary({ allGroups: false, groupIds: [2, 1, 9] }, groups)).toBe("東京旅行、室友");
    expect(scopeSummary({ allGroups: false, groupIds: [9] }, groups)).toBe("沒有可用的群組");
  });
});

describe("labels", () => {
  it("reads last use and expiry", () => {
    expect(lastUsedLabel(null, now)).toBe("從未使用");
    expect(lastUsedLabel("2026-11-06T11:58:00Z", now)).toBe("2 分鐘前使用");
    expect(lastUsedLabel("2026-11-06T09:00:00Z", now)).toBe("3 小時前使用");
    expect(expiryLabel(null, now)).toBe("不過期");
    expect(expiryLabel("2026-12-06T12:00:00Z", now)).toBe("30 天後到期");
    expect(expiryLabel("2026-11-05T12:00:00Z", now)).toBe("已到期");
  });
});

describe("sameScope", () => {
  it("ignores order, and ignores stale ids when all groups is on", () => {
    expect(
      sameScope({ allGroups: false, groupIds: [2, 1] }, { allGroups: false, groupIds: [1, 2] }),
    ).toBe(true);
    expect(sameScope({ allGroups: true, groupIds: [1] }, { allGroups: true, groupIds: [] })).toBe(
      true,
    );
    expect(sameScope({ allGroups: true, groupIds: [] }, { allGroups: false, groupIds: [1] })).toBe(
      false,
    );
    expect(
      sameScope({ allGroups: false, groupIds: [1] }, { allGroups: false, groupIds: [1, 2] }),
    ).toBe(false);
  });
});
