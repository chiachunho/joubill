import { describe, expect, it } from "vitest";

import { exportRecordsToCsv, type ExportRecord } from "@/lib/export";

const base: ExportRecord = {
  type: "expense",
  spentAt: "2026-10-01",
  description: "晚餐",
  amount: 1000,
  currency: "JPY",
  rate: 0.21547,
  payers: [{ name: "Alice", amount: 1000 }],
  splits: [
    { name: "Alice", amount: 500 },
    { name: "Bob", amount: 500 },
  ],
  createdByName: "Alice",
  createdAt: new Date("2026-10-01T12:05:00Z"),
};

describe("exportRecordsToCsv", () => {
  it("writes a header and one line per record", () => {
    const lines = exportRecordsToCsv([base], "TWD").slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("換算金額");
    expect(lines[1]).toBe(
      "2026-10-01,支出,晚餐,1000,JPY,215.47,TWD,0.21547,Alice:1000,Alice:500; Bob:500,Alice,2026-10-01 12:05",
    );
  });

  it("labels settlements and keeps multiple payers on one row", () => {
    const rec: ExportRecord = {
      ...base,
      type: "settlement",
      payers: [
        { name: "A", amount: 300 },
        { name: "B", amount: 200 },
      ],
    };
    const line = exportRecordsToCsv([rec], "TWD").trim().split("\r\n")[1];
    expect(line).toContain(",還款,");
    expect(line).toContain("A:300; B:200");
  });

  it("converts at 4 decimals so column sums can match the balance", () => {
    const rate = 0.215473;
    const rows = Array.from({ length: 3 }, () => ({ ...base, rate }));
    const converted = exportRecordsToCsv(rows, "TWD")
      .trim()
      .split("\r\n")
      .slice(1)
      .map((l) => Number(l.split(",")[5]));
    expect(converted).toEqual([215.473, 215.473, 215.473]);
  });

  it("does not let a description run as a formula", () => {
    const line = exportRecordsToCsv([{ ...base, description: "=1+1" }], "TWD")
      .trim()
      .split("\r\n")[1];
    expect(line.split(",")[2]).toBe("'=1+1");
  });
});
