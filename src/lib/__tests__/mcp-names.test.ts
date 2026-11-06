import { describe, expect, it } from "vitest";

import { describeUnresolved, resolveMember } from "@/lib/mcp-names";

const m = (
  id: number,
  displayName: string | null,
  firstName: string,
  username: string | null = null,
  lastName: string | null = null,
) => ({
  id,
  displayName,
  firstName,
  lastName,
  username,
});

const members = [
  m(1, "阿華", "Hua", "hua_tw"),
  m(2, "Jenny", "Jennifer", "jen"),
  m(3, "Alex", "Alex", null, "Chen"),
  m(4, "Alex", "Alexander", null, "Wu"),
];

describe("resolveMember", () => {
  it("matches display name, provider name and username, ignoring case, width and @", () => {
    expect(resolveMember("阿華", members)).toMatchObject({ ok: true, member: { id: 1 } });
    expect(resolveMember("jenny", members)).toMatchObject({ ok: true, member: { id: 2 } });
    expect(resolveMember("Jennifer", members)).toMatchObject({ ok: true, member: { id: 2 } });
    expect(resolveMember("@HUA_TW", members)).toMatchObject({ ok: true, member: { id: 1 } });
    expect(resolveMember("ＪＥＮＮＹ", members)).toMatchObject({ ok: true, member: { id: 2 } });
  });

  it("does not guess from a prefix", () => {
    const r = resolveMember("Jen", members);
    expect(r).toMatchObject({ ok: true }); // "jen" is Jenny's exact username
    const r2 = resolveMember("Jenn", members);
    expect(r2).toMatchObject({ ok: false, code: "member_not_found" });
  });

  it("lists every candidate when nothing matches", () => {
    const r = resolveMember("Bob", members);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates.map((c) => c.memberId)).toEqual([1, 2, 3, 4]);
  });

  it("reports ambiguity with only the tied members", () => {
    const r = resolveMember("alex", members);
    expect(r).toMatchObject({ ok: false, code: "member_ambiguous" });
    if (!r.ok) expect(r.candidates.map((c) => c.memberId)).toEqual([3, 4]);
  });

  it("a memberId skips matching, and an unknown id is not found", () => {
    expect(resolveMember(4, members)).toMatchObject({ ok: true, member: { id: 4 } });
    expect(resolveMember(99, members)).toMatchObject({ ok: false, code: "member_not_found" });
  });

  it("an empty name matches nobody", () => {
    expect(resolveMember("  ", members)).toMatchObject({ ok: false, code: "member_not_found" });
  });
});

describe("describeUnresolved", () => {
  const cands = [
    { memberId: 12, label: "阿華 (@ahua)" },
    { memberId: 31, label: "阿華" },
  ];

  it("names every candidate and the next step when a name is ambiguous", () => {
    const msg = describeUnresolved("member_ambiguous", "阿華", cands);
    expect(msg).toContain("#12 阿華 (@ahua)");
    expect(msg).toContain("#31 阿華");
    expect(msg).toMatch(/ask the user/i);
    expect(msg).toContain("memberId");
  });

  it("lists the group's members when nobody matches", () => {
    const msg = describeUnresolved("member_not_found", "小華", cands);
    expect(msg).toContain("小華");
    expect(msg).toContain("#31");
    expect(msg).toMatch(/nothing was written/i);
  });

  it("caps a long list and keeps a long query short", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ memberId: i + 1, label: `P${i + 1}` }));
    const msg = describeUnresolved("member_not_found", "x".repeat(200), many);
    expect(msg).toContain("共 30 位");
    expect(msg).not.toContain("#30");
    expect(msg.length).toBeLessThan(600);
  });
});
