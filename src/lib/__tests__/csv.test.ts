import { describe, expect, it } from "vitest";

import {
  buildCsv,
  contentDisposition,
  escapeCsvField,
  exportFilename,
  formatLegs,
  formatUtcMinute,
} from "@/lib/csv";

describe("escapeCsvField", () => {
  it("leaves plain text alone", () => {
    expect(escapeCsvField("晚餐")).toBe("晚餐");
  });
  it("quotes commas, newlines and carriage returns", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
  });
  it("doubles embedded quotes", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });
  it("defuses formula triggers", () => {
    expect(escapeCsvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvField("+1")).toBe("'+1");
    expect(escapeCsvField("-1")).toBe("'-1");
    expect(escapeCsvField("@x")).toBe("'@x");
  });
  it("defuses a trigger that also needs quoting", () => {
    expect(escapeCsvField('=A,"b"')).toBe('"\'=A,""b"""');
  });
});

describe("buildCsv", () => {
  const csv = buildCsv(["日期", "說明", "金額"], [["2026-01-01", "a,b", 12.5]]);
  it("starts with a UTF-8 BOM", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
  it("uses CRLF and ends with a newline", () => {
    expect(csv.slice(1)).toBe('日期,說明,金額\r\n2026-01-01,"a,b",12.5\r\n');
  });
  it("writes negative numbers and nulls without a formula guard", () => {
    expect(buildCsv(["a", "b"], [[-5, null]]).slice(1)).toBe("a,b\r\n-5,\r\n");
  });
});

describe("formatLegs", () => {
  it("joins people with a semicolon", () => {
    expect(
      formatLegs([
        { name: "A", amount: 300 },
        { name: "B", amount: 200.5 },
      ]),
    ).toBe("A:300; B:200.50");
  });
  it("is empty for no legs", () => {
    expect(formatLegs([])).toBe("");
  });
});

describe("formatUtcMinute", () => {
  it("renders UTC to the minute", () => {
    expect(formatUtcMinute(new Date("2026-10-29T14:05:59Z"))).toBe("2026-10-29 14:05");
  });
});

describe("exportFilename", () => {
  const now = "2026-10-29";
  it("appends the date", () => {
    expect(exportFilename("日本之旅", now)).toBe("日本之旅-2026-10-29.csv");
  });
  it("replaces characters illegal in filenames", () => {
    expect(exportFilename('a/b:c"d', now)).toBe("a_b_c_d-2026-10-29.csv");
  });
  it("never cuts an emoji in half when truncating", () => {
    const name = exportFilename("a".repeat(59) + "😀😀", now);
    expect(() => encodeURIComponent(name)).not.toThrow();
  });
  it("falls back when the title is blank", () => {
    expect(exportFilename("  ", now)).toBe("group-2026-10-29.csv");
  });
});

describe("contentDisposition", () => {
  it("carries an ASCII fallback and the UTF-8 name", () => {
    const h = contentDisposition("日本-2026-10-29.csv");
    expect(h).toContain('filename="__-2026-10-29.csv"');
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent("日本-2026-10-29.csv")}`);
  });
});
