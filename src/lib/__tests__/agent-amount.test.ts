import { describe, expect, it } from "vitest";

import { parseAgentAmount } from "@/lib/agent-amount";

describe("parseAgentAmount", () => {
  it("takes numbers and the /add grammar", () => {
    expect(parseAgentAmount(12.5)).toMatchObject({ ok: true, amount: 12.5, currency: null });
    expect(parseAgentAmount("1,200")).toMatchObject({ ok: true, amount: 1200 });
    expect(parseAgentAmount("3k")).toMatchObject({ ok: true, amount: 3000 });
    expect(parseAgentAmount("150+200")).toMatchObject({ ok: true, amount: 350 });
    expect(parseAgentAmount("€50")).toMatchObject({ ok: true, amount: 50, currency: "EUR" });
    expect(parseAgentAmount("300 USD")).toMatchObject({ ok: true, amount: 300, currency: "USD" });
  });
  it("refuses leftovers, zero and nonsense", () => {
    expect(parseAgentAmount("3杯咖啡")).toMatchObject({ ok: false });
    expect(parseAgentAmount("300 lunch")).toMatchObject({ ok: false });
    expect(parseAgentAmount("abc")).toMatchObject({ ok: false });
    expect(parseAgentAmount(0)).toMatchObject({ ok: false });
    expect(parseAgentAmount(-5)).toMatchObject({ ok: false });
    expect(parseAgentAmount(NaN)).toMatchObject({ ok: false });
  });
});
